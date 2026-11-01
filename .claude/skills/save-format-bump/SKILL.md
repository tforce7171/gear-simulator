---
name: save-format-bump
description: 保存形式（SaveFile）の version を上げる手順。Scene の型にフィールドを足す・必須にするなど、古い保存ファイルや e2e/fixtures の JSON がそのままでは読めなくなる変更をするときに使う。
---

# 保存形式の version を上げる

まず、上げる必要があるかを決める。省略できるフィールドを足すだけで、省いたときの意味が今までと同じなら、version は上げない（S4-05 の `width` がこの例。design.md §9 の version 4 の節）。必須のフィールドを足す・意味が変わるなら、上げる。決めたことは `docs/tasks/implementation-log.md` に書く。

段階の途中のタスクが Scene に最上位のコレクション（`anchors`・`carriers`・`racks` など）を足すときは、まだ version を上げず、`parse.ts` で無いコレクションを `{}` で補う暫定の処理にする。段階の最後の統合タスクで version を上げ、移行で補うようにして暫定の処理を消す（S3-01・S3-03・S3-04 → S3-05 の version 3）。

上げるときの手順（例は S4-03 の version 3 → 4。`git show 79a3844 --stat` で触ったファイルを見られる）:

1. **型と検証**: `src/core/scene/types.ts` にフィールドを足す。`src/core/scene/parse.ts` は型にあるフィールドだけで作り直すので、足したフィールドを読むようにする。意味の検証は `src/core/scene/validate.ts` に置く（`save-file.ts` には重ねて書かない）。
2. **版と移行**（`src/core/io/save-file.ts`）:
   - `CURRENT_SAVE_VERSION` を 1 上げ、冒頭の版ごとのコメントに 1 行足す。
   - `MIGRATIONS` に n → n+1 を足す。移行は生の値（unknown）を受け取る。シーンを読む必要があれば、旧版の形を受け付ける読み方で読み、読めなければそのまま渡して新しい版の検証で弾く（`MIGRATIONS[3]` がこの形）。
   - 書き出し（`toSaveFile`）が新しいフィールドを必ず埋めるようにする。
3. **旧版の見本**: `src/core/io/save-file-v<n>.json` を作る（旧版の `SaveFile`。シーンは showcase 系の fixture から新しいフィールドを除いたもの）。`save-file.test.ts` に「v<n> を読むと移行され、期待どおりの値が入る」describe を足す。
4. **fixture を全部直す**: `e2e/fixtures/*.json`（約 40 本）は最新の Scene 形式。手で直さず、tsx の使い捨てスクリプトで一括して補い、`pnpm exec biome format --write e2e/fixtures` で整える。`src/app/demo-scene.ts`（`two-spur.json` と一致が必要）と `src/debug/perf-scene.ts` も同じ形にする。
5. **最新版を確かめているテスト**: `grep -rn "CURRENT_SAVE_VERSION\|version: <n>\|toBe(<n>)" src e2e` で、版の数字を直に書いている箇所を探して直す（例: `e2e/stage3.spec.ts` の旧版の読み込み）。
6. **資料**: design.md §9 に「version <n+1>」の節（何が変わったか、移行、検証、見本の fixture）を足し、§9 冒頭の「最新は …」を直す。

完了の条件: `pnpm verify` に加えて、移行を何もしない形にわざと変えて `save-file.test.ts` が落ちることを確かめ、元に戻してある。
