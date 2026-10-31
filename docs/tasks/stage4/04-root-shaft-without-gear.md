---
id: S4-04
title: 起点のシャフトを歯車なしで置く
status: done
depends: [S4-03]
---

# S4-04 起点のシャフトを歯車なしで置く

## 目的
今は起点のシャフトを置くと、必ず平歯車が 1 枚ついてくる。S4-03 でシャフト上の好きな位置に歯車を置けるようになったので、シャフトだけを置けるようにする。

## 範囲
- 調査で分かった今の作り
  - S1-17 の仕様で、起点の配置は「起点のシャフト 1 本と、その上の歯車 1 枚」（`docs/tasks/stage1/17-root-shaft-placement.md`）
  - `rootPlacementCommand`（`src/input/placement.ts:69-81`）が常に `gear: { size, teeth: DEFAULT_TEETH[size] }` を送る
  - `addRootShaft`（`src/core/edit/commands.ts:299-325`）は歯車が必須で、種類は `'spur'` 固定（:307）。design.md:642 に「起点の歯車はパレットの種類を無視する」とある
  - S4-03 で決まったこと（このタスクの前提）:
    - シャフトは範囲 `Shaft.span` を持つ（design.md §4）。コマンドで新しくできたシャフトには `applyCommand` の `fitShaftSpans` が部品の範囲を入れ、部品が無ければ ±`EMPTY_SHAFT_HALF_LENGTH`（`defaultShaftSpan`。`[-10, 10]`）になる。なので歯車の無い `addRootShaft` は、範囲を自分で入れなくても長さ 20 mm になる
    - 歯車の無いシャフトの部品の範囲（`requiredShaftSpans`）は `null`。検証（`spanTooShort`）・伸縮（`stretchShaftSpan`。反対の端から 4 mm 以上）はこれを扱える。±10 の端は 4 の倍数でないが、`setShaftSpan` は変えない端の 4 の倍数を問わない
    - シャフトの上に置く仮の歯車（`shaftGhostAt`、`Interactions.setHover`・`placeOnShaft`）は、**シャフトそのものを選んでいるとき** だけ出る（歯車を選んでいるときは出さない）。起点を置いたあと（`selectCreated`）に選ばれるのが新しいシャフトになれば、続けてシャフトをクリックして置ける
    - `deleteParts` は歯車が 1 枚も残らなくなったシャフトを消す（`removeShaft`）。歯車の無いシャフトを残すなら、この規則（design.md §4 の「歯車が 1 枚も残らなくなったシャフトは、モーターごと削除する」）との関係を決める
- パレットの「起点のシャフト」を床にドラッグすると、歯車の無いシャフトだけができる
- 置いた直後のシャフトの長さは 20 mm（今の ±`EMPTY_SHAFT_HALF_LENGTH` と同じ）
- 歯車はそのあと S4-03 のシャフト上の配置で置く
- 歯車の無いシャフトにも、モーター・固定具を付けられる（今の規則のまま）。回しても何も起きない
- S1-17 の資料と design.md:642 を書き換える

## 範囲外
- 起点のシャフトの向き・置き方の変更

## 作るもの
- `src/core/edit/commands.ts`: 歯車の無い `addRootShaft`
- `src/input/placement.ts`: `rootPlacementCommand` から歯車を外す
- **design.md の書き換え**: :642 の起点の歯車の記述、§5 の起点の配置

## 受け入れ条件
- [x] 起点のシャフトを置くと、歯車の無い長さ 20 mm のシャフトだけができる
- [x] そのシャフトの上に、パレットで選んだ種類の歯車を置ける
- [x] 歯車の無いシャフトを保存・読み込みできる

## テストケース
### Vitest
- [x] `addRootShaft` を歯車なしで実行 → 歯車が増えず、シャフトの範囲が 20 mm
- [x] 歯車の無いシャフトを含むシーンが検証を通り、保存・読み込みで変わらない
### Playwright
- [x] 起点のシャフトを床にドラッグ → `__gearSim` のシャフトが 1 本増え、歯車は増えない
- [x] 続けてパレットではすば歯車を選び、そのシャフトをクリック → はすば歯車が置かれる

## 人が手で確かめる項目
- なし

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した
- [x] `status: done` にしてコミットした
