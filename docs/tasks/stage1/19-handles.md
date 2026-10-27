---
id: S1-19
title: 外周の角度の円弧ハンドル、シャフト上の位置のドラッグ
status: todo
depends: [S1-18]
---

# S1-19 外周の角度の円弧ハンドル、シャフト上の位置のドラッグ

## 目的
生やした歯車の置き場所を後から調整できるようにする（要件 §6「外周の角度」「シャフト上の位置」「変更の伝わり方」「削除」）。親の周りを連続的に回して動かす円弧のハンドルと、シャフトに沿って 4 mm の格子で動かすハンドルを作る。動かすと、その先の歯車が全部ついてくる。円弧のハンドルは別の歯車とちょうどかみ合う角度に吸着し、ループを作れる。あわせて、浮いた（`detached`）シャフトを別の歯車の外周へ運んで付け直せるようにする。

## 範囲
- ハンドルの表示・ドラッグ・確定・干渉の扱いは S1-17 の共通の振る舞いに従う（ドラッグ中は仮のシーン、離したら 1 コマンド、新たな干渉を生む位置では赤くして最後の干渉の無い値で確定、Esc でやめる）
- **円弧ハンドル（外周の角度）**
  - 出す条件: `mesh` のシャフトか、その上の歯車を選んでいるとき
  - 形: 親の歯車の軸を中心とし、親の軸に垂直な面にある円弧。半径は「中心距離 + 子の歯先円半径 + 8mm」（子の歯車の外側を通り、重ならない）。円弧は今の角度の前後 ±40° 程度を描き、今の角度の位置につまみを置く
  - ドラッグ: ポインターのレイと親の面との交点の、親の軸まわりの角度を求め、ドラッグ開始時からの変化量（−π〜π に巻き戻して積算する）をシャフトの `angle` に足す。角度は連続値。Shift を押している間は 15° 単位に吸着する
  - **かみ合いへの吸着**: 子の歯車が、別の歯車とちょうどかみ合う角度（子と相手の中心距離がピッチ円半径の和になる角度）の前後 `ARC_MESH_SNAP`（5°）以内に来たら、その角度に吸着する。Shift の 15° より優先する
    - 相手にする歯車: 子と同じ大きさで、軸が平行（`Layout` の `axis` が同じ）、子と歯幅が軸方向に重なるもの。親の歯車と、動かすシャフトとその先（S1-09 の `descendantShafts`）に載った歯車は除く
    - 吸着した角度では、子と相手は contact のかみ合いになり、干渉にならない（design.md §5）。三角形などのループになれば、モーターが付いていると contradiction のロックになる。これで、ループを意図して作れる
    - 相手を越えてドラッグしたときは、干渉の扱い（最後の干渉の無い値で確定）により、通ってきた吸着の角度で止まる
  - 親の面を真横から見ていてレイがほぼ平行（レイの向きと軸の内積の絶対値が 0.1 未満）のときは、親の中心を画面に投影した点のまわりの、ポインターの画面上の角度で代用する（軸がカメラから遠ざかる向きなら符号を反転）
  - 角度の基準（0 の向きと正の向き）は S1-09 の `resolveLayout` の `angle` の定義に合わせる
  - 子の位相（`basePhase`）は `resolveLayout` が角度から求め直すので、このタスクでは扱わない
- **軸方向のハンドル（シャフト上の位置）**
  - 出す条件: 歯車を選んでいて、その歯車が `mesh` のシャフトの `childGearId` ではないとき（`childGearId` は親と同じ面にあることで位置が決まるため動かせない。`root` と `detached` のシャフトでは、どの歯車も動かせる）
  - 形: 選んだ歯車の歯先円の少し外側に、軸に平行な両向きの矢印
  - ドラッグ: ポインターのレイに最も近い、軸の直線上の点を求め、ドラッグ開始時からの軸方向の移動量を `AXIAL_SNAP`（4 mm）の単位に丸めて `offset` に足す。歯車の大きさに関係なく 4 mm の格子に乗る（`offset` は歯幅の負側の面の位置。design.md §4）
  - ポインターのレイが軸とほぼ平行なときは動かさない
- **浮いたシャフトの付け直し**（要件 §6「浮いたシャフトをドラッグして別の歯車の外周候補の上で離すと、その先ごとつなぎ直せる」）
  - 始め方: `detached` のシャフト（またはその上の歯車）を選んでいるときに、その本体（シャフト・歯車・モーター）を左ドラッグする（`DRAG_THRESHOLD_PX` 以上）。移動のハンドル（S1-17）ではなく本体をつかむ。選んでいる `detached` のシャフトの本体では、手で回す（S1-21）よりこちらを優先する。選んでいないときは、これまでどおり手で回す
  - 付け直せる候補: 動かすシャフトとその先に含まれない歯車 G について、動かすシャフトに G と同じ大きさの歯車 c があれば、G の外周の 8 方向（S1-10 の外周の候補の角度）に c を付けた位置。付け直したシーンで新たな干渉ができるものと、循環になるもの（G が動かすシャフトかその先にある）は除く
  - ドラッグ中は、付け直せる候補の子の歯車の位置を半透明の輪で表示する。ポインターに最も近い候補（子の中心を画面に投影した点から `REATTACH_PICK_PX`（24px）以内）を強調し、その候補に付け直した仮のシーン（その先も含む）を半透明で表示する
  - 強調中の候補の上で離すと、S1-11 の `reattachShaft` で付け直す（`mesh` になり、その先の歯車もついてくる。Undo 1 回で戻る）。候補の無い所で離す・Esc では何もしない
  - ドラッグ中はカメラを回さない
- **変更の伝わり方**: 角度や位置を変えた歯車の先につながる歯車は、`resolveLayout` の木構造によってすべてついてくる。ドラッグ中の仮表示でもついてくる

## 範囲外
- 起点の位置と高さのハンドル（S1-17）
- 歯数の変更（S1-20）。歯数を変えた時の伝わり方の確認も S1-20
- 干渉の赤い警告の表示そのもの（S1-22）。このタスクではドラッグ中の仮の部品を赤くするところまで
- ロックの表示（S1-22）
- かさ歯車などの 90° の候補の向き（段階 2）

## 作るもの
- S1-17 で作った土台（design.md §7「起点を置く・ハンドル」）: `src/input/handle-drag.ts` の `HandleSpec`・`listHandles`（選択から出すハンドルの一覧。ここに `'arc'`・`'axial'` を足す）・`HANDLE_DRAGS`（種類ごとの「レイ → コマンド」）・`startHandleDrag`（仮のシーン、新たな干渉で invalid、`finish()` で最後の干渉の無いコマンド）・`movedParts`。`src/render/handles.ts` の `HANDLE_BUILDERS`（種類ごとの形）。ドラッグの開始・Esc・確定・赤い表示は `src/app/interactions.ts` が受け持つ。本体をつかむ付け直しは `CameraInput.onAppPointerDown` で、ハンドル以外に当たったときに始める
- `src/input/handle-math.ts`（純粋関数）
  ```ts
  export const ARC_MESH_SNAP = (5 * Math.PI) / 180; // rad。かみ合いへの吸着の範囲（UI だけで使う）
  // 軸 axis（中心 center）まわりの、点 p の角度。基準は S1-09 の angle と同じ
  export function angleAroundAxis(p: Vec3, center: Vec3, axis: Axis): number;
  // 前回の角度から今回の角度への変化量を −π〜π に巻き戻す
  export function unwrapDelta(prev: number, next: number): number;
  export function snapAngle(angle: number, stepRad: number): number;
  // レイに最も近い、直線（origin + t·dir）上の点のパラメーター t。ほぼ平行なら null
  export function closestParamOnLine(rayOrigin: Vec3, rayDir: Vec3, lineOrigin: Vec3, lineDir: Vec3): number | null;
  // 開始時の offset に、軸方向の移動量を AXIAL_SNAP の単位に丸めて足す
  export function axialOffsetFromDrag(startOffset: number, deltaAlongAxis: number): number;
  // 親の中心 parentCenter・軸 axis のまわりを半径 radius（中心距離）で回る子（ピッチ円半径 childPitchRadius）が、
  // targets のどれかとちょうどかみ合う角度の一覧（S1-09 の angle の定義、[0, 2π)）。target の中心は親の面に射影して扱う
  export function meshSnapAngles(
    parentCenter: Vec3, axis: Axis, radius: number, childPitchRadius: number,
    targets: ReadonlyArray<{ center: Vec3; pitchRadius: number }>,
  ): number[];
  // angle から range 以内（2π の折り返しを考える）で最も近い吸着の角度。無ければ null
  export function nearestSnapAngle(angle: number, snapAngles: readonly number[], range: number): number | null;
  ```
  - `angleAroundAxis` と `unwrapDelta` は S1-21（手で回す）でも使う。S1-21 が先に終わっていて、すでにこのファイルにあればそれを使う
- `src/core/layout/mesh-snap.ts`
  ```ts
  // mesh のシャフト shaftId の子の歯車が、かみ合いへの吸着の相手にできる歯車（上の「相手にする歯車」の条件）
  export function meshSnapTargets(scene: Scene, layout: Layout, shaftId: ShaftId): Array<{ gearId: GearId; center: Vec3; pitchRadius: number }>;
  ```
- `src/app/reattach.ts`（純粋関数）
  ```ts
  export interface ReattachCandidate {
    parentGearId: GearId; // G
    childGearId: GearId;  // 動かすシャフト上の c
    angle: number;        // G の軸まわりの角度
    childCenter: Vec3;    // 付け直した後の c の中心（表示とポインターの判定に使う）
  }
  // detached のシャフト shaftId を付け直せる候補。detached でなければ []
  export function reattachCandidates(scene: Scene, layout: Layout, shaftId: ShaftId): ReattachCandidate[];
  ```
  - 新たな干渉の判定は S1-17 の `newInterferences` を使う
- `src/render/handles.ts` に `'arc'` と `'axial'` のハンドルを足す。付け直しの候補の輪と仮のシーンの表示
- `src/input/handle-drag.ts` に、円弧のかみ合いへの吸着と、付け直しのドラッグを足す
- 使う編集コマンドは S1-11 のもの: `setMeshAngle`、`setGearOffset`、`reattachShaft`
- `__gearSim.getHandles()` が `'arc'`（`targetId` はシャフト）と `'axial'`（`targetId` は歯車）も返す
- `e2e/fixtures/arc-blocked.json`: 縦軸の起点の歯車 A（中・20 歯）に、外周の子 B（`angle` 0）と D（`angle` π/2）。どちらも中・20 歯
- `e2e/fixtures/arc-loop.json`: 縦軸の起点のシャフト 2 本。A（原点 `[0, 35, 0]`、中・20 歯、小のモーター 60 rpm・`direction: 1`・ON）と T（原点 `[40, 35, 0]`、中・20 歯。A と contact でかみ合う）。A の外周に子 B（中・20 歯、`angle` 0）
- `e2e/fixtures/stacked.json`: 縦軸の起点のシャフト（原点 `[0, 35, 0]`）に A（中・20 歯、`offset` 0）と E（小・30 歯、`offset` 8。A の正側の面に接する）。E の外周に子 F（小・30 歯）
- `e2e/fixtures/reattach.json`: 縦軸の起点のシャフト A（原点 `[0, 35, 0]`、中・20 歯、中のモーター 30 rpm・`direction: 1`・ON）と、`detached` のシャフト D（`placement.origin [100, 35, 0]`、`placement.axis 'y'`）に中・20 歯の P（`offset` 0）。P の外周に子 Q（中・20 歯、`angle` 0）

## 受け入れ条件
- [ ] `mesh` のシャフトの歯車を選ぶと円弧ハンドルが出て、親の周りを連続的に動かせる。Shift で 15° 単位になる
- [ ] 円弧ハンドルは、別の歯車とちょうどかみ合う角度に吸着し、ループを作れる
- [ ] 動かせる歯車を選ぶと軸方向のハンドルが出て、4 mm の格子で動かせる
- [ ] 浮いたシャフトを本体ドラッグで別の歯車の外周候補へ運んで離すと付け直され、その先もついてくる
- [ ] 動かした歯車の先の歯車がすべてついてきて、かみ合ったままである
- [ ] 新たな干渉を生む位置では赤くなり、離すと最後の干渉の無い位置で止まる
- [ ] どの操作も Undo 1 回で戻る

## テストケース
### Vitest
- [ ] `angleAroundAxis`: S1-09 の定義で角度 0 になる向きの点 → 0、正の向きに 90° 回した点 → π/2。軸 x・y・z のそれぞれで、S1-09 で `angle: θ` として置いた子の中心を渡すと θ が返る（`resolveLayout` との往復）
- [ ] `unwrapDelta(3.0, -3.0)` → 約 `2π − 6`（正の小さい値）。`unwrapDelta(-3.0, 3.0)` → 負の小さい値。`unwrapDelta(0.1, 0.3)` → 0.2
- [ ] `snapAngle(0.27, π/12)` → π/12
- [ ] `closestParamOnLine`: 直線が y 軸、レイが `[10, 5, 0]` から `[-1, 0, 0]` の向き → 5。直線と平行なレイ → null
- [ ] `axialOffsetFromDrag(8, 5.9)` → 12。`(8, 6.1)` → 16。`(8, -1.9)` → 8。`(8, -2.1)` → 4。`(0, 4.1)` → 4（中の歯車でも 4 mm 単位）
- [ ] `meshSnapAngles`（親の中心が原点、軸 `'y'`、半径 40、子のピッチ円半径 20）
  - 相手が `[40, 0, 0]`（`+X`、S1-09 の定義で角度 π/2 の向き）、ピッチ円半径 20 → π/2 ± π/3 の 2 つ（π/6 と 5π/6）
  - 相手が `[80, 0, 0]` → π/2 の 1 つ（接する場合）
  - 相手が `[100, 0, 0]` → `[]`（届かない）
  - 相手が `[40, 12, 0]`（軸方向にずれている）→ 面に射影して `[40, 0, 0]` と同じ結果
  - 相手の中心が親の軸上（`[0, 8, 0]`）→ `[]`（どの角度でも距離が一致する退化した場合なので、吸着先を出さないと決める）
- [ ] `nearestSnapAngle`: 吸着の角度 `[π/6]`、range 5° → `π/6 + 0.05` は π/6、`π/6 + 0.1` は null。吸着の角度 `[0.01]` で `2π − 0.02` → 0.01（折り返し）。2 つの候補があれば近いほう
- [ ] `meshSnapTargets`: `arc-loop.json` 相当のシーンで B のシャフト → T だけ（親 A は除く）。T を小の歯車にしたシーン → `[]`。T の `offset` を 8 にしたシーン（歯幅が重ならない）→ `[]`。T の軸を `'x'` にしたシーン → `[]`。B の先に子 B2 があっても、B2 は相手にならない
- [ ] `reattachCandidates`: `reattach.json` 相当のシーンで D → `parentGearId` が A の候補がある（8 方向のうち、付け直したシーンで新たな干渉ができないもの）。`parentGearId` が P や Q の候補は無い（循環）。A を小の歯車にしたシーン → `[]`（同じ大きさの歯車が無い）。A の外周の候補のうち、Q が A に重なる角度のものは無い。`root` のシャフトを渡す → `[]`
- [ ] 候補を `reattachShaft` で適用したシーン → D が `{ kind: 'mesh', parentGearId: A, childGearId: P }`、`resolveLayout` で A と P の中心距離 40、P と Q の中心距離 40 のまま
### Playwright（`e2e/handles.spec.ts`）
準備: 上から見下ろす視点（`setCamera` で `position: [0, 400, 0.001]`、`target: [0, 0, 0]` など）。ハンドルの位置は `getHandles()` を `projectToScreen` して得る。円弧のドラッグは、親の中心の画面上の位置のまわりに、10 段階に分けて `mouse.move` する。
- [ ] `chain-three.json` で B を選ぶ → `getHandles()` に B のシャフトの `'arc'` があり、B の `'axial'` は無い
- [ ] `'arc'` をつかんで親 A のまわりに 45° 分ドラッグ → B のシャフトの `angle` の変化量の絶対値が π/4 に近い（誤差 0.05 rad）。A と B の中心距離は 40 のまま。C の中心も動き、B と C の中心距離も 40 のまま。`getLayout().meshes` に A-B、B-C がある
- [ ] 続けて Ctrl+Z → `angle` が元に戻る
- [ ] Shift を押しながら 50° 分ドラッグ → 変化量が π/12 の整数倍
- [ ] `arc-blocked.json` で B を選び、`'arc'` を D の側へ 90° 分ドラッグして離す → `getLayout().interferences` が空。途中で D とちょうどかみ合う角度を通るので、B の `angle` は 0 から D の側へ π/6 動いた値（誤差 1e-6）で止まり、`getLayout().meshes` に B-D（`source: 'contact'`）がある
- [ ] `arc-loop.json` → 最初は `getMotion().locks` が空で、3 枚とも回っている。B を選び、`'arc'` を T の側へ 30° 分ドラッグして離す → B の `angle` の変化量の絶対値が π/6（誤差 1e-6。吸着した値）。B と T の中心距離が 40（`MESH_DISTANCE_EPS` 以内）、`getLayout().meshes` に B-T（`source: 'contact'`）があり、`interferences` が空。`getMotion().locks` に `reason: 'contradiction'` のロックがあり、3 本のシャフトを含む。Ctrl+Z → ロックが解ける
- [ ] `stacked.json` で E を選ぶ → `'axial'` がある。横から見る視点（`position: [0, 35, 400]`）で `'axial'` を上へ 40px ドラッグ → E の `offset` が 8 より大きく、4 の倍数。F の中心の y も同じだけ動き、E と F はかみ合ったまま
- [ ] E の `'axial'` を下へ大きくドラッグ（A に重なる所まで）して離す → `interferences` が空で、E は A に重ならない位置で止まっている
- [ ] Esc でドラッグをやめる → シーンが変わらない
- [ ] `reattach.json` で P を選び、P の中心から、A の中心の `+X` 側 40 mm の点（A の外周の候補の位置。`getLayout` から求める）の画面上の位置へ、10 段階に分けてドラッグして離す → D の `placement` が `{ kind: 'mesh', parentGearId: A, childGearId: P }`。A と P の中心距離 40、P と Q の中心距離 40、`getLayout().meshes` に A-P と P-Q（どちらも `source: 'tree'`）。D の ω（`getMotion().omegas`）が −π、Q のシャフトの ω が π。`getCamera()` は変わらない
- [ ] 続けて Ctrl+Z → D が `detached` に戻り、P と Q の中心が元の位置に戻る
- [ ] P を選び、何もない所（候補から離れた所）へドラッグして離す → シーンが変わらない。Esc でやめたときも同じ
- [ ] P を選び、Q の外周（Q の中心の `+X` 側 40 mm）へドラッグして離す → シーンが変わらない（循環になるので候補が無い）
- [ ] P を選ばずに P の上で左ドラッグ → 付け直しではなく手で回す（S1-21 が done なら P のシャフトの角度が変わる。まだならシーンが変わらないことだけ確かめる）
### Playwright（見た目）
- なし（S1-31 でまとめる）

## 人が手で確かめる項目
- 円弧ハンドルが、どの視点からでも見つけやすく、親の周りを回す感覚がわかる
- 真横から見ているときの代用の角度計算で、動きが飛ばない
- かみ合いへの吸着が、気づけて、狙わずに引っかかりすぎない強さである
- 軸方向のドラッグの吸着が気持ちよく、干渉で止まる所が自然
- 付け直しのドラッグで、候補の場所と付け直した後の様子がわかる

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（§10 の `__gearSim` の API）
- [ ] `status: done` にしてコミットした
