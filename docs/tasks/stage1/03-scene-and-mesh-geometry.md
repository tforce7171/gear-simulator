---
id: S1-03
title: シーンのデータ形式と、かみ合いの幾何
status: todo
depends: [S1-02]
---

# S1-03 シーンのデータ形式と、かみ合いの幾何

## 目的
全タスクが使うシーンの型（design.md §4）と、2 枚の平歯車を正しくかみ合わせるための幾何（ピッチ円半径、中心距離、外周の向き、位相）を純粋関数として用意する。完了すると、親の歯車と角度から子の歯車の位置と位相を求められ、それが S1-02 の歯形で実際に重ならないことを確かめられる。

## 範囲
- `core/math`: `Vec3` と最小限の演算（足し算、引き算、スカラー倍、内積、外積、長さ）
- 軸の座標系（design.md §2 の「回転の正の向き＝右ねじ」に合わせる）
  - 軸 `w` ごとに、軸に垂直な平面の基底 `u`・`v` を決める。`u × v = w` となる右手系
    - `'x'`: `u = +Y`、`v = +Z`、`w = +X`
    - `'y'`: `u = +Z`、`v = +X`、`w = +Y`
    - `'z'`: `u = +X`、`v = +Y`、`w = +Z`
  - 軸まわりの角度 `angle` の方向は `cos(angle)·u + sin(angle)·v`。`angle` が増える向きが回転の正の向き
  - S1-02 の 2D 輪郭の x・y は、この `u`・`v` に対応させる（S1-04 の描画もこれに従う）
- `core/scene`: design.md §4 の型（`Scene`・`Shaft`・`ShaftPlacement`・`Gear`・`Motor`・各 ID・`Axis`・`SizeKey`）、空のシーン、ID の生成、シーンの検証
- `core/geometry/mesh.ts`: ピッチ円半径、歯先円半径、中心距離、かみ合う位相、位相の比較
- `src/core/constants.ts` に `MESH_PHASE_EPS` を design.md §3 の表の値（1e-6 rad）で足す。位相を歯のピッチを法として比べるときのしきい値（木の親子の位相の確認、テストでの比較に使う。偶然のかみ合いの判定には使わない。design.md §5）
- 位相（basePhase）の取り決め
  - 歯車の回転角 = `basePhase + シャフトの回転角`。回転角 0 のとき、0 番目の歯の中心線が `u` の向き（S1-02 の +x）にある
  - 親 A（位相 `φ_A`、歯数 `z_A`）の軸まわりの角度 `α` の方向に子 B（歯数 `z_B`）を置くとき、A の歯と B の歯の谷が向き合うように `φ_B` を決める
    - `f_A = frac((α − φ_A)·z_A / 2π)`（A の歯の並びの中での、接点の位置。0〜1）
    - `φ_B = α + π − (2π / z_B)·(1/2 − f_A)` を `[0, 2π/z_B)` に正規化する
  - この取り決めでは、シャフトの回転角が `θ_B = −(z_A / z_B)·θ_A` の関係を保つ限り、かみ合いが保たれる
- シャフトの向き: `Shaft` は `axis` を持たない。`root`・`detached` は `placement.axis`、`mesh` は親の歯車のシャフトの向き（段階 1 の平歯車では親と同じ）。向きを求める補助関数 `shaftAxis(scene, shaftId)` を `core/scene` に置く（親をたどる。S1-09 以降の `Layout.shafts[id].axis` も同じ値になる）
- 歯車の中心: `シャフトの原点 + (offset + 歯幅/2) × 軸`（`offset` は歯幅の負側の面の位置。design.md §4）
- シーンの検証（不正なら理由の一覧を返す。例外にしない）
  - `Record` のキーと各要素の `id` が一致する
  - 参照先が存在する（`gear.shaftId`、`motor.shaftId`、`placement.parentGearId`、`placement.childGearId`）
  - `teeth` が整数で、その大きさの範囲（`GEAR_SIZES`）に入る
  - `motor.rpm` が `MOTOR_RPM_RANGE` に入る。`direction` が `1` か `-1`
  - 1 本のシャフトにモーターは高々 1 個
  - `mesh` のシャフト: `childGearId` の歯車がそのシャフトに載っていて `offset === 0`。`parentGearId` の歯車は別のシャフトにある。親と子の大きさが同じ
  - `root`・`detached` の `axis` が `'x' | 'y' | 'z'` のどれか
  - `offset` が `AXIAL_SNAP` の倍数
  - `mesh` の親子をたどると、必ず `root` か `detached` のシャフトに行き着く（循環しない）
  - 数値はすべて有限（`origin`、`offset`、`angle`、`rpm`）
  - 歯車が 1 枚も載っていないシャフトは不正としない（検証は通す）

## 範囲外
- 木構造の位置の計算（`resolveLayout`）、偶然のかみ合い（contact）、干渉（S1-08・S1-09）
- 運動の計算（S1-05〜S1-07）
- 編集コマンド（S1-11）
- 保存形式の検証とバージョン移行（S1-28。ここで作る `validateScene` を使う）

## 作るもの
- `src/core/math/vec3.ts`
  ```ts
  export type Vec3 = readonly [number, number, number];
  export function add(a: Vec3, b: Vec3): Vec3;
  export function sub(a: Vec3, b: Vec3): Vec3;
  export function scale(a: Vec3, s: number): Vec3;
  export function dot(a: Vec3, b: Vec3): number;
  export function cross(a: Vec3, b: Vec3): Vec3;
  export function length(a: Vec3): number;
  ```
- `src/core/math/axis.ts`
  ```ts
  export function axisVector(axis: Axis): Vec3;                          // w
  export function axisFrame(axis: Axis): { u: Vec3; v: Vec3; w: Vec3 };
  export function radialDirection(axis: Axis, angle: number): Vec3;      // cos·u + sin·v
  ```
- `src/core/scene/types.ts`（design.md §4 の型をそのまま）
- `src/core/scene/ids.ts`
  ```ts
  export type IdKind = 'shaft' | 'gear' | 'motor';
  export type IdGenerator = (kind: IdKind) => string; // "shaft_xxx" の形
  export function createRandomIdGenerator(random?: () => number): IdGenerator;
  // テスト用。種類ごとに 1 から数える: "shaft_1", "shaft_2", "gear_1", ...
  export function createSequentialIdGenerator(): IdGenerator;
  ```
- `src/core/scene/scene.ts`
  ```ts
  export function emptyScene(): Scene;
  ```
- `src/core/scene/validate.ts`
  ```ts
  export interface SceneError {
    code: string;      // 例 'missingRef' | 'teethOutOfRange' | 'meshCycle' | ...（実装で決める）
    id?: string;       // 問題のある部品
    path?: string;     // 問題の場所（例 'gears.gear_1.teeth'）。S1-28 のエラー表示で使う
    message: string;   // 開発者向け（英語でよい。UI には出さない）
  }
  export function validateScene(scene: Scene): { ok: true } | { ok: false; errors: SceneError[] };
  ```
- `src/core/geometry/mesh.ts`
  ```ts
  export function pitchRadius(size: SizeKey, teeth: number): number;
  export function outsideRadius(size: SizeKey, teeth: number): number;       // 歯先円半径
  export function centerDistance(size: SizeKey, teethA: number, teethB: number): number;
  export function toothPitchAngle(teeth: number): number;                    // 2π / z
  // 親の位相・歯数、子の歯数、親の軸まわりの角度から、子の basePhase を [0, 2π/z_B) で返す
  export function meshPhase(parentPhase: number, parentTeeth: number, childTeeth: number, angle: number): number;
  // 2 つの位相が 2π/teeth を法として MESH_PHASE_EPS 以内で一致するか
  export function samePhase(a: number, b: number, teeth: number): boolean;
  ```
- `src/core/scene/shaft-axis.ts`
  ```ts
  // root / detached は placement.axis、mesh は親をたどって求める（循環していれば null）
  export function shaftAxis(scene: Scene, shaftId: ShaftId): Axis | null;
  ```
- S1-02 の `gearShapeKey` などの引数の型を `SizeKey` に差し替える

## 受け入れ条件
- [ ] design.md §4 の型が `src/core/scene/types.ts` にあり、以降のタスクはここから import できる
- [ ] 位相を合わせた 2 枚の歯形が、回しても重ならない（下のテスト）

## テストケース
### Vitest
- [ ] `axisFrame` の 3 つとも `cross(u, v)` が `w` に一致する
- [ ] `radialDirection('y', 0) ≈ [0, 0, 1]`、`radialDirection('y', π/2) ≈ [1, 0, 0]`、`radialDirection('x', 0) ≈ [0, 1, 0]`、`radialDirection('z', π/2) ≈ [0, 1, 0]`
- [ ] `pitchRadius('S', 12) === 6`、`pitchRadius('M', 20) === 20`、`outsideRadius('L', 16) === 27`
- [ ] `centerDistance('S', 12, 24) === 18`、`centerDistance('M', 12, 12) === 24`、`centerDistance('L', 40, 12) === 78`
- [ ] `meshPhase(0, 12, 24, 0) ≈ π/24`（偶数の歯数の子は半ピッチずらす）
- [ ] `meshPhase(0, 12, 13, 0) ≡ 0`（奇数の歯数の子は位相 0 で谷が向き合う。丸め誤差で `2π/13` の直前になりうるので、`2π/13` を法として比べる。以下の位相の比較もすべて同じ）
- [ ] `meshPhase(π/24, 12, 24, 0) ≈ π/48`（親が 1/4 ピッチ回っていると、子は `−(12/24)·π/24` だけずれる）
- [ ] `meshPhase(0, 12, 24, π/2) ≈ π/24`
- [ ] 周期性: 任意の `φ_A` について `meshPhase(φ_A + 2π/z_A, …)` と `meshPhase(φ_A, …)` が一致する
- [ ] 転がり: `meshPhase(φ_A + δ, z_A, z_B, α) ≡ meshPhase(φ_A, z_A, z_B, α) − (z_A/z_B)·δ`（`2π/z_B` を法として。δ = 0.01, 0.1）
- [ ] `samePhase(0, 2π/13 − 1e-9, 13) === true`（法の境目）、`samePhase(0, 0.01, 13) === false`、`samePhase(π/24, π/24 + 2π/24, 24) === true`
- [ ] `shaftAxis`: `root`（`axis 'x'`）の子の `mesh`、さらにその子 → どちらも `'x'`。`detached`（`axis 'z'`）→ `'z'`
- [ ] 歯形が重ならない（S1-02 の `spurOutline` を使う 2D の検査）
  - A: 大きさ S・20 歯、中心 (0, 0)、位相 0。B: 大きさ S・30 歯、角度 α の方向に `centerDistance('S', 20, 30) = 25` の位置、位相 `meshPhase(0, 20, 30, α)`
  - α ∈ {0, 0.7, 2.5} と、A の回転角 θ_A ∈ {0, 0.05, 0.13, 1.0}（B は `−(20/30)·θ_A`）の全ての組で、一方の輪郭の頂点が他方の輪郭の内側に 1e-3·m より深く入らない
  - 同じ配置で B の位相を半ピッチ（π/30）ずらすと、内側に深く入る頂点がある（検査が効いていることの確認）
  - 歯数の少ない組（12 歯どうし）は歯元の簡略化で重なりうるので、この検査には使わない
- [ ] `createSequentialIdGenerator()`: `gen('shaft') → 'shaft_1'`、`gen('gear') → 'gear_1'`、`gen('shaft') → 'shaft_2'`
- [ ] `createRandomIdGenerator()`: `'gear_'` で始まり、1000 回呼んで重複しない
- [ ] `validateScene`
  - `emptyScene()` → ok
  - 起点のシャフト 1 本（`axis: 'y'`、`origin: [0, 0, 0]`）と S・12 歯の歯車 1 枚、S のモーター（60rpm）→ ok
  - 上に `mesh` のシャフト（親 = その歯車、子 = 新しい S・24 歯、`offset 0`、`angle π/2`）を足す → ok
  - 子の歯車の `offset` が 4 → エラー（`childGearId`）
  - 子の大きさが M → エラー
  - 歯車の `offset` が 2（`AXIAL_SNAP` の倍数でない）→ エラー。`offset −8` → ok
  - `root` の `axis` が `'w'` → エラー
  - 歯数 11（S）・81（S）・12.5 → エラー。歯数 40（L）→ ok、41（L）→ エラー
  - `rpm` 0・121 → エラー、`direction` 0 → エラー
  - 1 本のシャフトにモーター 2 個 → エラー
  - 存在しない `shaftId` を持つ歯車 → エラー
  - 2 本の `mesh` のシャフトが互いを親にする（循環）→ エラー
  - キー `'gear_1'` に `id: 'gear_2'` の歯車 → エラー
  - エラーは 1 つで止めず、全部列挙する（上の 2 つを同時に含むシーン → 2 件以上）
### Playwright
- なし

## 人が手で確かめる項目
- なし

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（軸の基底 `u`・`v`、角度の向き、basePhase の定義と式を design.md §2・§5 に書く）
- [ ] `status: done` にしてコミットした
