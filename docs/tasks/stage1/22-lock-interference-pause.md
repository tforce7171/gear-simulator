---
id: S1-22
title: ロックの表示、干渉の警告、一時停止
status: doing
depends: [S1-07, S1-08, S1-16]
---

# S1-22 ロックの表示、干渉の警告、一時停止

## 目的
計算で求めたロックと干渉を、画面でひと目でわかるようにする（要件 §5「ロック（震えて赤く光る）」、§6「干渉」）。あわせて、Space（押して離す）で全モーターを一時停止できるようにする（要件 §7.2）。

## 範囲
- **ロックの表示**
  - `getMotion().locks` に含まれる連結成分の歯車とシャフト（とモーター）を、赤く脈打つように光らせ、細かく震わせる
  - 震えは描画だけに加える（軸まわりの小さな回転のゆれ。振幅は 0.01 rad 程度）。`MotionState` の角度は変えない
  - 光は赤の発光色の強さを周期的に変える（2Hz 前後）
  - 部品ごとに震えの位相をずらす（全部が同じに揺れて見えないように）
- **干渉の警告**
  - `getLayout().interferences` の組に含まれる部品を、脈打たない一定の赤で表示する（ロックとは脈打つかどうかで見分ける）
  - 干渉していてロックもしている部品は、ロックの表示を優先する
  - 選択のハイライト（S1-16）と同時に出ても、両方が見分けられること（S1-16 の選択・マウスを乗せたときのハイライトは、材質を水色の発光の複製に差し替える方法。`render/sync.ts` の `applyHighlight`。ロックの赤は、これと重ねられる別の方法（輪郭線や点滅など）にするか、`applyHighlight` で両方を組み合わせた材質を選ぶ）
- **一時停止**
  - Space を押して離すと、全モーターの一時停止を切り替える（ON ↔ OFF）
  - 押している間にドラッグ（`DRAG_THRESHOLD_PX` 以上のポインターの移動）があったら、それは平行移動（S1-13）なので切り替えない
  - 押していた時間が `SPACE_TAP_MAX_MS`（500ms）を超えたら切り替えない（平行移動しようとしてやめた場合）
  - キーの自動の繰り返し（`repeat`）は無視する。テキスト入力中は効かない（S1-13 の共通の処理）。ボタンにフォーカスがあるときも、Space でボタンが押されないように既定の動作を止める
  - 一時停止中は、モーターをすべて止めた状態で解く（design.md §6。S1-07 の `stepMotion` に `opts.paused` を渡す）。シーンは変えず（モーターの `on` はそのまま）、Undo の履歴にも入らない
  - 一時停止中は、描画領域の上部中央に「一時停止中」の表示を出す（`t()`）
  - 一時停止中でも手で回せる（S1-21）
  - 状態は `AppState.sim.paused`（初期値 false。保存しない。design.md §7）

## 範囲外
- ロックの判定そのもの（S1-07）、干渉の判定そのもの（S1-08）
- ロックしたときの音（S1-25）
- 手で回しているときのロックの扱い（S1-21）
- 編集中の仮の部品を赤くする表示（S1-17・S1-19）

## 作るもの
- S1-21 で済んだもの: `AppState.sim` は `src/app/store.ts` の `SimState`（今は `hand` だけ。初期値 `DEFAULT_SIM`）。ここに `paused` を足す（`sim.hand` は `store.setHand` で書き換え、購読者に知らせない。`paused` は Space で切り替えるので `dispatch` のアクションにしてよい）。`src/app/loop.ts` の `runFrame` は `sim.hand` が null でなければ `stepMotion` に `{ hand }` を渡しているので、`{ paused: sim.paused, hand }` にする。`e2e/fixtures/lock-opposed.json`（`shaft_1`・`shaft_2`、`gear_1`・`gear_2`、`motor_1`・`motor_2`）と `e2e/fixtures/lock-triangle.json`（起点 `shaft_1` の原点 `[0, 20, 0]`、`gear_1`〜`gear_3`、`motor_1`）は S1-21 で作った
- S1-17 の仮の部品の赤（`render/sync.ts` の `PreviewStyle` の `invalid`。色そのものを赤 `0xe0403a` にした材質）とも見分けられるようにする。材質を選ぶのは `applyHighlight` の `levelOf`（仮の部品の見た目 → 選択 → マウス）なので、ロック・干渉の表示もここで組み合わせる
- `src/render/warning-effects.ts`（計算部分は純粋関数）
  ```ts
  export const LOCK_SHAKE_AMPLITUDE = 0.01; // rad
  export function lockShakeAngle(timeSec: number, seed: number): number; // |値| ≤ LOCK_SHAKE_AMPLITUDE
  export function lockGlowIntensity(timeSec: number): number;           // 0〜1 の周期関数
  // ロック中・干渉中として表示する部品の ID（ロックを優先し、interfering からはロック中を除く）
  export function warningParts(scene: Scene, layout: Layout, motion: MotionState): {
    locked: Set<string>;
    interfering: Set<string>;
  };
  ```
  - `warningParts` はロックの情報（design.md §6 の `LockInfo`）の `gearIds`・`shaftIds` と、それらのシャフトに付いたモーターの ID を集める。three に依存しないので `src/core/` に置いてもよい
- `src/input/space-tap.ts`（純粋関数、状態を持つ）
  ```ts
  export const SPACE_TAP_MAX_MS = 500;
  export type SpaceTapEvent =
    | { type: 'keydown'; repeat: boolean; timeMs: number }
    | { type: 'keyup'; timeMs: number }
    | { type: 'drag' }; // Space を押している間にドラッグが始まった
  export function createSpaceTapDetector(): (e: SpaceTapEvent) => 'tap' | null;
  ```
- 一時停止の表示（`data-testid="pause-indicator"`）と辞書のキー
- `__gearSim` に追加（design.md §10 も更新する）
  ```ts
  isPaused(): boolean;
  getWarningParts(): { locked: string[]; interfering: string[] };
  ```
- `e2e/fixtures/lock-opposed.json`（S1-21・S1-26 と同じもの。先に作られていればそれを使う）: 中・20 歯の 2 枚がかみ合い、両方のシャフトに小のモーター（60 rpm、`direction: 1`、ON）
- `e2e/fixtures/overlap.json`: 縦軸の起点のシャフト 2 本に中・20 歯を 1 枚ずつ、中心距離 30（重なる）で置いたもの（`loadScene` は配置の検査をしないので作れる）
  - 実装時の注記: S1-08 が同じ名前で先に作っていた（小・12 歯を中心距離 10 で重ねたもの。`e2e/collision.spec.ts` が使う）ので、それをそのまま使った（implementation-log.md）
- `e2e/fixtures/one-root-motor.json`（S1-18 と同じもの。先に作られていればそれを使う）
- `e2e/fixtures/lock-triangle.json`（S1-21 と同じもの。先に作られていればそれを使う）: 3 枚が三角形にかみ合い、読み込むと `contradiction` のロックになる

## 受け入れ条件
- [x] ロック中の部品が赤く脈打って光り、震える。運動の状態の角度は変わらない
- [x] 干渉している部品が一定の赤で表示され、ロックと見分けられる
- [x] Space を押して離すと全モーターが止まり、もう一度で動き出す。Space+ドラッグの平行移動では切り替わらない
- [x] 一時停止はシーンと Undo の履歴に影響しない

## テストケース
### Vitest
- [x] `lockShakeAngle`: 0〜10 秒を細かく刻んだすべての点で `|値| ≤ LOCK_SHAKE_AMPLITUDE`。時間とともに値が変わる（定数でない）。seed が違うと同じ時刻でも値が違う
- [x] `lockGlowIntensity`: 値が 0〜1 に収まり、1 秒の間に最大と最小の差が 0.5 以上ある
- [x] `warningParts`: ロックした連結成分の歯車・シャフト・モーターがすべて `locked` に入る。ロックしていない連結成分の部品は入らない。干渉の組の部品は `interfering` に入るが、`locked` にも入っているものは除かれる
- [x] `createSpaceTapDetector`
  - keydown(0) → keyup(120) → `'tap'`
  - keydown(0) → drag → keyup(120) → null
  - keydown(0) → keyup(800) → null
  - keydown(0) → keydown(repeat, 30) → keydown(repeat, 60) → keyup(120) → `'tap'`（1 回だけ）
  - keyup だけ（押されていない）→ null
- [x] 一時停止で解く（S1-07 の `stepMotion` の `opts` に `paused: true`）→ モーター付きのシーンでも ω がすべて 0。`paused: false` に戻すとつり合いの解に戻る（S1-07 で同じテストがあれば不要）
### Playwright（`e2e/lock-pause.spec.ts`）
- [x] `lock-opposed.json` → `getMotion().locks` に `reason: 'stalemate'` のロック。`getWarningParts().locked` に 2 枚の歯車と 2 本のシャフトと 2 つのモーターが入る。500ms 待っても `getMotion().angles` が変わらない
- [x] `lock-triangle.json` → `getMotion().locks` に `reason: 'contradiction'` のロック。`getWarningParts().locked` に 3 枚の歯車が入り、`interfering` は空（contact は干渉にしない）
- [x] `overlap.json` → `getLayout().interferences` に 2 枚の組があり、`getWarningParts().interfering` に両方が入る
- [x] `one-root-motor.json` → A のシャフトの ω が π。`keyboard.press('Space')` → `isPaused()` が true、ω が 0、角度が 300ms 変わらない、`pause-indicator` が見える、シーンのモーターの `on` は true のまま
- [x] もう一度 Space → `isPaused()` が false、ω が π、`pause-indicator` が消える
- [x] 一時停止にしてから Ctrl+Z → 一時停止のまま（履歴に入っていない）、シーンも変わらない
- [x] Space を押したまま何もない所で左ドラッグ（100px）して、Space を離す → `getCamera().target` が変わり（平行移動）、`isPaused()` は変わらない
- [x] Space を 800ms 押して離す（`keyboard.down` → 待つ → `keyboard.up`）→ `isPaused()` は変わらない
- [x] プロパティパネルの入力欄（歯車を選んで `prop-teeth`。S1-20）にフォーカスして Space → `isPaused()` は変わらない
- [x] ボタン（テスト用に `page.evaluate` で足した、押すと数を数える button）にフォーカスがある状態で Space → 一時停止が切り替わり、ボタンは押されない（数が 0 のまま）
### Playwright（見た目、`e2e/visual/lock.spec.ts`）
- [x] `lock-opposed.json` を読み込み、2 枚が大きく映る視点（`setCamera`）で `screenshots/lock-red.png` を保存する。真っ黒・真っ白でないこと（赤く見えるかは人が画像で確かめる。design.md §10 のとおり自動の判定はこれだけ）
- [x] `overlap.json` で `screenshots/interference.png` を保存する。真っ黒・真っ白でないこと

## 人が手で確かめる項目
- ロックの震えと赤い光が、気づけるが不快でない強さである
- ロック（脈打つ赤）と干渉（一定の赤）と選択（水色など）が見分けられる。真鍮と木製のどちらのテーマでも（S1-24 の後に確かめる）
- Space の押して離すと、Space+ドラッグの平行移動が、手で使い分けて誤動作しない

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（§7 の `AppState.sim.paused`、§10 の `__gearSim` の API）
- [ ] `status: done` にしてコミットした
