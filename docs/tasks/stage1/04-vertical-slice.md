---
id: S1-04
title: 最小の縦通し: 固定シーンを描画して回す
status: done
depends: [S1-03]
---

# S1-04 最小の縦通し: 固定シーンを描画して回す

## 目的
core → app → render → 画面 → `window.__gearSim` → Playwright の一本道を早めに通し、層の分け方（design.md §7）を固める。完了すると、起動したときに 2 枚の平歯車がかみ合って回り、その角度を Playwright から読める。運動の計算はここでは単純な歯数比の仮のもので、S1-05〜S1-07 で置き換える。

## 範囲
- 固定シーン（起動時に読み込む仮のシーン。`src/app/demo-scene.ts`）
  - `shaft_1`: `root`、`axis: 'y'`、`origin: [0, 20, 0]`
  - `gear_1`: `shaft_1` 上、S・12 歯、`offset 0`
  - `shaft_2`: `mesh`、親 `gear_1`、子 `gear_2`、`angle: π/2`（向きは持たない。親から導いて `'y'`）
  - `gear_2`: `shaft_2` 上、S・24 歯、`offset 0`
  - `motor_1`: `shaft_1` 上、S、60rpm、`direction 1`、`on: true`
  - 起動時の読み込みは S1-27（自動保存からの復元）で置き換える
- 暫定のレイアウト `resolveLayout(scene): Layout`（`src/core/layout/resolve.ts`。design.md §5 の型）
  - `root`・`detached` のシャフトと、そこから `mesh` でたどれる木だけを扱う。`root`・`detached` の向きは `placement.axis`、`mesh` の向きは親のシャフトの向き（`Layout.shafts[id].axis` に入れる）
  - 歯車の中心 = シャフトの原点 + `(offset + 歯幅/2) × 軸`（design.md §4）
  - `mesh` のシャフトの原点 = 親の歯車の負側の面の位置（親のシャフトの原点 + 親の `offset` × 軸）+ `radialDirection(親の軸, angle) × centerDistance`（子の `offset` は 0 なので、子の中心は親の中心と同じ高さに来る）
  - `basePhase` は根の歯車が 0、`mesh` の子は `meshPhase`、子以外の歯車は 0
  - `meshes` は木の親子（`source: 'tree'`）だけ。`interferences` は空（S1-08 が埋める）。`span` は載っている歯車の両端（S1-09 で決め直す）
  - S1-09 が同じファイルを置き換える
- 暫定の運動 `src/app/provisional-motion.ts`
  - ON のモーターが付いたシャフトは無負荷回転数（`rpm × 2π/60 × direction`）で回り、かみ合いの木をたどって `ω_B = −(z_A / z_B)·ω_A` で伝える。モーターが 2 個以上ある連結成分は、最初に見つけたモーターだけを使ってよい
  - 角度は毎フレーム `θ += ω·dt`
  - `MotionState`（design.md §6）を返す。`locks` と `backDriven` は空
  - S1-05・S1-06 が中身を順に差し替え、S1-07 が `stepMotion` で置き換える
- app の小さなストア（`src/app/store.ts`）: `getState` / `dispatch` / `subscribe`（design.md §7）。この時点の `AppState` は `scene` と `motion` だけでよい（他は後のタスクで足す）。`dispatch` は、このタスクでは `loadScene` 相当の内部アクションだけを持つ
- 毎フレームの更新ループ（`requestAnimationFrame`）: 前のフレームからの経過時間 `dt` で運動を進め、render に渡す。`dt` は 0.1 秒で頭打ちにする（タブが裏に回ったときの飛び）
- 描画（`src/render/`）
  - S1-01 の `main.ts` の three の初期化を `src/render/` に移す
  - シーンとレイアウトから Three.js のオブジェクトを同期する。前回と参照が変わった部品だけを作り直す（design.md §7）
  - 歯車: S1-02 の `GeometryCache` の形状を使う。ローカルの x・y・z を、S1-03 の `axisFrame` の `u`・`v`・`w` に合わせて置き、毎フレーム `w` まわりに `basePhase + シャフトの角度` だけ回す（形状は中心が原点、歯幅の方向がローカルの z、0 番目の歯がローカルの +x。中心に穴は無い。design.md §5）
  - シャフト: 細い円柱（太さは render 側の定数で仮に決める）。長さは `span`
  - モーター: シャフトの端に箱を置く程度の仮の見た目（形と位置は S1-24 で整える）
  - 光源とカメラは固定（カメラは全体が入る位置から原点付近を見る）。カメラ操作は S1-13
  - 材質は灰色の `MeshStandardMaterial` 程度でよい（テーマは S1-24）
- `window.__gearSim` に次を足す（design.md §10）
  ```ts
  getScene(): Scene;
  getLayout(): Layout;
  getMotion(): MotionState;
  loadScene(scene: Scene): void;                    // シーンを置き換え、運動の状態を初期化する
  projectToScreen(world: Vec3): { x: number; y: number }; // ページ座標（CSS ピクセル）
  ```

## 範囲外
- 力のつり合い、ロック、複数モーター（S1-05〜S1-07）
- 偶然のかみ合い、干渉、レイアウトの完全版（S1-08・S1-09）
- 編集コマンドと `__gearSim.dispatch`（S1-11 で足す）、選択と `getSelection`（S1-16）
- カメラ操作（S1-13）、画面 UI（S1-15）、テーマと質感（S1-24）

## 作るもの
- `src/core/layout/resolve.ts`（暫定。上を参照）
- `src/app/demo-scene.ts`、`src/app/provisional-motion.ts`、`src/app/store.ts`、`src/app/loop.ts`
- `src/render/`（例: `renderer.ts`、`sync.ts`、`gear-object.ts`）
  ```ts
  export interface SceneView {
    sync(scene: Scene, layout: Layout): void; // 参照が変わった部品だけ作り直す
    update(motion: MotionState, layout: Layout): void; // 毎フレーム、回転角だけ更新
    render(): void;
    projectToScreen(world: Vec3): { x: number; y: number };
  }
  ```
- `src/debug/gear-sim.ts` の拡張
- `e2e/fixtures/two-spur.json`（上の固定シーンと同じもの。`loadScene` で読む用）

## 受け入れ条件
- [x] `pnpm dev` で、12 歯と 24 歯の平歯車がかみ合って回るのが見える（12 歯が反時計回り（上から見て）、24 歯がその半分の速さで逆向き）
- [x] 歯がかみ合った位置で重ならずに回り続ける（位相が合っている）
- [x] `src/core` は three を import していない

## テストケース
### Vitest
- [x] 暫定の `resolveLayout(固定シーン)`: `gear_1.center ≈ [0, 22, 0]`、`gear_2.center ≈ [18, 22, 0]`、`shafts.shaft_2.origin ≈ [18, 20, 0]`、`shafts.shaft_2.axis === 'y'`、`gear_2.basePhase ≡ π/24`（`2π/24` を法として）、`gear_1.pitchRadius === 6`、`meshes` が `[{ a: 'gear_1', b: 'gear_2', source: 'tree' }]`
- [x] 暫定の運動: 固定シーンで `dt = 0.5` を 1 回 → `omegas.shaft_1 ≈ 2π`、`omegas.shaft_2 ≈ −π`、`angles.shaft_1 ≈ π`、`angles.shaft_2 ≈ −π/2`
- [x] 暫定の運動: モーターを `on: false` にしたシーン → 全ての ω が 0
- [x] 暫定の運動: モーターの `direction: -1`、`rpm 30` → `omegas.shaft_1 ≈ −π`、`omegas.shaft_2 ≈ π/2`
- [x] ストア: `subscribe` した関数が `dispatch` のたびに呼ばれ、解除後は呼ばれない
### Playwright
- [x] `e2e/vertical-slice.spec.ts`: `/` を開いて `isReady()` を待つ → `getScene()` が固定シーンに等しい → `getMotion().angles.shaft_1` を読み、0.5 秒以上待ってもう一度読むと増えている
- [x] 同じ spec: `getMotion().omegas` の `shaft_2 / shaft_1 ≈ −0.5`（12 歯と 24 歯）。`shaft_1 ≈ 2π`（60rpm）
- [x] `loadScene` で `two-spur.json` の 24 歯を 36 歯に変えたシーンを読む → `getLayout().gears.gear_2.center ≈ [24, 22, 0]`、`omegas.shaft_2 / omegas.shaft_1 ≈ −1/3`
- [x] `projectToScreen(getLayout().gears.gear_1.center)` がキャンバスの内側の座標を返す
### Playwright（見た目）
- [x] `e2e/visual/two-spur.spec.ts`: 固定シーン → `captureScene(page, 'two-spur')`（真っ黒・真っ白でない）

## 人が手で確かめる項目
- 歯が重ならずにかみ合って見えること（`screenshots/two-spur.png` と `pnpm dev`）
- 歯形がインボリュートらしく見えること、歯の向きの取り違え（裏返し）がないこと

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（`__gearSim` に足した API が design.md §10 と合っているか確かめる。暫定の `resolveLayout`・運動を置き換える担当が S1-09・S1-07 であることを、それぞれの資料で確かめる）
- [x] `status: done` にしてコミットした
