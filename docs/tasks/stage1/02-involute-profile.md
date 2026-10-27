---
id: S1-02
title: インボリュート歯形の生成と形状データの共有
status: done
depends: [S1-01]
---

# S1-02 インボリュート歯形の生成と形状データの共有

## 目的
要件 §8「歯形はインボリュート曲線から実行時に生成する。歯数と大きさが同じ歯車は形状データを共有する」を満たす土台を作る。歯形の 2D 輪郭は純粋関数として `core` に置き、Three.js の形状データ（`BufferGeometry`）への変換と共有は `render` に置く。完了すると、任意の (大きさ, 歯数) の平歯車の形状を作れる。

## 範囲
- 平歯車の寸法（ピッチ円・基礎円・歯先円・歯底円の半径）の計算
  - ピッチ円半径 `r = m·z/2`、基礎円半径 `r_b = r·cos(PRESSURE_ANGLE)`、歯先円半径 `r_a = r + m`、歯底円半径 `r_f = r − 1.25·m`
- 2D の歯形の輪郭（閉じた多角形）
  - 圧力角 20°（`PRESSURE_ANGLE`）、転位なし、バックラッシなし（ピッチ円上の歯厚 = 歯の間の幅 = `π·m/2`）
  - 歯面はインボリュート曲線。歯面の半径方向の範囲は `max(r_b, r_f)` から `r_a` まで
  - 歯元の簡略化: `r_b > r_f` のとき（歯数が少ないとき）、基礎円より内側は半径方向の直線で歯底円まで下ろす。歯底は歯底円の円弧（折れ線）でつなぐ。切り下げは再現しない（要件 §3.2）
  - 歯先は歯先円の円弧（折れ線）
- 輪郭の向きの取り決め（S1-03 の位相と S1-04 の描画がこれに従う）
  - 2D の座標 (x, y)。歯車の中心が原点
  - 0 番目の歯の中心線が +x 軸に乗る（輪郭は x 軸について対称）
  - 点の並びは反時計回り（符号付き面積が正）。最後の点で最初の点を繰り返さない
- 形状を共有するためのキーと、`render` 側のキャッシュ
  - キーは `(種類, 大きさ, 歯数)`。種類は段階 1 では `'spur'` だけ
  - `render` 側で 2D 輪郭を歯幅の分だけ押し出した `BufferGeometry` を作り、同じキーなら同じインスタンスを返す

## 範囲外
- シーンの型、`SizeKey` の定義（S1-03。このタスクでは `module` と `teeth` の数値で受ける。キャッシュのキーだけ `'S' | 'M' | 'L'` の文字列を受け、型は S1-03 で `SizeKey` に差し替える）
- かみ合う位相の計算と、2 枚の歯形が重ならないことの確認（S1-03）
- 材質・テーマ・見た目の作り込み（S1-24）
- 画面に描く（S1-04）
- ハスバ歯車などのねじれた歯形（S2-01 以降）

## 作るもの
- `src/core/geometry/involute.ts`
  ```ts
  export type Vec2 = readonly [number, number];

  export interface SpurDimensions {
    module: number;
    teeth: number;
    pitchRadius: number;
    baseRadius: number;
    addendumRadius: number; // 歯先円
    dedendumRadius: number; // 歯底円
  }
  export function spurDimensions(module: number, teeth: number): SpurDimensions;

  // インボリュート関数 inv(α) = tan α − α
  export function involuteFn(alpha: number): number;

  // 半径 r（r ≥ r_b）での、歯の中心線から歯面までの角度（歯厚の半分の角度）
  // ψ(r) = π/(2z) + inv(PRESSURE_ANGLE) − inv(acos(r_b / r))
  export function toothHalfAngleAt(module: number, teeth: number, r: number): number;

  export interface OutlineOptions {
    flankSegments?: number; // 歯面 1 本を何本の線分で近似するか（初期値は実装で決める。例 8）
    tipSegments?: number;   // 歯先の円弧の分割数（例 2）
    rootSegments?: number;  // 歯底の円弧の分割数（例 3）
  }
  // 閉じた多角形。反時計回り。0 番目の歯が +x 軸の上
  export function spurOutline(module: number, teeth: number, options?: OutlineOptions): Vec2[];
  ```
- `src/core/geometry/shape-key.ts`
  ```ts
  export type GearKind = 'spur';
  export function gearShapeKey(kind: GearKind, size: 'S' | 'M' | 'L', teeth: number): string; // 例 "spur:S:12"
  ```
- `src/render/gear-geometry.ts`
  ```ts
  // 2D 輪郭を、ローカルの z 方向に歯幅の分だけ押し出す。z は −faceWidth/2 〜 +faceWidth/2
  // ローカルの x・y は 2D 輪郭の x・y と同じ
  export function buildSpurGeometry(size: 'S' | 'M' | 'L', teeth: number): BufferGeometry;

  export interface GeometryCache {
    acquire(kind: GearKind, size: 'S' | 'M' | 'L', teeth: number): BufferGeometry; // 同じキーなら同じインスタンス
    release(kind: GearKind, size: 'S' | 'M' | 'L', teeth: number): void;          // 使う所が 0 になったら dispose
    size(): number; // 保持しているキーの数（テスト用）
  }
  export function createGeometryCache(): GeometryCache;
  ```
  - 中心にシャフトを通す穴を開けるかどうかは任せる（開けるなら半径は S1-04 のシャフトの太さに合わせる）

## 受け入れ条件
- [x] 大きさ S/M/L それぞれの最小・最大の歯数で、輪郭が作れる（例外にならない、自己交差しない）
- [x] 同じキーで `acquire` すると同じ `BufferGeometry` が返り、すべて `release` すると `dispose` される
- [x] `src/core/geometry/` は three を import していない（S1-01 の規則で確かめられる）

## テストケース
### Vitest
- [x] `spurDimensions(1, 12)` → `pitchRadius 6`、`baseRadius ≈ 5.638156`、`addendumRadius 7`、`dedendumRadius 4.75`
- [x] `spurDimensions(3, 40)` → `pitchRadius 60`、`baseRadius ≈ 56.381557`、`addendumRadius 63`、`dedendumRadius 56.25`
- [x] `involuteFn(PRESSURE_ANGLE) ≈ 0.0149044`
- [x] `toothHalfAngleAt(1, 12, 6) ≈ π/24`（ピッチ円上の歯厚は半ピッチ）。`toothHalfAngleAt(1, 12, 7) ≈ 0.0443499`、`toothHalfAngleAt(1, 80, 41) ≈ 0.0097432`、`toothHalfAngleAt(2, 20, 22) ≈ 0.0315855`（歯先が尖っていない = 正）
- [x] `spurOutline(1, 12)`
  - 全点の半径が `[4.75, 7]` に入る（誤差 1e-9）。最大の半径は 7、最小は 4.75
  - 符号付き面積が正（反時計回り）
  - 点数が 12 の倍数で、点 i を 2π/12 回すと点 i + 点数/12 に一致する（12 回対称）
  - y を反転した点の集合が元の集合と一致する（x 軸について対称）
  - 歯面の点（半径が `max(r_b, r_f)` 以上 `r_a` 未満で、歯先・歯底の円弧上でない点）の極角の絶対値が、最寄りの歯の中心線から `toothHalfAngleAt(1, 12, 半径)` に一致する（誤差 1e-9）
  - 自己交差しない（全ての辺の組で交差判定）
- [x] `spurOutline(1, 80)`（`r_f > r_b` の場合）: 全点の半径が `[38.75, 41]` に入り、歯面の最も内側の点の半径が 38.75（基礎円 37.588 ではない）
- [x] `spurOutline(1, 12)` の 0 番目の歯: 基礎円より内側の点（半径 < 5.638156）は極角が `±toothHalfAngleAt(1, 12, r_b) ≈ ±0.145804` の直線上にある（半径方向の簡略化）
- [x] 全ての大きさの最小・最大の歯数（S 12/80、M 12/60、L 12/40）で、自己交差しない・半径の範囲に入る
- [x] `gearShapeKey('spur', 'S', 12) === 'spur:S:12'`、`'spur:M:12'` とは異なる
- [x] `buildSpurGeometry('M', 20)`（node 環境で three を使う）: バウンディングボックスの z が `[−4, 4]`、x・y の絶対値の最大が歯先円半径 22 以下（誤差 1e-6）で 22 に近い
- [x] `createGeometryCache()`: `acquire('spur','S',12)` を 2 回 → 同じインスタンス、`size() === 1`。`acquire('spur','S',13)` → 別のインスタンス、`size() === 2`。`'S',12` を 2 回 `release` → その geometry の `dispose` が呼ばれ（`dispose` イベントで確認）、`size() === 1`
### Playwright
- なし（描画は S1-04 で確かめる）

## 人が手で確かめる項目
- なし（見た目は S1-04 のスクリーンショットで確かめる）

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（2D 輪郭の向きの取り決め「0 番目の歯が +x、反時計回り」を design.md §2 か §5 に書く）
- [x] `status: done` にしてコミットした
