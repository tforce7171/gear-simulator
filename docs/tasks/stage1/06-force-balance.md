---
id: S1-06
title: 力のつり合い
status: doing
depends: [S1-05]
---

# S1-06 力のつり合い

## 目的
要件 §5 の「つながった歯車群ごとに、ギア比を考えた力のつり合いを一次方程式で解いて速度を決める」を実装する。完了すると、モーターが何個あっても、向きや強さが違っても、各シャフトの角速度が決まる。ロックの判定と状態の出力は S1-07 で、これを包んで行う。

## 範囲
- モーターのトルク（design.md §6）
  - `τ = T_stall · (d − ω / ω0)`。`T_stall` は `MOTOR_SIZES[size].stallTorque`、`d` は `direction`、`ω0 = rpm × 2π / 60`（正）、`ω` はモーターが付いたシャフトの角速度
  - `on: false` のモーターは無いものとして扱う（トルクも抵抗も出さない）
- 成分ごとのつり合い
  - シャフトごとに `D_s = Σ T_stall/ω0`、`b_s = Σ T_stall·d`（そのシャフトの ON のモーターの和。段階 1 では高々 1 個）。シャフトに働くトルクは `b − D ω`
  - `ω = N q` を代入して、仮想仕事の原理から `Nᵀ (b − D N q) = 0`、つまり `(Nᵀ D N) q = Nᵀ b` を解く
  - 解が一意でないとき（`Nᵀ D N` が特異。モーターのつながっていない自由度があるとき）は、解のうち **ω の二乗和 `|N q|²` が最小のもの** を取る（design.md §6）。`q` の最小ノルムではない（`N` の基底の取り方に結果が左右されないように）。例: `(Nᵀ D N) q = Nᵀ b` の一般解を `q_p + Z z`（`Z` は `Nᵀ D N` の零空間の基底）と書き、`|N (q_p + Z z)|²` を `z` について最小化する。モーターがつながっていない成分は、これで `ω = 0`（止まったまま）になる
  - 自由度 0 の成分（回転条件の矛盾）とモーターの無い成分は `ω = 0`
- 一時停止: すべてのモーターを OFF とみなして解く（シーンは変えない）
- 戻り値は、つり合いの解そのもの（ロックの判定はしない）。各モーターの解でのトルクも返す（S1-07 のロック判定と「負けたモーター」の判定、S1-25 の音に使う）
- app への組み込み: このタスクで、S1-05 で差し替えた暫定の運動の ω を `solveVelocities` の解にする（角度はまだ `θ += ω·dt`。S1-07 が `stepMotion` に置き換える）
  - S1-05 の時点の `src/app/provisional-motion.ts` は、`graphOf(scene, layout)`（`Layout` をキーにした `WeakMap` で、シーンが変わったときだけ `buildMeshGraph` を作り直す）でグラフを得て、成分ごとに ID の最も小さい ON のモーターの無負荷角速度から `q` を決めている。この `q` の決め方を `solveVelocities` に置き換える

## 範囲外
- ロック（矛盾・速度 0 でのつり合い）の判定、`MotionState` の組み立て、角度の積分、手で回す（S1-07）
- 慣性（要件 §14。`omegas` を状態として持つ構造は S1-07 の `MotionState` で用意する）
- ウォームの逆駆動、固定具（S2-03、S3-01）

## 作るもの
- `src/core/kinematics/motor.ts`
  ```ts
  export function rpmToRadPerSec(rpm: number): number;
  export function radPerSecToRpm(omega: number): number;
  export function motorTorque(motor: Motor, omega: number): number;
  ```
- `src/core/kinematics/balance.ts`
  ```ts
  export interface ShaftDrive { damping: number; bias: number } // D_s と b_s
  // 1 つの成分を解く。basis は S1-05 の KinematicComponent.basis、drives はその行の順
  export function solveBalance(basis: Matrix, drives: readonly ShaftDrive[]): { q: number[]; omegas: number[] };

  export interface BalanceResult {
    omegas: Record<ShaftId, number>;     // シーンの全シャフト
    motorTorques: Record<MotorId, number>; // ON のモーターだけ。解の ω でのトルク
    componentQ: number[][];              // components と同じ順の q
  }
  export function solveVelocities(scene: Scene, graph: MeshGraph, options?: { paused?: boolean }): BalanceResult;
  ```
  - 線形代数は自前の小さな実装でよい（行列は自由度の数の大きさで、段階 1 では 1×1）

## 受け入れ条件
- [ ] 要件 §5 の 3 つの振る舞い（逆向きは強いほうが勝つが遅くなる、同じ向きで速度違いは中間、ギア比はてこ）が、下の数値のとおりに出る
- [ ] モーターがつながっていない成分・自由度は止まったまま

## テストケース
共通の条件: 歯車はすべて大きさ S。「`A`(12)–`B`(12)」は、シャフト `A` の 12 歯とシャフト `B` の 12 歯がかみ合う（`ω_B = −ω_A`）という意味。`Mesh` は手で作り、S1-05 の `buildMeshGraph` に渡す。rpm と rad/s の換算は `ω = rpm × 2π/60`。比較は `toBeCloseTo`（10 桁程度）。
### Vitest
- [ ] `motorTorque`（S、60rpm、`direction 1`）: `ω = 0 → 1`、`ω = π → 0.5`、`ω = 2π → 0`、`ω = −2π → 2`。`direction −1` で `ω = 0 → −1`。L、15rpm、`ω = 0 → 10`
- [ ] 単独: シャフト `A` に S のモーター 60rpm、`direction 1` → `ω_A = 2π`（無負荷回転数）。モーターのトルク 0
- [ ] 歯数比: `A`(12)–`B`(24)、`A` に S 60rpm → `ω_A = 2π`、`ω_B = −π`（−30rpm）
- [ ] 逆向き・強いほうが勝つ: `A`(12)–`B`(12)、`A` に S 60rpm `direction 1`、`B` に M 60rpm `direction 1`（互いに逆へ回そうとする）→ `ω_A = −π`（−30rpm）、`ω_B = π`（+30rpm）。M の単独（60rpm）より遅い。S のモーターは向きと逆に回されている（`ω_A · d_A < 0`）。トルクは S が `1·(1 − (−π)/(2π)) = 1.5`、M が `3·(1 − π/(2π)) = 1.5`（歯数比 1 なので大きさが等しい）
- [ ] 同じ向き・速度違い: `A`(12)–`B`(12)、`A` に S 60rpm `direction 1`、`B` に S 30rpm `direction −1`（どちらも `A` を正に回す向き）→ `ω_A = 4π/3`（40rpm）、`ω_B = −4π/3`。30 と 60 の間
- [ ] 直結なら大きいモーターが勝つ: `A`(12)–`B`(12)、`A` に S 60rpm `direction 1`、`B` に L 15rpm `direction 1` → `ω_A = −18π/41`（≈ −13.171rpm）。L の向き（`B` が正）に回る
- [ ] ギア比はてこ: シャフト `A`・`B`・`C`。`A` に 12 歯、`B` に 60 歯（`A` とかみ合う）と 12 歯、`C` に 60 歯（`B` の 12 歯とかみ合う）。`ω_C = ω_A / 25`。`A` に S 60rpm `direction 1`、`C` に L 15rpm `direction −1`（逆らう向き）→ `ω_A = 150π/133`（≈ 33.835rpm）、`ω_B = −30π/133`、`ω_C = 6π/133`（≈ 1.3534rpm、正）。S が L に勝ち、L は向きと逆に回されている
- [ ] 速度 0 でのつり合い（ロックの判定は S1-07）: `A`(12)–`B`(12)、両方に S 60rpm `direction 1` → `ω_A = ω_B = 0`。片方を 120rpm にしても 0（停動トルクが同じなら速度によらない）
- [ ] 歯数比での相殺: `A`(12)–`B`(36)、`A` に S `direction 1`、`B` に M `direction 1` → `ω = 0`（`1 − 3·(1/3) = 0`）
- [ ] OFF は無いのと同じ: `A`(12)–`B`(24)、`A` に S 60rpm `on: false` → 全て 0。`B` に S 60rpm ON を足す → `ω_B = 2π`、`ω_A = −4π`
- [ ] 一時停止: 歯数比のケースを `paused: true` で → 全て 0。シーンのモーターは `on: true` のまま
- [ ] 駆動されていない成分は止まる: `A`(12)–`B`(24) に S 60rpm（`A`）、別の成分 `C`(12)–`D`(12) にモーターなし → `ω_C = ω_D = 0`、`ω_A = 2π`
- [ ] 複数の成分を一度に: 上に、M 30rpm `direction −1` の付いた単独のシャフト `E` を足す → `ω_E = −π`、他は変わらない
- [ ] 回転条件の矛盾: 12 歯の三角形 `A`・`B`・`C` の `A` に S 60rpm → 全て 0
- [ ] `solveBalance` を手で作った自由度 2 の基底で（段階 3 の遊星歯車を想定）: `basis = [[1, 0], [0, 1], [0.5, 0.5]]`
  - シャフト 0 に `{damping: 1/(2π), bias: 1}`、シャフト 1 に `{damping: 1/(2π), bias: −1}`、シャフト 2 は 0 → `omegas = [2π, −2π, 0]`
  - シャフト 0 だけに `{damping: 1/(2π), bias: 1}` → `q₀ = 2π` に決まり、`q₁` は自由。ω の二乗和 `q₁² + (π + q₁/2)²` を最小にして `q = [2π, −0.4π]`、`omegas = [2π, −0.4π, 0.8π]`（`q` の最小ノルムの解 `[2π, 0]`・`omegas = [2π, 0, π]` にはならない）
  - シャフト 2 だけに `{damping: 1/(2π), bias: 1}` → `q₀ + q₁ = 4π` で、ω の二乗和が最小の `q = [2π, 2π]`、`omegas = [2π, 2π, 2π]`
  - 同じ零空間を別の基底 `[[1, 1], [0, 1], [0.5, 1]]`（列を足し合わせたもの）で渡しても、上の 2 つの `omegas` が変わらない（基底の取り方に左右されない）
  - 全て 0 → `omegas = [0, 0, 0]`
- [ ] `motorTorques` は ON のモーターだけを含み、`逆向き・強いほうが勝つ` のケースで `{ S のモーター: 1.5, M のモーター: 1.5 }`
### Playwright
- [ ] `e2e/fixtures/opposing-motors.json`（`shaft_1` は `root`・`axis 'y'`・`origin [0, 20, 0]` に S・12 歯、`shaft_2` は `gear_1` の外周 `angle π/2` に S・12 歯。`shaft_1` に S 60rpm `direction 1`、`shaft_2` に M 60rpm `direction 1`）を `loadScene` → `getMotion().omegas.shaft_1 ≈ −π`、`shaft_2 ≈ π`

## 人が手で確かめる項目
- なし

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（OFF のモーターの扱いと、解が一意でないときの解の選び方が design.md §6 と合っているか確かめる）
- [ ] `status: done` にしてコミットした
