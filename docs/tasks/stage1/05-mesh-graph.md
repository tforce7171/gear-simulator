---
id: S1-05
title: 運動学: かみ合いのグラフ、速度比、矛盾の検出
status: done
depends: [S1-04]
---

# S1-05 運動学: かみ合いのグラフ、速度比、矛盾の検出

## 目的
かみ合いの組から、シャフトの角速度の間の拘束（design.md §6）を作り、その零空間の基底 `N`（`ω = N q`）を求める。完了すると、どのシャフトがどの比で一緒に回るか、回転方向、三角形などの回転条件の矛盾が分かる。S1-06（力のつり合い）、S1-07（ロックと角度）、S1-23（情報表示のギア比）がこれを使う。

## 範囲
- かみ合いのグラフ
  - 頂点はシャフト（design.md §6「剛体の単位はシャフト」）。辺は `Mesh`（歯車の組）を、それぞれの歯車が載ったシャフトの組に読み替えたもの
  - 同じ 2 本のシャフトの間に複数の `Mesh` があってよい（多重辺）
  - 連結成分ごとに分ける。歯車もかみ合いも無いシャフトも 1 つの成分になる
- 拘束行列
  - 外歯車どうしの `Mesh` 1 つにつき 1 行: `z_a·ω_{shaft(a)} + z_b·ω_{shaft(b)} = 0`
  - 成分ごとに、その成分のシャフトだけを列に持つ行列を作る
- 零空間の基底 `N`（成分ごとに、行 = シャフト、列 = 自由度）
  - 自由度 `k` = 零空間の次元。段階 1（平歯車だけ）では成分ごとに 0 か 1 になるが、関数は一般の `k` を扱う（段階 3 の遊星歯車で 2 以上になる）
  - **基準シャフト**: `k` 本のシャフトを選び、その行が単位行列になるように `N` を作る（`q` = 基準シャフトの角速度、となる）。選ぶ順は、配置が `root` か `detached` のシャフトを先に、次に ID の昇順。その順に見て、それまでに選んだ行と独立になるものを取る
  - `k = 0`（零空間が自明）の成分は「回転条件の矛盾」。`N` は列が 0 本の行列
- 数値の扱い
  - 係数は整数（歯数）なので、階数の判定は相対誤差 1e-9 程度のしきい値で行う（矛盾を見逃さず、正しいループを矛盾と誤判定しない）
- 速度比と回転方向
  - 自由度 1 の成分の中の 2 本のシャフトについて、`ω_to / ω_from` を返す。負なら逆向き
  - 成分が違う、`k ≠ 1`、または `from` の行が 0 なら `null`
- 偶然のかみ合い（`source: 'contact'`）も木の親子と同じ拘束として扱う（位相は問わない。design.md §5）。三角形の矛盾は contact から生まれる
- app への組み込み: このタスクで、S1-04 の暫定の運動の伝え方を `buildMeshGraph` の基底に置き換える（シーンが変わったときだけグラフを作り直す。成分ごとに、最初の ON のモーターの無負荷角速度からそのシャフトの行で `q` を決め、`ω = N q`。自由度 0 の成分は止める。角度は S1-04 のまま `θ += ω·dt`）。S1-06 がつり合いに、S1-07 が `stepMotion` に置き換える

## 範囲外
- 力のつり合い・モーター（S1-06）
- ロックの判定と出力、角度の積分、手で回す（S1-07）
- `Mesh` の列挙（偶然のかみ合いを含む）は S1-09 の `resolveLayout` の仕事。このタスクは `Mesh[]` を入力として受ける
- 内歯車（同じ向き: `z_a·ω_a − z_b·ω_b = 0`）、かさ歯車、ウォームなどの拘束（S2・S3 の各タスク。拘束の行を作る所を差し替えやすくしておく）

## 作るもの
- `src/core/kinematics/linalg.ts`
  ```ts
  export type Matrix = number[][]; // 行の配列
  // a の零空間の基底を、列ベクトルを並べた行列（行数 = a の列数）で返す
  export function nullSpace(a: Matrix, columns: number, relTol?: number): Matrix;
  export function rank(a: Matrix, columns: number, relTol?: number): number;
  ```
  - 行が 0 本の行列も受ける（`columns` を別に渡すのはそのため）
- `src/core/kinematics/graph.ts`
  ```ts
  export interface KinematicComponent {
    shaftIds: ShaftId[];          // ID の昇順
    gearIds: GearId[];            // この成分のシャフトに載った歯車。ID の昇順
    meshes: Mesh[];               // この成分の中のかみ合い
    basis: Matrix;                // shaftIds.length 行 × dof 列。ω = basis · q
    dof: number;                  // 0 なら回転条件の矛盾
    referenceShaftIds: ShaftId[]; // 長さ dof。basis のこの行が単位行列
  }
  export interface MeshGraph {
    components: KinematicComponent[];               // 先頭のシャフトの ID の昇順
    componentOfShaft: Readonly<Record<ShaftId, number>>; // components の添字
  }
  export function buildMeshGraph(scene: Scene, meshes: readonly Mesh[]): MeshGraph;

  // ω_to / ω_from。比が決まらなければ null
  export function speedRatio(graph: MeshGraph, from: ShaftId, to: ShaftId): number | null;
  ```
  - `meshes` に、シーンに無い歯車や同じシャフトの歯車どうしの組が来たら例外にしてよい（呼ぶ側の不具合）

## 受け入れ条件
- [x] シーンと `Mesh[]` から、成分・基底・自由度・基準シャフトが決定的に（同じ入力なら同じ順で）求まる
- [x] 偶数のループは自由度 1、奇数のループや比の食い違う多重辺は自由度 0 になる

## テストケース
テストのシーンはすべて大きさ S。`Mesh` は手で作って渡す（S1-09 には依存しない）。シャフト `A`・`B`・… は ID の昇順に並ぶ名前にする（例 `shaft_a`）。特に書かない限り `A` だけが `root`、他は `mesh`。
### Vitest
- [x] `nullSpace([[1, 1]], 2)` → 1 列で、`(1, −1)` に比例
- [x] `nullSpace([[1, 0], [0, 1]], 2)` → 0 列
- [x] `nullSpace([], 3)` → 3 列で階数 3
- [x] `nullSpace([[12, 24], [24, 12]], 2)` → 0 列。`nullSpace([[12, 24], [12, 24]], 2)` → 1 列
- [x] 歯車の無いシャフト 1 本 → 成分 1 つ、`basis = [[1]]`、`dof 1`、`referenceShaftIds = [A]`
- [x] `A`(12 歯) – `B`(24 歯) → `dof 1`、`A` の行 1、`B` の行 −0.5、`speedRatio(A, B) ≈ −0.5`、`speedRatio(B, A) ≈ −2`
- [x] 基準シャフトの優先: 同じ組で `B` だけを `root`、`A` を `mesh` にする → `referenceShaftIds = [B]`、`B` の行 1、`A` の行 −2
- [x] 歯車列: `A`(12) – `B`(24)、`B` に 12 歯も載せて `C`(36) とかみ合う → `speedRatio(A, C) ≈ (−12/24)·(−12/36) = 1/6`（同じ向き）
- [x] 三角形（正三角形の contact）: `A`・`B`・`C` に 12 歯を 1 枚ずつ。`A–B`・`B–C` は `source: 'tree'`、`A–C` は `source: 'contact'`（S1-09 の正三角形のシーンと同じ組）→ 成分 1 つ、`dof 0`、`basis` は 3 行 0 列、`speedRatio(A, B) === null`
- [x] 同じ三角形から contact の `A–C` を除く → `dof 1`（contact の辺が矛盾を生んでいる）
- [x] 四角形: 12 歯 4 枚が `A–B`、`B–C`、`C–D`、`D–A` でかみ合う → `dof 1`、行が `1, −1, 1, −1`
- [x] 多重辺（矛盾）: `A` に 12 歯と 24 歯、`B` に 24 歯と 12 歯。`A12–B24` と `A24–B12` の 2 組 → `dof 0`
- [x] 多重辺（整合）: `A` に 12 歯 2 枚、`B` に 24 歯 2 枚。`A12–B24` を 2 組 → `dof 1`、`speedRatio(A, B) ≈ −0.5`
- [x] 非連結: `A–B`(12–24)、`C–D`(12–12)、歯車の無い `E` → 成分 3 つ、`componentOfShaft` が正しい、`speedRatio(A, C) === null`
- [x] 長い減速の列: シャフト 10 本。1 本目に 12 歯、2〜9 本目に 80 歯（前段から受ける）と 12 歯（次段へ渡す）、10 本目に 80 歯。9 組のかみ合い → `dof 1`、`speedRatio(1 本目, 10 本目) = (−12/80)^9 ≈ −3.8443e-8` と相対誤差 1e-9 で一致する
- [x] 同じ入力を 2 回渡すと、`components` の順・`shaftIds` の順・`basis` が完全に一致する
### Playwright
- [x] S1-04 の `e2e/vertical-slice.spec.ts` が、運動の伝え方を置き換えた後も変えずに通る

## 人が手で確かめる項目
- なし

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（基準シャフトの選び方と `N` の作り方が design.md §6 と合っているか確かめる）
- [x] `status: done` にしてコミットした
