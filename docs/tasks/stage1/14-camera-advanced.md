---
id: S1-14
title: カメラ（応用）
status: doing
depends: [S1-13, S1-15]
---

# S1-14 カメラ（応用）

## 目的
Mac のトラックパッドでも自然に操作でき、決まった方向から見たり、平行投影で眺めたり、自動で周回させて鑑賞したりできるようにする（要件 §7.1）。

## 範囲
- トラックパッドとマウスの自動判別（`wheel` イベントの特徴から）
  - ピンチ（`ctrlKey` 付きの `wheel`）→ カーソル位置へのズーム。量は `deltaY` に比例した連続値
  - 2 本指スクロール（`ctrlKey` なしの `wheel`、トラックパッドと判別したとき）→ 割り当てに従う。割り当ては `'pan'`（平行移動、標準）／`'orbit'`（回転）（design.md §7 の `Settings.trackpadScroll`）
  - マウスのホイール → ズーム（S1-13 と同じ）
  - Safari のピンチは `gesturestart` / `gesturechange` で来るので、それもズームとして扱う
- 入力デバイスの手動固定: 設定 `'auto' | 'mouse' | 'trackpad'`。`'auto'` 以外なら判別せず、その値を使う
- 視点の切り替え
  | 入力 | 視点（カメラの位置の向き） | 画面の向き |
  |---|---|---|
  | テンキー 1 | 前（+Z 側から −Z を見る） | 右が +X、上が +Y |
  | Ctrl+テンキー 1 | 後ろ（−Z 側から） | 右が −X、上が +Y |
  | テンキー 3 | 右（+X 側から） | 右が −Z、上が +Y |
  | Ctrl+テンキー 3 | 左（−X 側から） | 右が +Z、上が +Y |
  | テンキー 7 | 上（+Y 側から） | 右が +X、上が −Z |
  | Ctrl+テンキー 7 | 下（−Y 側から） | 右が +X、上が +Z |
  - 注視点と距離は保ったまま、向きだけ変える（なめらかに移る）。キーは `event.code`（`Numpad1` など）で判定する。Mac の Cmd（`metaKey`）も Ctrl と同じに扱う
  - 右下の軸の目印: S1-15 の置き場（`UiShell.gizmoSlot`）に置く。X（赤）・Y（緑）・Z（青）の正の向きに文字付きの球、負の向きに小さい球。メインのカメラと同じ向きで回る。球をクリックすると、その軸の側から見る視点になる（+Y の球 → 上から）
- テンキー 5 で透視投影と平行投影を切り替える。切り替えの前後で、注視点のあたりの見かけの大きさを保つ
- 眺めるモード: ON のあいだ、注視点のまわりを水平に一定の速さ（`WATCH_AZIMUTH_SPEED` = 2π/60 rad/s、1 分で 1 周）で周回する。ユーザーがカメラを操作している間は止まり、最後の操作から 2 秒たつと再開する。状態は `AppState.view` に持つ

## 範囲外
- 入力デバイスと 2 本指スクロールの割り当てを選ぶ設定画面、localStorage への保存（S1-30）。このタスクでは `AppState.settings` に項目と初期値を足すだけ
- 眺めるモードの ON/OFF を切り替える UI（S1-29 のコンテキストメニュー）
- 選択中の物に寄る、全体表示（S1-13）

## 作るもの
- `src/input/wheel.ts`（純粋関数）
  ```ts
  export interface WheelSample {
    deltaX: number; deltaY: number;
    deltaMode: number;   // 0: pixel, 1: line, 2: page
    ctrlKey: boolean;
    timeStamp: number;   // ms
  }
  export type InputDevice = 'mouse' | 'trackpad';
  export type InputDeviceSetting = 'auto' | InputDevice;
  export type TrackpadScroll = 'pan' | 'orbit'; // design.md §7 の Settings.trackpadScroll

  // 状態を持つ判別器。サンプルを順に入れると、その時点の判別結果を返す
  export function createWheelClassifier(): (sample: WheelSample) => InputDevice;

  export type WheelAction =
    | { kind: 'zoom'; factor: number }            // 距離に掛ける倍率。>1 で遠ざかる
    | { kind: 'pan'; dx: number; dy: number }     // 画面のピクセル
    | { kind: 'rotate'; dx: number; dy: number }; // 画面のピクセル
  export function decideWheelAction(
    sample: WheelSample,
    device: InputDevice,
    scroll: TrackpadScroll,
  ): WheelAction;
  ```
  - 判別の目安（初期値は `'mouse'`）
    - トラックパッドの証拠: `deltaMode === 0` で、`deltaX ≠ 0`、または `deltaY` が整数でない、または `ctrlKey` で `deltaY` が整数でない
    - マウスの強い証拠: `deltaMode !== 0`
    - マウスの弱い証拠: `deltaX === 0` で `|deltaY|` が 50 以上の整数
    - トラックパッドの証拠が来たらすぐトラックパッドにする。マウスへ戻すのは、強い証拠が来たとき、または前の `wheel` から 500ms 以上空いた（新しい操作の始まり）ときの弱い証拠だけ。慣性スクロールの途中で揺れないようにするため
  - `ctrlKey` 付きはデバイスによらずズーム。`deltaMode` が 1・2 のときは画素に換算してから倍率を求める
- `src/input/views.ts`（純粋関数）
  ```ts
  export type ViewName = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';
  export function viewFromKey(code: string, ctrlOrMeta: boolean): ViewName | null;
  // 注視点・距離を保ったカメラの位置と、画面の上の向き
  export function poseForView(target: Vec3, distance: number, view: ViewName): { position: Vec3; up: Vec3 };
  export function orthoHeightForDistance(distance: number, fovY: number): number;
  export function distanceForOrthoHeight(height: number, fovY: number): number;
  ```
- `src/input/watch.ts`（純粋関数）
  ```ts
  export const WATCH_AZIMUTH_SPEED = (2 * Math.PI) / 60; // rad/s
  export const WATCH_RESUME_DELAY_MS = 2000;
  // このフレームで方位角を何ラジアン回すか
  export function watchAzimuthDelta(dtSec: number, nowMs: number, lastUserInputMs: number | null): number;
  ```
- `src/render/axis-gizmo.ts`: 軸の目印の描画とクリックの判定
- `AppState` への追加
  - `settings.inputDevice: InputDeviceSetting`（初期値 `'auto'`）、`settings.trackpadScroll: TrackpadScroll`（初期値 `'pan'`）。`settings` の他の欄（design.md §7 の `Settings`）は各担当タスクで足す
  - `view.watchMode: boolean`（初期値 false）。`view.infoOverlay` は S1-23 で足す
- `__gearSim` に追加（design.md §10 の表のとおり）
  ```ts
  getInputDevice(): InputDevice;                // 今使っている（判別した、または固定した）デバイス
  updateSettings(patch: Partial<Settings>): void; // S1-30 で設定画面からも同じ経路を使う
  setWatchMode(on: boolean): void;
  getGizmoTargets(): Array<{ view: ViewName; x: number; y: number }>; // 球の画面上の位置
  ```

## 受け入れ条件
- [x] トラックパッドのピンチでズーム、2 本指スクロールで平行移動する。マウスのホイールは S1-13 のままズームする
- [x] 設定でデバイスを固定でき、2 本指スクロールの割り当てを変えられる
- [x] テンキー 1/3/7（Ctrl で反対側）と軸の目印のクリックで、6 方向の視点に切り替わる
- [x] テンキー 5 で透視投影と平行投影が切り替わり、見かけの大きさがほぼ変わらない
- [x] 眺めるモードで自動でゆっくり周回し、操作中は止まる

## テストケース
### Vitest
- [x] `createWheelClassifier`
  - `{ deltaX: 0, deltaY: 100, deltaMode: 0 }` を 5 回 → すべて `'mouse'`
  - `{ deltaX: 0, deltaY: 3, deltaMode: 1 }` → `'mouse'`
  - `{ deltaX: 1.5, deltaY: 4.25, deltaMode: 0 }` → `'trackpad'`
  - トラックパッドと判別した直後（100ms 後）に `{ deltaX: 0, deltaY: 60, deltaMode: 0 }` → `'trackpad'` のまま（慣性の途中）
  - 同じものを 600ms 空けて → `'mouse'` に戻る
  - トラックパッドの最中でも `deltaMode: 1` が来たら → `'mouse'`
- [x] `decideWheelAction`
  - `ctrlKey: true, deltaY: -10` → zoom で factor < 1。`deltaY: +10` → factor > 1。`-10` と `+10` の factor の積が 1
  - マウス、`deltaY: 100` → zoom で factor > 1。`deltaMode: 1, deltaY: 3` も factor > 1
  - トラックパッド、`scroll: 'pan'`、`deltaX: 5, deltaY: 7` → `{ kind: 'pan', dx: 5, dy: 7 }`（符号の向きはテストで決めて固定する）
  - トラックパッド、`scroll: 'orbit'` → rotate
- [x] `viewFromKey`: `('Numpad1', false)` → front、`('Numpad1', true)` → back、`('Numpad3', false)` → right、`('Numpad7', true)` → bottom、`('Digit1', false)` → null
- [x] `poseForView`: target `[10, 0, 0]`、distance 100 で front → position `[10, 0, 100]`、up `[0, 1, 0]`。top → position `[10, 100, 0]`、up `[0, 0, -1]`。right → position `[110, 0, 0]`。6 方向すべてで position と target の距離が 100
- [x] `orthoHeightForDistance` と `distanceForOrthoHeight` が互いに逆関数になる（往復で `toBeCloseTo`）
- [x] `watchAzimuthDelta`: 入力なしで dt 0.5 → `WATCH_AZIMUTH_SPEED * 0.5`。最後の入力から 1000ms → 0。2000ms 以上 → 再び正の値
### Playwright（`e2e/camera-advanced.spec.ts`）
準備: `e2e/fixtures/two-gears.json` を読み込み、`setCamera` で決まった視点にする。トラックパッドの入力は `page.evaluate` で `canvas.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, deltaMode: 0, ctrlKey, clientX, clientY, bubbles: true, cancelable: true }))` として送る。
- [x] `deltaX: 3.5, deltaY: 7.25` を数回 → `getInputDevice()` が `'trackpad'`、`target` が動き、注視点からの距離は変わらない（平行移動）
- [x] `ctrlKey: true, deltaY: -20` → 距離が縮む
- [x] `updateSettings({ trackpadScroll: 'orbit' })` のあと同じスクロール → `target` は変わらず `position` が変わる
- [x] `updateSettings({ inputDevice: 'mouse' })` のあと `deltaX: 3.5, deltaY: 7.25` → `getInputDevice()` が `'mouse'`、距離が変わる（ズーム）
- [x] `page.mouse.wheel(0, 100)` → `'mouse'` と判別され、距離が増える
- [x] `page.keyboard.press('Numpad7')` → 移り終わった後（`expect.poll`）、`position − target` が +Y 方向（正規化して `[0, 1, 0]` に近い）。距離は押す前と同じ
- [x] `Control+Numpad1` → `position − target` が −Z 方向
- [x] `getGizmoTargets()` の `'right'` の位置をクリック → `position − target` が +X 方向
- [x] `Numpad5` → `getCamera().projection` が `'orthographic'`。2 つの歯車の中心の `projectToScreen` の間隔が、切り替え前と 10% 以内。もう一度押すと `'perspective'` に戻る
- [x] `setWatchMode(true)` → 1 秒後、`position` の方位角（XZ 平面上の角度）が変わり、`target`、距離、`position` の高さは変わらない。`setWatchMode(false)` → その後 500ms は方位角が変わらない

## 人が手で確かめる項目
- Mac のトラックパッド（Chrome と Safari）で、ピンチと 2 本指スクロールが自然に効き、慣性スクロールの途中でズームに化けない
- 普通のマウスのホイールが、トラックパッドと誤判別されない（Windows と Mac で）
- 眺めるモードの速さが鑑賞にちょうどよく、操作のあと 2 秒で静かに再開する
- 軸の目印が見やすく、クリックしやすい大きさである
- 平行投影でズームしたあと透視投影に戻しても、見え方が飛ばない

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（§7 の AppState の項目と `__gearSim` の API が design.md と合っているか確かめる）
- [ ] `status: done` にしてコミットした
