---
name: add-gear-kind
description: 歯車の種類（GearKind）を足す手順。ハスバ歯車・かさ歯車・ウォーム・内歯車のような新しい種類の歯車や、それとかみ合う組を作るときに使う。型で拾えない落とし穴（位相・干渉の外形・候補の並び・性能の目安）のチェックリストを含む。
---

# 歯車の種類を足す

段階 2・3 で 6 回（S2-01〜S2-04、S3-02、S3-04 の歯車の部分）同じ組のファイルを触った。手本は小さい順に S2-04（ねじ歯車、`git show e505586 --stat`）、S2-01（ハスバ歯車、`5b25789`）、S3-02（内歯車、`83f1262`。中心距離・干渉・候補まで変わる）。design.md §4 の「種類ごとの分岐」（S2-01〜S2-03 の段落）に、そのときどきに直した分岐が書いてある。

1. **テストを先に書く**: `src/core/layout/<種類>.test.ts`（例: `crossed-helical.test.ts`、`internal.test.ts`）に、かみ合える組・かみ合えない組、中心距離、ω の比、位相、候補、干渉を書く。形は `src/core/geometry/<種類>.test.ts`、描画の形は `src/render/gear-geometry.test.ts`。
2. **型を足して、型のエラーに沿って直す**: `src/core/scene/types.ts` の `Gear` の union に `interface XxxGear extends GearBase { readonly kind: 'xxx' }` を足す。種類で分ける箇所は `switch` の `default` で `assertNever`（`src/core/scene/gear-shape.ts`）を呼んでいるので、`pnpm typecheck` の一覧がそのまま直す場所になる。主なもの:
   - `scene/gear-shape.ts`（`gearShape`・`newGearShape`・`meshPartnerShape`・`skewPartnerShape`・`GEAR_KINDS`）、`scene/parse.ts`（種類ごとのフィールドを拾う）、`scene/validate.ts`
   - `geometry/can-mesh.ts`（`canMesh`・`meshKindOf`・`meshGeometryOf`）、`geometry/dimensions.ts`、`geometry/shape-key.ts`、`kinematics/mesh-coefficients.ts`
   - `Record<GearKind, …>` の表: `render/themes.ts`（材質）、`ui/icons.ts`（パレットのアイコン）、`core/audio-model/index.ts`（`meshTimbre`）
   - 形: `src/core/geometry/<種類>.ts` に輪郭を作り、`render/gear-geometry.ts` から呼ぶ。
3. **型で拾えないところ**（ここで毎回つまずいた）:
   - **位相**: `layout/resolve.ts` の位相の式を種類に合わせる。「接点で、片方の歯の中心ともう片方の歯溝の中心が重なる」ことを、ω の比のとおりに回しても保たれることまでテストで確かめる（S2-02 のかさ歯車、S3-02 の内歯車で、静止の 1 点だけ確かめて回すとずれた）。
   - **干渉の外形**: `geometry/dimensions.ts` の `gearEnvelope` と `layout/collision.ts`。外形が円柱で表せないなら形を足す（S3-02 は中空の `'hollow'` を後から足した）。かみ合う相手を干渉と誤って判定しないかを、テストで確かめる。
   - **中心距離と候補**: `centerDistance`（内歯車は `R − r`）、`layout/candidates.ts` の `listGrowCandidates`。`candidates.test.ts` の「並び・決定性・不変」が、候補の数や順の変化で落ちる（S3-02・S3-04）。期待値を直すときは、並びの規則（design.md §5）どおりかを確かめる。
   - **性能の目安**: 種類の分岐で候補の列挙や干渉の判定が遅くなると、`candidates.test.ts`・`collision.test.ts` の「性能の目安」が、`pnpm test` を全部まとめて流したときだけ落ちる（S2-01 はファイル単位では通り、レビューで落ちた）。`pnpm test` を全部で 2 回流して確かめる。しきい値は緩めない（design.md §10 の Vitest）。
4. **生やす・置く**: `src/app/grow.ts`、パレット（`src/ui/palette.ts`）、プロパティパネル（`src/ui/properties.ts`。歯数の範囲は `teethRange`、厚さは `isWidthAdjustable`）。新しいコマンドや配置が要るなら add-edit-command スキル。文言は `src/core/i18n/ja.ts` と `en.ts` の `gearKind.<種類>`。
5. **e2e と見た目**: `e2e/fixtures/<種類>-pair.json` を作り、`e2e/<種類>.spec.ts`（生やす → `getLayout().meshes[].kind` と回転の向き・比を確かめる）と `e2e/visual/<種類>.spec.ts`（かみ合いの拡大を撮って png を Read で見る。design.md §10 の段階ごとの場面に足す）を足す。`src/app/grow.test.ts` は全 fixture の候補を確かめるので、新しい fixture でも通ることを確かめる。
6. **保存形式**: 種類を足すだけで、省いたときの意味が今までと同じなら version は上げない。必須のフィールド（`hand`・`apex` のような）を足すなら save-format-bump スキル。
7. **資料**: design.md §4 の「歯車の種類ごとの追加フィールド」の表に 1 行、かみ合える組の規則、§10 の見た目の場面と `__gearSim` の表（`getCandidates()` の `kind` などが増えたら）。

完了の条件: 1 のテストと 5 の e2e が通り、`pnpm test` を全部で 2 回流して性能の目安に余裕があり、位相の式をわざとずらすと位相のテストが落ちることを確かめて、元に戻してある。
