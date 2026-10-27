---
id: S1-09
title: 配置の木構造
status: doing
depends: [S1-03, S1-08]
---

# S1-09 配置の木構造

## 目的
design.md §5 の `resolveLayout(scene): Layout` を完成させる。シーン（意図だけ）から、シャフトと歯車の位置・位相、かみ合いの組（木の親子と偶然のかみ合い）、干渉の組を毎回求める。完了すると、歯数や角度を変えたときにその先の歯車が全部ついてくる（要件 §6「変更の伝わり方」）ことと、ループで辻褄が合わなくなった所が干渉として分かることが、純粋関数で確かめられる。

## 範囲
- 木構造の位置（design.md §5）
  - 根は `root` と `detached` のシャフト。原点は `placement.origin`、向きは `placement.axis`
  - 根から幅優先でたどる。シャフトに載った歯車ごとに、それを `parentGearId` に持つ `mesh` のシャフトを子とする
  - `mesh` のシャフト: 向きは親の歯車の軸（シーンには持たない。`Layout.shafts[id].axis` に入れる）。原点 = 親の歯車の負側の面の位置（親のシャフトの原点 + 親の `offset` × 軸）+ `radialDirection(親の軸, angle) × centerDistance(大きさ, 親の歯数, 子の歯数)`（子の `offset` は 0 なので、子の面と中心が親とそろう）
  - 歯車の中心 = シャフトの原点 + `(offset + 歯幅/2) × axisVector(軸)`（design.md §4）
  - 歯数や角度を変えたシーンを渡せば、その先の位置が全部変わる（伝播はこの計算の結果として起きる）
- 位相（basePhase）
  - 根のシャフトの歯車: 0
  - `mesh` のシャフトの子の歯車: `meshPhase(親の basePhase, 親の歯数, 子の歯数, angle)`（S1-03）
  - `mesh` のシャフトの、子以外の歯車: 0（シャフトと一緒に回るだけなので任意でよい）
- シャフトの長さ（`span`。シャフトの原点から軸方向の区間）
  - 載っている歯車の両面（`offset` と `offset + 歯幅`）の最小〜最大に、両側 `SHAFT_END_MARGIN` を足す
  - 歯車が載っていないシャフト: `[−EMPTY_SHAFT_HALF_LENGTH, +EMPTY_SHAFT_HALF_LENGTH]`
- かみ合い（`meshes`）
  - `tree`: `mesh` のシャフトの `parentGearId` と `childGearId` の組
  - `contact`: 木の親子でない歯車の組で、同じ大きさ、軸が同じ、別のシャフト、軸方向の区間の重なりが `COLLISION_EPS` より大きく、軸に垂直な方向の中心間の距離とピッチ円半径の和の差が `MESH_DISTANCE_EPS` 以内
  - 位相が合っているかどうかは問わない。contact は拘束として扱い（S1-05）、干渉にもしない（design.md §5）。三角形に組むと contradiction のロックになる（S1-07）
  - `a` と `b` は ID の辞書順（`a < b`）。一覧は `(a, b)` の辞書順
- 干渉（`interferences`）
  - S1-08 の `findInterferences` に、全ての歯車の円柱と全てのシャフトの線分（`origin + span × 軸`）を渡す。`exempt` は `meshes` の組（contact を含む）
  - 「ループで辻褄が合わなくなった組」は、contact の距離がずれてかみ合いでなくなった結果、円柱が重なれば干渉として出る。木の辺ではないので位置は動かさない（design.md §5）
- 検証済みのシーン（S1-03 の `validateScene` が ok）を前提とする。根から到達できないシャフトとその歯車は `Layout` に含めない（例外にしない）
- キャッシュ: 同じシーンの参照で呼ばれたら、前回と同じ `Layout` のオブジェクトを返す（`WeakMap` など）
- app への組み込み: このタスクで、S1-04 の暫定の `resolveLayout`（S1-08 で干渉を足したもの）を同じファイルでこの実装に置き換える（app はそのまま新しい実装を使う）

## 範囲外
- 削除のコマンド（S1-11。このタスクでは、`detached` のシャフトを含むシーンを正しく解決できればよい）
- 生やす候補（S1-10）
- 干渉の赤い表示（S1-22）
- 段階 2 以降の、軸の向きが変わるかみ合い（かさ歯車・ウォームなど）

## 作るもの
- `src/core/constants.ts` に design.md §3 の表の値で足す
  ```ts
  export const SHAFT_END_MARGIN = 4;          // mm。シャフトを歯車の端から伸ばす長さ
  export const EMPTY_SHAFT_HALF_LENGTH = 10;  // mm。歯車の無いシャフトの長さの半分
  ```
- `src/core/layout/resolve.ts`
  ```ts
  export function resolveLayout(scene: Scene): Layout; // design.md §5 の Layout
  ```
- 必要なら、木のたどり方を外から使える補助関数（S1-11 の削除や向きの変更で「その先の部品」を集めるのに使う）
  ```ts
  // shaftId とその先（mesh で子孫になる）シャフトの ID。幅優先の順（S1-11 の削除・付け直しの循環の判定に使う）
  export function descendantShafts(scene: Scene, shaftId: ShaftId): ShaftId[];
  ```

## 受け入れ条件
- [ ] 歯数・角度・起点の位置を変えると、その先の全ての歯車の位置が変わる
- [ ] 偶然ちょうどの距離にある同じ大きさの歯車は、位相によらず `contact` のかみ合いになり、干渉にならない
- [ ] ループの辻褄が合わなくなった組は、かみ合いから外れ、重なっていれば干渉になる

## テストケース
大きさはすべて S（12 歯: ピッチ円半径 6、歯先円半径 7、歯幅 4。`offset 0` の歯車の中心はシャフトの原点から軸方向に +2）。軸 `'y'` の角度は `0 → +Z`、`π/2 → +X`（S1-03）。ID は S1-03 の連番の生成関数で作ってよい。位相の比較は歯のピッチを法として行う。
### Vitest
- [ ] 起点 1 本: `root`、`origin [0, 10, 0]`、`axis 'y'`、12 歯 `offset 4` → `gears.g.center ≈ [0, 16, 0]`、`pitchRadius 6`、`basePhase 0`、`shafts.s.axis === 'y'`、`shafts.s.span ≈ [0, 12]`（面 `4`〜`8` に `SHAFT_END_MARGIN` 4）
- [ ] 歯車の無い起点 → `span = [−10, 10]`
- [ ] 親子: 起点 `A`（`origin [0, 20, 0]`、12 歯）、`mesh` の `B`（24 歯、`angle π/2`）→ `A` の歯車の中心 `≈ [0, 22, 0]`、`B` のシャフトの原点 `≈ [18, 20, 0]`、`B` の歯車の中心 `≈ [18, 22, 0]`、`basePhase ≡ π/24`、`meshes = [{ a: A の歯車, b: B の歯車, source: 'tree' }]`、`interferences = []`
- [ ] 軸 `x`: 起点 `axis 'x'`・原点、12 歯 → 中心 `≈ [2, 0, 0]`。子 24 歯 `angle 0` → 子の中心 `≈ [2, 18, 0]`、`shafts[子].axis === 'x'`（シーンの子のシャフトは向きを持たない）
- [ ] 軸 `z`: 同じ形で子 `angle π/2` → 子の中心 `≈ [0, 18, 2]`、`shafts[子].axis === 'z'`
- [ ] 伝播: 起点 `A`（`[0, 20, 0]`、12 歯）→ `B`（24 歯、`angle π/2`、`B` には別の 24 歯も `offset 4` で載る）→ `C`（`B` の `offset 4` の歯車の子、12 歯、`angle 0`）。このシーンに干渉は無い
  - `B` の 2 枚の中心 `≈ [18, 22, 0]` と `[18, 26, 0]`（面が接する）。`C` のシャフトの原点 `≈ [18, 24, 18]`、`C` の歯車の中心 `≈ [18, 26, 18]`、`C` の歯車の `basePhase ≡ π/12`、`B` のシャフトの `span ≈ [−4, 12]`、`interferences = []`
  - `A` の歯数を 20 にしたシーン → `B` の中心 `≈ [22, 22, 0]`、`C` の中心 `≈ [22, 26, 18]`
  - `B` の `angle` を 0 にしたシーン → `B` の中心 `≈ [0, 22, 18]`、`C` の中心 `≈ [0, 26, 36]`
  - 起点の `origin` を `[100, 20, 0]` にしたシーン → 全部が x に +100
- [ ] contact（四角形）: 起点 `A`（原点）、`B` は `A` の子（`angle π/2`）、`C` は `B` の子（`angle 0`）、`D` は `C` の子（`angle −π/2`）。すべて 12 歯 `offset 0` → 中心は `A [0,2,0]`、`B [12,2,0]`、`C [12,2,12]`、`D [0,2,12]`。`A`–`D` の距離 12 → `meshes` に `{ A, D, source: 'contact' }` を含む（計 4 組）、`interferences = []`
- [ ] 正三角形（位相が合わなくても contact）: 起点 `A`（原点）、`B`（`A` の子、`angle π/2`）、`C`（`B` の子、`angle −π/6`）。すべて 12 歯 `offset 0` → `C` の中心 `≈ [6, 2, 6√3]`、`A`–`C` の距離 12（位相は半ピッチずれる）→ `meshes` は木の 2 組と `{ A の歯車, C の歯車, source: 'contact' }` の計 3 組、`interferences = []`（S1-05・S1-07 の三角形の矛盾のテストと同じ組）
- [ ] ループの辻褄: 四角形の `B` を 14 歯にしたシーン → `B [13,2,0]`、`C [13,2,13]`、`D [1,2,13]`。`A`–`D` の距離 `√170 ≈ 13.04` → `contact` なし、歯先円の和 14 より近いので `interferences` に `[A の歯車, D の歯車]`
- [ ] contact にならない: 距離がちょうどでも、大きさが違う（S と M）・軸方向にずれて歯幅が重ならない（`offset` が 4 違う）→ `contact` にしない
- [ ] 兄弟の干渉: 12 歯の親に、12 歯の子を `angle 0` と `angle π/6` で 2 本 → 子どうしの中心距離 `24·sin(π/12) ≈ 6.21` → `interferences` に子どうしの歯車の組
- [ ] シャフトの干渉: 起点 `A`（`axis 'y'`、原点、12 歯 `offset 0`）と、起点 `E`（`axis 'x'`、`origin [−2, 12, 0]`、12 歯 `offset 0`）→ `E` の歯車の円柱（`x` 軸、中心 `[0, 12, 0]`、半径 7、x が −2〜2）に `A` のシャフトの線分（`[0, −4, 0]`〜`[0, 8, 0]`）の上端が入る → `interferences` は `[A のシャフト, E の歯車]` の 1 組だけ（`A` の歯車は y が 0〜4、`E` の歯車は y が 5 より上で重ならない）
- [ ] `detached`: `detached`、`origin [30, 0, 0]`、`axis 'z'`、12 歯 `offset 0` → 中心 `[30, 0, 2]`、`basePhase 0`。その子（24 歯、`angle 0`）→ 中心 `≈ [48, 0, 2]`、`shafts[子].axis === 'z'`
- [ ] 並び: `meshes` と `interferences` が辞書順、組の中も `a < b`
- [ ] キャッシュ: 同じシーンのオブジェクトで 2 回呼ぶ → 同じ参照。中身が同じ別のオブジェクト → 等しい値
- [ ] `descendantShafts`: 伝播のシーンで `A` → `[A, B, C]`、`B` → `[B, C]`、`C` → `[C]`
### Playwright
- [ ] `e2e/fixtures/square-loop.json`（上の四角形）を `loadScene` → `getLayout().meshes` に `source: 'contact'` が 1 件
- [ ] `e2e/fixtures/triangle.json`（上の正三角形。`A` に S 60rpm）を `loadScene` → `getLayout().meshes` に `source: 'contact'` が 1 件、`getLayout().interferences` が空

## 人が手で確かめる項目
- なし

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`span` の決め方を design.md §5 に書く）
- [ ] `status: done` にしてコミットした
