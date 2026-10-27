---
id: S1-07
title: ロック判定と状態の出力
status: todo
depends: [S1-06]
---

# S1-07 ロック判定と状態の出力

## 目的
S1-05・S1-06 の結果から、ロックの判定、負けたモーター、角度の積分までを行い、design.md §6 の `MotionState` を毎フレーム作る純粋関数を用意する。一時停止と手で回す入力もここで受ける。完了すると、app は `stepMotion` を呼ぶだけで、描画（S1-04）・ロックの表示（S1-22）・音（S1-25）・情報表示（S1-23）に必要な運動の状態が得られる。

## 範囲
- `MotionState`・`LockInfo` の型は design.md §6 のとおり。`shaftIds` はロックした成分のシャフト（ID の昇順）、`gearIds` はその成分の歯車（ID の昇順。赤く光らせる対象）
- `stepMotion` の形は design.md §6 のとおり（`stepMotion(scene, layout, prev, dt, opts?: { paused?, hand? })`）。かみ合いのグラフは中で `buildMeshGraph(scene, layout.meshes)` で作る（`layout` の参照が同じなら前回のグラフを使い回してよい）
- ロックの判定（成分ごと。design.md §6）
  - `contradiction`: 自由度 0 の成分に、ON のモーターがある（一時停止中は無いとみなす）
  - `stalemate`: 成分に ON のモーターがあり、つり合いの解で成分の全シャフトの `|ω| < LOCK_OMEGA_EPS`（ON のモーターは速度 0 で `|τ| = T_stall > 0` を出すので、「トルクを出しているモーターがある」を満たす）
  - ロックした成分は `ω = 0`。他の成分には影響しない
- 負けたモーター `backDriven`: ON のモーターのうち、`ω · direction < −LOCK_OMEGA_EPS` のもの（ID の昇順）。ロックした成分のモーターは含まない
- 角度（design.md §6「θ = N q」）
  - 成分ごとに、前の状態の基準シャフト（S1-05 の `referenceShaftIds`）の角度を `q` とみなし、`q += q̇·dt`、全シャフトの角度を `θ = N q` で求め直す。基準シャフト以外の角度を独立に積分しないので、かみ合った歯車の位相がずれない
  - かみ合いの構成が変わったとき（歯車を生やした、削除した、Undo した）も同じ式で求め直す。基準シャフトの角度は保たれ、他のシャフトはそれに合わせて付き直る（子の歯車が跳ぶのは許す）
  - 前の状態に無いシャフト（新しく生やしたもの）が基準シャフトなら、その角度は 0 から始める
  - 自由度 0 の成分の角度は前の値のまま（無ければ 0）
  - 角度は `2π` で折り返さない（折り返すと `θ = N q` の比が崩れる。倍精度で長時間でも足りる）
- 一時停止: `opts.paused` が真なら全モーターを OFF とみなす（S1-06）。ロックも出ない（ON のモーターが無いので）
- **手で回す（純粋関数の部分はこのタスクで作る）**
  - 入力 `opts.hand`（`HandConstraint = { shaftId, angle }`）は「つかんだシャフトの角度をこの値にする」という拘束（無限に強い手。要件 §5）。ポインタの動きを角度に直すのは S1-21
  - つかんだシャフトの成分（段階 1 では自由度 1）: `q` を `(N q)_{つかんだ行} = angle` となるように決め、全シャフトの角度を `θ = N q`、角速度を `(θ_新 − θ_前) / dt`（`dt = 0` なら 0）にする。モーターのつり合いは無視し、`stalemate` のロックは出さない
  - その成分のモーターで、手の向きと逆に回されているものは `backDriven` に入る（判定は上と同じ式）
  - つかんだシャフトの成分が自由度 0 なら、角度を変えずに `contradiction` のロックにする（モーターの有無によらない）
  - 一時停止中でも手で回せる
  - 自由度 2 以上の成分を手で回す場合（残りの自由度をモーターのつり合いで解く）は S3-03 で扱う。このタスクでは例外にしてよい
  - 手を離したら（`hand` が無くなったら）、次のフレームからつり合いの速度に戻る
- app への組み込み: このタスクで `src/app/provisional-motion.ts` を `stepMotion` に置き換え、消す（毎フレーム `resolveLayout` → `stepMotion`）。S1-04 では `stepProvisionalMotion(scene, layout, prev, dt)` を `src/app/loop.ts` の `runFrame`（毎フレーム）と `src/app/store.ts` の `initialMotion`（`loadScene` の直後。`dt = 0` で ω だけ求める）の 2 か所から呼んでいる。後者は `solveMotion` に置き換える。`MotionState`・`LockInfo`・`LockReason` の型と `emptyMotion()` は S1-04 が `src/core/kinematics/types.ts` に置いた（`initialMotionState` はこれを使ってよい）。`opts` は S1-21・S1-22 が `AppState.sim` から渡す。このタスクでは渡さない

## 範囲外
- ロックの赤い表示と震え、干渉の赤い警告、Space での一時停止の操作（S1-22）
- ポインタから角度への変換、つかむ操作（S1-21）
- 音（S1-25）、情報表示（S1-23）
- ウォームの逆駆動・ラックの端・固定具のロック（S2-03、S3-04、S3-01）
- 慣性（要件 §14）

## 作るもの
- `src/core/kinematics/motion.ts`
  ```ts
  export interface HandConstraint { shaftId: ShaftId; angle: number } // つかんだシャフトの目標の角度（rad）
  export interface MotionOptions { paused?: boolean; hand?: HandConstraint }
  export function initialMotionState(): MotionState; // 全て空

  // 角度を進めずに、いまの入力での ω・ロック・負けたモーターを求める（dt = 0 の stepMotion と同じ）
  export function solveMotion(scene: Scene, layout: Layout, prev: MotionState, opts?: MotionOptions): MotionState;

  // 1 フレーム進める（design.md §6）。戻り値の angles・omegas はシーンの全シャフトを含み、シーンに無いシャフトは含まない
  export function stepMotion(scene: Scene, layout: Layout, prev: MotionState, dt: number, opts?: MotionOptions): MotionState;
  ```
- design.md §6 の `MotionState`・`LockInfo`・`HandConstraint` の型を `src/core/kinematics/types.ts` に置く

## 受け入れ条件
- [ ] 要件 §5 のロックの条件のうち、段階 1 の 2 つ（速度 0 のつり合い、回転条件の矛盾）が出る
- [ ] 長く回しても、かみ合った歯車の角度の比が崩れない
- [ ] 一時停止と手で回す入力が、シーンを変えずに運動だけを変える

## テストケース
共通の条件は S1-06 と同じ（大きさ S、`A`(12)–`B`(24) などの書き方）。`A` だけが `root`。`Layout` は `meshes` だけを手で埋めたもの（他の欄は空でよい。S1-09 には依存しない）を渡す。
### Vitest
- [ ] ロックなし: `A`(12)–`B`(24)、`A` に S 60rpm → `locks = []`、`backDriven = []`、`omegas = { A: 2π, B: −π }`
- [ ] stalemate: `A`(12)–`B`(12)、両方に S 60rpm `direction 1` → `locks = [{ reason: 'stalemate', shaftIds: [A, B], gearIds: [A の歯車, B の歯車] }]`、`omegas` は全て 0、`backDriven = []`
- [ ] 歯数比での stalemate: `A`(12)–`B`(36)、`A` に S `direction 1`、`B` に M `direction 1` → `stalemate`
- [ ] ロックしない（同じ向き）: `A`(12)–`B`(12)、`A` に S 60rpm `direction 1`、`B` に S 60rpm `direction −1` → `locks = []`、`ω_A = 2π`
- [ ] contradiction（正三角形の contact）: 12 歯の三角形 `A`・`B`・`C`（`A–B`・`B–C` は `tree`、`A–C` は `contact`。S1-09 の正三角形のシーンと同じ組）、`A` に S 60rpm ON → `[{ reason: 'contradiction', shaftIds: [A, B, C], … }]`、ω は全て 0
- [ ] contradiction にならない: 同じ三角形でモーター無し → `locks = []`。モーターが `on: false` → `[]`。`paused: true` → `[]`
- [ ] ロックは成分ごと: stalemate の成分と、別の成分 `C`(12)–`D`(24)（`C` に S 60rpm）→ ロックは 1 件、`ω_C = 2π`、`ω_D = −π`
- [ ] backDriven: S1-06 の「逆向き・強いほうが勝つ」（`A` に S、`B` に M）→ `backDriven = [A のモーター]`。「ギア比はてこ」→ `backDriven = [C の L のモーター]`
- [ ] 角度の積分: `A`(12)–`B`(24)、`A` に S 60rpm、`initialMotionState()` から `dt = 0.5` を 1 回 → `angles = { A: π, B: −π/2 }`
- [ ] 位相がずれない: 同じシーンで `dt = 1/60` を 10000 回 → `|θ_B + 0.5·θ_A| < 1e-9`、`θ_A ≈ 10000/60 × 2π`（相対誤差 1e-9）
- [ ] 構成の変化: `prev.angles = { A: 1.0, B: 5.0 }`（`B` が新しくつながった状況）で `dt = 0` → `A = 1.0`、`B = −0.5`
- [ ] 新しいシャフト: `prev.angles = { A: 1.0 }` だけで、シーンに `B` がある → `B = −0.5`。シーンから消えたシャフトの角度は戻り値に含まない
- [ ] 基準シャフトの優先: `B` だけが `root` のシーンで `prev.angles = { A: 1.0, B: 0.2 }`、`dt = 0` → `B = 0.2`、`A = −0.4`
- [ ] ロック中の角度: stalemate の成分は `dt = 1` 進めても角度が変わらない
- [ ] 一時停止: `A`(12)–`B`(24)、`A` に S 60rpm、`paused: true`、`dt = 1` → 角度が変わらない、ω は 0、`locks = []`
- [ ] 手で回す: モーター無しの `A`(12)–`B`(24)、`prev` 全て 0、`hand = { shaftId: B, angle: 1.0 }`、`dt = 0.1` → `angles = { A: −2.0, B: 1.0 }`、`omegas = { A: −20, B: 10 }`
- [ ] 手はモーターに勝つ: `A` に S 60rpm `direction 1`、`hand = { shaftId: B, angle: 0 }` を `dt = 0.1` で 3 回 → 角度は 0 のまま、ω は 0、`locks = []`、`backDriven = []`
- [ ] 手で逆に回す: 同じシーン（`A` 12 歯–`B` 24 歯、`A` に S 60rpm `direction 1`）で `hand` の角度を 0 → 0.1 → 0.2（`B` を正 = `A` を負へ）→ `ω_A = −2`、`backDriven = [A のモーター]`
- [ ] 手を離す: 上の続きで `hand` を渡さず、`dt = 0.1` → `ω_A = 2π`、角度は手を離した位置から続く（`θ_A = −0.4 + 0.2π`）
- [ ] 手で回す（ロック中の成分）: stalemate の成分を手で回す → ロックが外れ、手の角度に追従する
- [ ] 手で回す（矛盾）: 12 歯の三角形（モーター無し）の `A` を `hand` で 1.0 へ → 角度は前のまま、`locks` に `contradiction`
- [ ] 一時停止中の手: `paused: true` でも `hand` が効く
- [ ] `solveMotion` は `dt = 0` の `stepMotion` と同じ結果
### Playwright
- [ ] `e2e/fixtures/stalemate.json`（`shaft_1` は `root`・`axis 'y'`・`origin [0, 20, 0]` に S・12 歯、`shaft_2` は `gear_1` の外周 `angle π/2` に S・12 歯、両方に S 60rpm `direction 1`）を `loadScene` → `getMotion().locks[0].reason === 'stalemate'`、0.5 秒待っても `angles` が変わらない
- [ ] `two-spur.json` を読み込む → `locks` が空、`omegas.shaft_2 / omegas.shaft_1 ≈ −0.5`（S1-04 の spec が引き続き通る）

## 人が手で確かめる項目
- なし（ロックの見た目は S1-22）

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`backDriven` の定義と手で回す入力の扱いを design.md §6 に書く。`HandConstraint` の型を design.md §6 に足す。S1-21 の資料に「拘束の解法は S1-07 の `stepMotion` の `hand` 入力を使う」ことが書かれているか確かめる）
- [ ] `status: done` にしてコミットした
