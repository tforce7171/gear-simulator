---
name: add-edit-command
description: 編集コマンド（Undo/Redo できるシーンの変更）を足す手順。setXxx・growXxx のようなコマンドの追加や、プロパティパネル・操作からシーンを変える機能を作るときに使う。
---

# 編集コマンドを足す

コマンドはすべて `src/core/edit/commands.ts` にある（1600 行あるので、`grep -n "^export\|^function\|    case '" src/core/edit/commands.ts` で目次を出してから読む）。似たコマンドを 1 つ選んで手本にする。値を変えるだけなら `setGearWidth`、部品を作るなら `growRack`、シャフトの形を変えるなら `setShaftSpan`。

1. **テストを先に書く**: `src/core/edit/<機能>.test.ts` を新しく作る（例: `gear-width.test.ts`、`shaft-span.test.ts`）。成功、各エラーコード、何も変わらないときに同じシーンの参照が返ること、Undo/Redo（`src/core/edit/history.ts` の `execute` / `undo` / `redo`）を確かめる。
2. **型**: `Command` の union に `{ type: '<名前>'; ... }` を足す。上に、何をするか・どんなときに失敗するかを 1〜2 行のコメントで書く（ほかのコマンドと同じ書き方）。
3. **処理**: `applyRaw` の switch に case を足し、`function <名前>(scene, c: Extract<Command, { type: '<名前>' }>): CommandResult` を書く。
   - 失敗は例外にせず `fail(code, message)` で返す。対象が無い → `'notFound'`、値が範囲外 → `'invalidValue'`、その部品ではできない・ぶつかる → `'notAllowed'`。
   - 値が今と同じなら `done(scene)` で同じ参照を返す。
   - 形や大きさが変わって他の部品にぶつかりうるなら、`withoutNewInterference(scene, changed, '<何を>')` を通して `'notAllowed'` にする。
   - シャフトの範囲は `applyCommand` が `fitShaftSpans` で合わせるので、自分で伸ばさない。
4. **UI につなぐ**: プロパティパネルなら `src/ui/properties.ts` の `tryCommand(scene, { type: ... })`（失敗の理由をトーストで出す）。キャンバスの操作なら `src/app/interactions.ts`。文言は `src/core/i18n/ja.ts` と `en.ts` の両方に足す。
5. **e2e**: `e2e/<機能>.spec.ts` を作り、操作 → `__gearSim.getScene()` で値を確かめ、Undo/Redo（Redo は `Control+Shift+z`）で戻ることを確かめる。
6. **資料**: design.md §7 の編集コマンドの説明に足す。`__gearSim` の API を足したら §10 の表にも足す。

完了の条件: 1 のテストと 5 の e2e が通り、処理のエラーの判定（例: ぶつかるときの `notAllowed`）をわざと外すとテストが落ちることを確かめて、元に戻してある。
