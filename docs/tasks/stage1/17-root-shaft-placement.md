---
id: S1-17
title: 起点のシャフトを置く
status: done
depends: [S1-16]
---

# S1-17 起点のシャフトを置く

## 目的
空の画面から組み立てを始められるようにする（要件 §6「起点のシャフト」）。部品パレットから床へドラッグして起点のシャフトを置き、R キーで向きを変え、ハンドルで高さと位置を調整する。ここで作るハンドルの仕組み（表示・ピッキング・ドラッグ中の仮表示・離したときの確定）は S1-19 でも使う。

## 範囲
- 部品パレット（S1-15 の置き場）に次を置く
  - **歯車の大きさ**の選択（小・中・大。初期値は中）。ここで選んだ大きさは、起点を置くときと、S1-18 の同じ軸の候補で使う
  - **起点のシャフト**の項目。ドラッグして床へ持っていく
- 起点を置く
  - パレットの項目から左ドラッグを始めると、描画領域の上では床（y = 0 の平面）との交点に仮の部品（半透明のシャフトと歯車 1 枚）が付いてくる
  - 置かれるのは、起点のシャフト 1 本と、その上の歯車 1 枚（大きさはパレットで選んだもの、歯数は `DEFAULT_TEETH[size]`、`offset` 0。歯車の負側の面がシャフトの原点に来る。design.md §4）
  - 位置: x と z は床の交点を `GRID_SNAP`（5mm）に吸着。原点の高さ y は「歯先円半径 + `ROOT_CLEARANCE`（10）」を 5mm の倍数に切り上げた値（どの向きでも床にめり込まない）
  - 向き: 初期値は縦（`'y'`）。ドラッグ中に R を押すたびに y → x → z → y と切り替わる
  - 既存の部品と干渉する位置では仮の部品を赤くし、そこで離しても置かない
  - 描画領域の外（パネルの上）や、床に当たらない所で離したら置かない。Esc でもやめる
  - 置いたら 1 つの編集コマンドとして履歴に積み（Undo 1 回で消える）、置いた歯車を選択する
- 起点の向きの切り替え: 起点（または `detached`）のシャフトか、その上の歯車を選んでいるとき、R で向きを y → x → z → y と切り替える（S1-11 の `setShaftAxis`。変えるのはそのシャフトの `placement.axis` だけ）。その先の `mesh` のシャフトは向きを親から導くので（design.md §4）、`resolveLayout` で自然に同じ向きになる。`mesh` のシャフトを選んでいるときの R は何もしない
- ハンドル（`root` と `detached` のシャフト、またはその上の歯車を選んでいるときに出す）
  - **位置のハンドル**: シャフトの原点の真下の床にある四角。ドラッグすると床の平面上で x と z が動く（5mm に吸着）
  - **高さのハンドル**: 床の四角から原点へ伸びる縦の線の先の矢印。ドラッグすると y が動く（5mm に吸着、0 以上）
  - ハンドルが部品と重なって見にくいときは少しずらしてよい
- ハンドルのドラッグの共通の振る舞い（S1-19 も従う）
  - ドラッグ中は、履歴に積まない仮のシーンを描画する。その先につながった歯車も一緒に動いて見える
  - 離したときに 1 つの編集コマンドで確定する（Undo 1 回で元に戻る）。動かしていなければ何もしない
  - **干渉**: ドラッグ開始時に無かった干渉を新たに生む位置では、仮の部品を赤くする。その位置で離したら、ドラッグ中に通った最後の「新たな干渉の無い」値で確定する（それも無ければ何もしない）
  - Esc でドラッグをやめ、元に戻す
- ハンドルはピッキングで最優先（S1-16 の優先順位）。ハンドルの上の左ドラッグはカメラを回さない
  - S1-16 の仕組み: ハンドルの Object3D を `Renderer.pickRoot` に足し、`setPickTarget(object, 'handle', id)`（`src/render/picking.ts`）で印を付ければ、`pick` が最優先で返し、`setHitTest` によりカメラも回らない。ハンドルのクリックで選択が外れないように、`main.ts` のクリックの処理（`selectAt`。`selectionForPick` はハンドルに null を返す）で `kind: 'handle'` のときは選択を変えないようにする

## 範囲外
- 歯車から生やす（S1-18）
- 外周の角度の円弧ハンドル、シャフト上の位置のハンドル（S1-19）
- 歯数の変更（S1-20）
- 浮いた（`detached`）シャフトを別の歯車へ付け直す操作（S1-19）

## 作るもの
- `src/core/constants.ts` に追加（値は design.md §3 の表のとおり）
  ```ts
  export const DEFAULT_TEETH = { S: 30, M: 20, L: 16 } as const; // 新しく置く・生やす歯車の歯数
  export const GRID_SNAP = 5; // mm。起点のシャフトの床上の位置
  ```
- 使う編集コマンドは S1-11 のもの: 起点を置く `addRootShaft`、原点を変える `moveShaft`、向きを変える `setShaftAxis`（`root`・`detached` の `placement.axis` だけを書き換える）
- `src/core/layout/interference-diff.ts`
  ```ts
  // after にあって before に無い干渉の組（順序は問わない）
  export function newInterferences(before: Layout, after: Layout): Array<[string, string]>;
  ```
- `src/input/placement.ts`（純粋関数）
  ```ts
  export const ROOT_CLEARANCE = 10; // mm。起点の初期の高さ = 歯先円半径 + これ を GRID_SNAP に切り上げ（UI だけで使う）
  export function snap(value: number, step: number): number;
  export function rootHeight(size: SizeKey, teeth: number): number;
  export function nextAxis(axis: Axis): Axis; // y → x → z → y
  // レイと平面の交点。平行なら null
  export function intersectRayPlane(rayOrigin: Vec3, rayDir: Vec3, planePoint: Vec3, planeNormal: Vec3): Vec3 | null;
  // 縦の直線（x, z を通る）に最も近いレイ上の点の y。高さのハンドル用
  export function closestHeightOnVerticalLine(rayOrigin: Vec3, rayDir: Vec3, x: number, z: number): number | null;
  ```
- `src/render/handles.ts`、`src/input/handle-drag.ts`: ハンドルの描画とドラッグの仕組み（S1-19 が種類を足せる形にする）
- `__gearSim` に追加（design.md §10 も更新する）
  ```ts
  getHandles(): Array<{ kind: 'move' | 'height' | 'arc' | 'axial'; targetId: string; position: Vec3 }>;
  ```
  - `position` はドラッグを始めるのに適した点（Playwright はここを `projectToScreen` して押す）。`'arc'` と `'axial'` は S1-19 で足す
- `e2e/fixtures/two-roots.json`: 縦軸の起点のシャフトを 2 本（それぞれ中・20 歯）、x 方向に 100mm 離して置いたもの
- 辞書に、パレットの項目と大きさの名前のキーを足す

## 受け入れ条件
- [x] パレットから床へドラッグして起点のシャフト（歯車 1 枚付き）を置ける。向きは R で切り替わる
- [x] 干渉する位置、パネルの上、Esc では置かれない
- [x] 起点を選ぶと位置と高さのハンドルが出て、ドラッグで動かせる。その先の歯車もついてくる
- [x] 新たな干渉を生む位置で離したら、最後の干渉の無い位置で止まる
- [x] どの操作も Undo 1 回で戻る

## テストケース
### Vitest
- [x] `snap(12.4, 5)` → 10、`snap(12.5, 5)` → 15、`snap(-7, 5)` → -5
- [x] `rootHeight('M', 20)` → 35（歯先円半径 22 + 10 = 32 を切り上げ）。`rootHeight('L', 16)` → 40（27 + 10 = 37）
- [x] `nextAxis`: y → x、x → z、z → y
- [x] `intersectRayPlane`: 原点 `[0, 100, 0]`・向き `[0, -1, 0]` と床 → `[0, 0, 0]`。床と平行なレイ → null。床から離れる向き → null
- [x] `closestHeightOnVerticalLine`: 水平なレイが直線を通るなら、そのレイの高さを返す
- [x] `newInterferences`: before に `[a, b]`、after に `[b, a]` と `[c, d]` → `[[c, d]]` だけ
- [x] 向きを変えるコマンド: A（起点）→B→C の木で A を `'x'` にすると、A の `placement.axis` が `'x'`、B・C のシャフトの `placement` は前と同じ参照。`resolveLayout` の `shafts[id].axis` は 3 本とも `'x'` で、A-B、B-C がかみ合いのまま（中心距離 = ピッチ円半径の和）
- [x] 原点を変えるコマンド: A を `[10, 0, 0]` 動かすと、`resolveLayout` での B と C の中心も `[10, 0, 0]` 動く
### Playwright（`e2e/root-placement.spec.ts`）
準備: 空のシーンで、`setCamera` で斜め上から見下ろす視点にする。
- [x] パレットの起点の項目から `projectToScreen([0, 0, 0])` へドラッグ（`mouse.down` → 何段階かに分けて `mouse.move` → `mouse.up`）→ シャフトが 1 本（`placement.kind: 'root'`、`placement.axis: 'y'`、`placement.origin` が `[0, 35, 0]` に近く x・z は 5 の倍数）、歯車が 1 枚（`size: 'M'`、`teeth: 20`、`offset: 0`）。`getSelection()` がその歯車
- [x] ドラッグ中に R を 1 回押してから離す → `placement.axis: 'x'`
- [x] パレットで「小」を選んでから置く → 歯車が `size: 'S'`、`teeth: 30`
- [x] ドラッグ中に Esc → 何も増えない
- [x] パレットへ戻して離す → 何も増えない
- [x] 1 本置いた後、その歯車の中心の真下へもう 1 本ドラッグして離す → 増えない（干渉）
- [x] 置いた後 Ctrl+Z → シャフトも歯車も無くなる
- [x] `chain-three.json`（S1-16）を読み込み A を選ぶ → `getHandles()` に `move` と `height` がある。`height` を 60px 上へドラッグ → A のシャフトの `placement.origin[1]` が増え、5 の倍数。B・C の中心の y も同じだけ増える。Ctrl+Z で戻る
- [x] `move` を右へ 80px ドラッグ → `placement.origin` の x か z が変わり、y は変わらない。C の中心も同じだけ動く
- [x] A を選んで R → A の `placement.axis` が `'x'`、`getLayout().shafts` の 3 本の `axis` が `'x'`、`getLayout().meshes` に A-B、B-C がある。Ctrl+Z で `'y'` に戻る
- [x] B を選んで R → 何も変わらない（`mesh` のシャフト）
- [x] `two-roots.json` を読み込み、1 本目の `move` をもう 1 本目の位置まで引きずって離す → `getLayout().interferences` が空のまま、1 本目は 2 本目の手前で止まっている
### Playwright（見た目）
- なし（S1-31 でまとめる）

## 人が手で確かめる項目
- パレットからのドラッグで、仮の部品が床に吸い付くように自然に付いてくる
- ハンドルが見つけやすく、つかみやすい。どの向きのシャフトでも重なって操作できなくならない
- 干渉で止まるときの手触りに違和感がない

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（§3 の定数、§10 の `__gearSim` の API）
- [x] `status: done` にしてコミットした
