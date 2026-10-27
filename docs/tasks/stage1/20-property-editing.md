---
id: S1-20
title: プロパティの編集（歯数、モーター）
status: doing
depends: [S1-07, S1-16]
---

# S1-20 プロパティの編集（歯数、モーター）

## 目的
選んだ部品の設定を右のプロパティパネルで変えられるようにする。歯数を変えてギア比を試し、モーターを付けて回せるようになる（要件 §3.2、§3.3、§5）。

## 範囲
- プロパティパネル（S1-15 の `properties.setContent`）の中身。選択が変わるたび、シーンが変わるたび（Undo を含む）に表示を作り直す
- **歯車を選んでいるとき**
  - 種類（平歯車）と大きさ（小・中・大）を表示する（変えられない）
  - **歯数**: 数値の入力欄と −／＋ のボタン。範囲は大きさごと（`GEAR_SIZES[size].minTeeth`〜`maxTeeth`）
    - 入力欄は Enter かフォーカスが外れたときに確定する。小数は四捨五入、範囲外は範囲の端に丸める、数でなければ元の値に戻す
    - 歯数を変えると、その歯車の先につながる歯車は `resolveLayout` によってすべてついてくる（中心距離が変わる）。その結果の干渉は止めずに、赤い警告（S1-22）に任せる（要件 §6「編集の連鎖で重なった場合は赤く警告する」）
  - 下に、その歯車のシャフトのモーターの欄（下記）を出す
- **シャフトを選んでいるとき**: 向き（縦・横 X・横 Z。`getLayout().shafts[id].axis` から読む。`mesh` のシャフトは向きを親から導くので、シーンには無い）を表示し（変えるのは S1-17 の R）、モーターの欄を出す
- **モーターの欄**（モーターはシャフトに 1 つまで）
  - 無いとき: 「小」「中」「大」の 3 つの「付ける」ボタン。付けたモーターは、rpm = `MOTOR_SIZES[size].defaultRpm`、向き = 1、ON
  - あるとき
    - 大きさ: 小・中・大の切り替え。変えても rpm・向き・ON/OFF はそのまま
    - rpm: スライダー（1〜120、整数）と数値の入力欄。スライダーは離したとき（`change`）に確定し、動かしている間（`input`）は数値の表示だけ変える。入力欄の確定と丸めは歯数と同じ
    - 向き: 正転／逆転の切り替え（`direction` の 1／−1）
    - ON/OFF の切り替え
    - 「外す」ボタン
- 設定の変更は、すべて S1-11 の編集コマンド（`setGearTeeth`、`addMotor`、`updateMotor`、`removeMotor`）で行い、1 回の確定が Undo 1 回に対応する。値が変わらない確定ではコマンドを出さない（数値をドラッグで連続して変える場合は、ストアの `command` アクションに操作ごとの `coalesceKey` を付けて 1 回の Undo にまとめる。S1-11）
- モーターの見た目: シャフトの軸方向の端（`span` の小さい側のさらに外）に、大きさに応じた箱か円柱を描く。ピッキングの種類は `'motor'`（S1-16）。S1-04 で描いていればそれを使う
- 文字列はすべて `t()`。言語を切り替えたら表示も変わる
- 入力欄にフォーカスがあるときは、キーボードのショートカット（Delete、Space、R など）が効かない（S1-13 の共通の処理）

## 範囲外
- コンテキストメニューからのモーターの付け外し（S1-29）
- モーターの音（S1-25）
- 情報表示（rpm・ギア比の表示、S1-23）
- 向きの変更（S1-17 の R）、角度と位置（S1-19）

## 作るもの
- `src/ui/properties.ts`: パネルの中身の組み立て。主な要素に `data-testid` を付ける
  | 要素 | `data-testid` |
  |---|---|
  | 歯数の入力欄、−、＋ | `prop-teeth`、`prop-teeth-dec`、`prop-teeth-inc` |
  | モーターを付ける | `prop-motor-add-S`、`prop-motor-add-M`、`prop-motor-add-L` |
  | モーターの大きさ | `prop-motor-size-S`、`prop-motor-size-M`、`prop-motor-size-L` |
  | rpm のスライダー、入力欄 | `prop-motor-rpm-slider`、`prop-motor-rpm` |
  | 向き、ON/OFF、外す | `prop-motor-direction`、`prop-motor-on`、`prop-motor-remove` |
- `src/ui/number-input.ts`（純粋関数）
  ```ts
  // 入力欄の文字列を確定値にする。数でなければ null（元の値に戻す）
  export function parseClampedInt(text: string, min: number, max: number): number | null;
  ```
- 辞書に、パネルの見出し・項目名・ボタンのキーを足す

## 受け入れ条件
- [ ] 歯車を選ぶと歯数を変えられ、範囲は大きさごとに守られる。先の歯車がついてくる
- [ ] シャフト（または歯車）を選ぶとモーターを付け外しでき、rpm・向き・ON/OFF を変えるとすぐに回り方が変わる
- [ ] どの変更も Undo 1 回で戻り、Undo するとパネルの表示も戻る

## テストケース
### Vitest
- [ ] `parseClampedInt('30', 12, 60)` → 30、`'100'` → 60、`'5'` → 12、`'20.6'` → 21、`' 25 '` → 25、`'abc'` → null、`''` → null
### Playwright（`e2e/properties.spec.ts`）
準備: `two-gears.json`（S1-13。A と B、どちらも中・20 歯）を読み込み、A をクリックして選ぶ。
- [ ] `prop-teeth` の値が 20
- [ ] `prop-teeth` に 30 を入れて Enter → A の `teeth` が 30。A と B の中心距離（`getLayout`）が 50
- [ ] Ctrl+Z → 20 に戻り、`prop-teeth` の表示も 20 に戻る
- [ ] `prop-teeth` に 100 を入れて Enter → 60。5 → 12。`abc` → 元の値のまま、コマンドは出ない（Ctrl+Z 1 回で、その前の変更が戻る）
- [ ] `prop-teeth-inc` を押す → 1 増える
- [ ] `prop-motor-add-M` を押す → `getScene().motors` が 1 つ（`size: 'M'`、`rpm: 30`、`direction: 1`、`on: true`、`shaftId` が A のシャフト）。`getMotion().omegas` の A のシャフトが π（30 rpm）、B のシャフトが −π（`toBeCloseTo`）
- [ ] `prop-motor-rpm` に 60 を入れて Enter → A のシャフトの ω が 2π
- [ ] `prop-motor-rpm-slider` を `fill('90')` 相当で動かして `change` を起こす → `rpm` が 90
- [ ] `prop-motor-direction` → ω の符号が反転する
- [ ] `prop-motor-on` で OFF → ω が 0
- [ ] `prop-motor-size-L` → `size: 'L'`、`rpm` は変わらない
- [ ] `prop-motor-remove` → `motors` が空。Ctrl+Z を 1 回ずつ押すと、外す → 大きさ → ON/OFF → 向き → … の順に 1 つずつ戻る
- [ ] A のシャフトを選んでも（シャフトの部分をクリック）、モーターの欄が出る
- [ ] `prop-teeth` にフォーカスがある状態で Delete → 歯車は消えない
- [ ] `__gearSim.setLanguage('en')` → パネルの見出しが英語の辞書の値になる
### Playwright（見た目）
- なし（S1-31 でまとめる）

## 人が手で確かめる項目
- パネルの並びが見やすく、rpm のスライダーが操作しやすい
- 歯数を変えたときに、先の歯車がついてくる様子が自然に見える

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した
- [ ] `status: done` にしてコミットした
