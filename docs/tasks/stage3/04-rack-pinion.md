---
id: S3-04
title: ラック＆ピニオン
status: todo
depends: [S2-05]
---

# S3-04 ラック＆ピニオン

## 目的
回転を直線運動に変えるラック＆ピニオンを入れる。ラックはシャフトではなく、直線に動く新しい剛体として扱う。長さに限りがあり、端に達するとロックする。

## 範囲
- **決めた値**（`src/core/constants.ts`）
  - ラックの歯数の範囲 `RACK_TEETH = { min: 10, max: 60 }`、既定 30。長さ `L = 歯数 × π·m`
  - 断面: 歯幅は大きさの歯幅、高さは歯先からピッチ線まで `m`、ピッチ線から歯底まで `1.25m`、歯底から背まで `2m`
  - 端の余白 `RACK_END_MARGIN = π·m`（1 ピッチ）。ピニオンの接点がラックの端からこの距離に来たら端とする
  - かみ合えるのは同じ大きさの平歯車（ピニオン）だけ。歯形は圧力角 20° の直線歯
- **データ**: シーンに `racks` を足す（下の型）
  - ラックの向きは 3 本の軸で決まる: 動く向き `direction`、歯が向く軸 `normal`（とその向き `normalSign`）、残りの軸が歯幅の方向（＝ピニオンの軸）
  - 配置は「ピニオンにかみ合わせて置く」（`pinion`）か、ピニオンが消されて浮いた状態（`detached`）
  - **向きの持ち方**（design.md §4 のシャフトと同じ考え方）: `pinion` は向きを絶対の軸で持たず、ピニオンの軸から導く。`direction` = ピニオンの軸を x → y → z → x の順に `axisStep` 回進めた軸（S2-02 の `stepAxis`）、`normal` = 残りの軸、歯の向きは `normalSign`。ピニオンのシャフトの向きが変わっても、ラックは相対の関係を保ってついてくる。`detached` だけが `direction`・`normal`・`normalSign` を絶対の値で持つ。導いた向きは `Layout.racks[id]` に出す
  - **基準位置**: ラックの変位 s = 0 のときのピッチ線の中央。`pinion` では `ピニオンの中心 − r·normalSign·(normal の単位ベクトル)`
  - 歯幅の方向（ピニオンの軸）には、ピニオンと同じ区画（ピニオンの `offset` から歯幅）を占める
- **2 つ目以降のピニオン**: 新しい配置 `ShaftPlacement` の `'rack'`（`axis` は持たず、ラックの歯幅の方向から導く）。ラックの基準位置から `direction` に `position` 進み、歯の側へ子のピッチ円半径だけ離れた位置に子の中心を置く。子の `offset` は 0 としてシャフトの原点を逆算する（ラックの歯幅の区画と子の区画がそろう）。`position` はピッチ `π·m` の整数倍に吸着させる（位相が自動で合う）
- **候補**
  - 平歯車を選ぶと、ラックの候補を 4 か所出す（`axisStep` 2 通り × `normalSign` 2 通り）。ラックは同じ大きさ・既定の歯数で、中央でピニオンにかみ合う
  - ラックを選ぶと、2 つ目のピニオンの候補を出す。すでにかみ合っているピニオンから両側へ、干渉しない最初の `position`（ピッチの整数倍）を 1 つずつ。ピニオンは同じ大きさ・S1-18 の既定の歯数
- **偶然のかみ合い（contact）**: 同じ大きさの平歯車で、軸がラックの歯幅の方向、中心がピッチ線から歯の側へ `r` の距離（`MESH_DISTANCE_EPS` 以内）、接点がラックの長さの範囲にある。段階 1 と同じく位相は問わず拘束として扱い、干渉にはしない
- **位相**: ラックの基準位置（s = 0）のピッチ線の中央は歯溝の中心。ピニオンは接点に歯の中心が来るように `basePhase` を決める
- **運動学**（design.md §6 の書き換え）
  - 未知数を「シャフトの ω」と「ラックの速度 v」（`direction` の正の向き、mm/s）にする
  - 拘束: `v − k·r·ω = 0`、`k = (e × u)·d`（e はピニオンの軸、u はピニオンの中心から接点への単位ベクトル、d は `direction` の単位ベクトル）
  - ラックにはモーターを付けない。力のつり合いではラックは力を出さない剛体として扱う
  - 変位 s は v を積分して求める（シャフトの角度と同じく `θ = N q` の一部として積分する）
- **端でロック**（理由 `'rackEnd'`）
  - かみ合うピニオンのラック上の位置を p（`pinion` の 1 つ目は 0、`'rack'` のピニオンは `position`）とすると、s の範囲は `[max(p) − (L/2 − 余白), min(p) + (L/2 − 余白)]`
  - 毎フレームの積分で s が範囲を越えるなら、端で止め（s を端の値にする）、その連結成分をロックにする（ω = 0、v = 0）
  - 端にいるとき、端の拘束なしで解いた v が範囲の内向きなら、ロックを解いて動く（モーターの向きを変えれば戻る）。外向きの間はロックのまま
  - 端の判定には `MotionState` のラックの変位を使う（ロックの判定がシーンだけで決まらなくなる点を design.md に書く）
- **ウォームを含む成分**（S2-03）: ウォームのかみ合いを含む連結成分は `src/core/kinematics/worm-solve.ts`（区画ごとにトポロジカル順に解く）で解いている。ラックの v とその拘束は、ピニオンのシャフトと同じ区画に入れる（ラックとピニオンのかみ合いは双方向の拘束）
- **手で動かす**: ラックをつかんで `direction` に沿ってドラッグすると、手の位置に追従する（s に規定値を与える。無限に強い力）。端より先には行かず、端で押し続ける間はロック。ピニオンをつかんで回したときも、端でロックする
- **固定具**: S3-01 の固定の対象にラックを足す（拘束 `v = 0`）。プロパティパネル・コンテキストメニューで固定できる
  - S3-01 の作り（design.md §4・§6）: 固定具の拘束は `buildMeshGraph(scene, meshes, anchored)` が拘束行列に `ω = 0` の行として足し、`KinematicComponent.anchoredShaftIds` に残す。ウォームを含む成分は `WormSections.anchoredShaftIds` の区画の行。理由 `'anchor'` は `motion.ts` の `anchorAware`（固定具を外した `meshGraphOf` の同じ成分で解き直す）。ラックの `v = 0` も同じ行の足し方にし、`anchoredShaftIds` に相当するものをラックにも用意する。`validateScene` の `invalidAnchorTarget`（対象の種類が `'shaft'` でない）に `'rack'` を通すこと、`parseScene` の `target.kind`、`anchorOfShaft` に相当するラック用の関数、コンテキストメニューの `targetAnchorId`（今はシャフト・歯車だけ）も広げる
  - 固定具の見た目はシャフトの負の端の台座と支柱（`src/render/anchor.ts`）。ラックの固定の見た目はこのタスクで決める
- **干渉判定**: ラックを、動く範囲全体（`s` の最小 − L/2 〜 最大 + L/2）を長さとし、断面の外接円を半径とする、`direction` 向きの円柱で近似する。かみ合っているピニオンは除く
- **編集**
  - ピニオンの歯数を変えると、ラックの基準位置がついてくる（木構造）。ラックの歯数を変えると長さと s の範囲が変わり、いまの s が範囲外なら端に寄せる
  - ピニオン（`pinion` の相手）を消すと、ラックは基準位置で `detached` になる。ラックを消すと、`'rack'` のピニオンのシャフトは `detached` になる
- **形状と表示**: 直線歯のラック（歯形は台形）。毎フレーム `基準位置 + s·d` に描く。形状データのキーは `(種類, 大きさ, 歯数)`
- **保存（暫定）**: 読み込みで `racks` がないシーンは `{}` を補う（version 3 への移行は S3-05）。s は運動の状態なので保存しない（読み込むと s = 0）
- **S3-03 の時点**（design.md §4・§5・§6・§7）
  - `ShaftPlacement` に `concentric`（親のシャフトと同じ線上）と `planet`（キャリアに載った遊星。`parentGearId`・`childGearId` を持つので `ChildPlacement` に入り、`isChildPlacement` が真）を足した。`FreePlacement` は `Extract<ShaftPlacement, { origin: Vec3 }>`（`root`・`detached`）で、判定は `isFreePlacement`。`'rack'` を足すときは、`placementParentShafts`（`src/core/scene/scene.ts`。循環の判定 `meshCycle` に使う。`planet` は親の歯車のシャフトとキャリアのシャフトの 2 つ）と `shaftAxis` に場合を足す
  - かみ合いの拘束の行は `meshTerms(mesh, scene)`（`src/core/kinematics/mesh-coefficients.ts`）が `{ shaftId, coef }` の項の並びで返し、`buildMeshGraph` と `worm-solve.ts` の `Constraint.terms` が同じシャフトの項を足し合わせて行にする（遊星のかみ合いはキャリアのシャフトの項 `−(c_a + c_b)` を足す）。ラックの v を未知数に足すときも、この項の並びに足せばよい
  - 自由度 2 以上の成分を手でつかむと、つかんだシャフトの ω を規定値として残りをつり合いで解く（`worm-solve.ts` の `solveFixed` を `motion.ts` が使う）。ラックをつかむとき（s に規定値）も同じ形で解ける
  - 実際の位置: 遊星のシャフト・歯車は `resolveLayout` では基準配置で、`orbit` を添え、`src/core/layout/world.ts` の `shaftWorldOrigin`・`gearWorldCenter` で運動の状態から回す。`rackWorldOrigin` も同じファイルに置くとよい。描画は `render/sync.ts` の `update` で毎フレーム置き直している
  - `Layout` に `carriers` を足した（`Layout` の型のリテラルを作るテストは `carriers: {}` が要る）。キャリアのあるシーンでは `resolveAddition` が全体を解き直す（公転・機構の扱いのため）
  - ピッキングの種類（`PickKind`）に `'carrier'` を足した（歯車の次、モーターの前）。ラックの種類を足すときは `PICK_PRIORITY`・`RANK`・`selectionForPick`・`pruneSelection`・`main.ts` の `BODY_KINDS`・`grabTarget` に足す
  - 候補の並びは 外周 → 囲む → 遊星歯車機構（`kind: 'planetary'`）→ かさ歯車 → ねじれた位置 → 同じ軸。平歯車の親の候補は 8 + 1（遊星歯車機構）+ 同じ軸 になった。遊星のシャフトの歯車には同じ軸の候補だけを出す（ラックの候補も出さない）
  - `e2e/fixtures/*.json` の `Scene` の形のものは、すべて `"carriers": {}` を持つ（`racks` も同じように足す）

## 範囲外
- ラックの音（歯の通過音）、端に当たった音、材質、プロパティでの歯数の編集 UI（S3-05）
- 保存形式の version 3（S3-05）
- 端のばね付き止め（範囲外（拡張候補））
- ハスバのラック、ラックへのモーター、曲がったラック（範囲外）

## 作るもの
- `src/core/scene/`
  ```ts
  type RackId = string; // "rack_xxx"
  interface Rack {
    readonly id: RackId;
    readonly size: SizeKey;
    readonly teeth: number;
    readonly placement:
      | {
          readonly kind: 'pinion';
          readonly gearId: GearId;
          readonly axisStep: 1 | 2;     // direction = ピニオンの軸を axisStep 回進めた軸。normal は残りの軸
          readonly normalSign: 1 | -1;  // 歯が normal の正・負どちらを向くか
        }
      | {
          readonly kind: 'detached';
          readonly origin: Vec3;        // 基準位置のワールド座標
          readonly direction: Axis;     // 動く向き
          readonly normal: Axis;        // 歯が向く軸（direction と異なる）
          readonly normalSign: 1 | -1;
        }; // ピニオンが消されたとき、その時点の Layout の向きを写す
  }
  interface Scene {
    // 既存のフィールドに加えて
    readonly racks: Readonly<Record<RackId, Rack>>;
  }
  // ShaftPlacement に追加
  | { readonly kind: 'rack'; readonly rackId: RackId; readonly childGearId: GearId; readonly position: number }
  // Anchor の target に追加（S3-01）
  | { readonly kind: 'rack'; readonly id: RackId }
  ```
- `src/core/layout/`
  ```ts
  interface Layout {
    // 既存のフィールドに加えて
    racks: Record<RackId, { origin: Vec3; direction: Axis; normal: Axis; normalSign: 1 | -1; length: number; travel: [number, number] }>;
    rackMeshes: Array<{ gear: GearId; rack: RackId; position: number; source: 'tree' | 'contact' }>;
  }
  export function rackWorldOrigin(layout: Layout, motion: MotionState, rackId: RackId): Vec3;
  ```
- `src/core/kinematics/`: 未知数にラックの v を足す、ラックの拘束、端のロック
  ```ts
  interface MotionState {
    // 既存のフィールドに加えて
    rackPositions: Record<RackId, number>;  // s（mm）
    rackVelocities: Record<RackId, number>; // v（mm/s）
  }
  type LockReason = /* 既存の理由 */ | 'rackEnd';
  ```
- `src/core/edit/`: ラックを生やすコマンド、2 つ目のピニオン、削除の扱い、ラックの固定
- `src/core/geometry/`、`src/render/`: ラックの形状と描画
- `src/input/`: ラックの手でのドラッグ
- `e2e/fixtures/rack-basic.json`: 横 Z の起点のシャフト（原点 `[0, 60, 0]`）に中・20 歯のピニオン P（`offset` 0 → 中心 `[0, 60, 4]`）とモーター 中（60 rpm、正の向き、ON）。P にラック R（中・30 歯、`axisStep: 1` → `direction: 'x'`・`normal: 'y'`、`normalSign: 1` = 歯が上向きで P の下）
- **design.md の書き換え**
  - §4: `Scene` に `racks`、`Rack` 型（`pinion` は向きをピニオンから導き、`detached` だけが絶対の向きを持つ）、`ShaftPlacement` の `'rack'`、`Anchor` の対象にラック
  - §5: `Layout` に `racks` と `rackMeshes`。ラックの干渉の近似
  - §6: 未知数にラックの v。拘束 `v − k·r·ω = 0`。`MotionState` にラックの変位と速度。端のロックの判定に `MotionState` を使うこと。`LockInfo.reason` の型に `'rackEnd'` を実際に足す

## 受け入れ条件
- [ ] 平歯車を選ぶとラックの候補が出て、クリックでかみ合う位置にラックが置かれる
- [ ] ピニオンを回すとラックが `v = r·ω` で直線に動き、歯がめり込んで見えない
- [ ] 端に達するとロックして赤く震え、モーターを逆向きにすると戻り始める
- [ ] ラックを手でドラッグすると、ピニオンが回る
- [ ] ラックを固定すると、ピニオンも回らない（駆動されていればロック）

## テストケース
共通: `rack-basic`。r = 20、L = 60π ≈ 188.50、余白 2π、s の範囲 `[-28π, 28π]`（≈ ±87.96）。
### Vitest
- [ ] `resolveLayout`: R の `direction` `'x'`・`normal` `'y'`、基準位置 `[0, 40, 4]`、`travel` が `[-28π, 28π]`、`rackMeshes` に P と R。`interferences` が空
- [ ] 運動: P が 2π rad/s → R の v = 40π mm/s（k = (z × −y)·x = 1）
- [ ] 運動: `normalSign: -1`（R が P の上、基準位置 `[0, 80, 4]`）→ v = −40π
- [ ] 向きの追従: P のシャフトの軸を `'x'` に変える（S1-11 の `setShaftAxis`）→ R の `direction` が `'y'`、`normal` が `'z'` になり、かみ合いが保たれる（`rackMeshes` に P と R）
- [ ] 積分: dt = 1/60 で 0.5 秒 → s = 20π、ロックなし
- [ ] 端: 1 秒 → s = 28π（越えない）、ロック 1 件（理由 `'rackEnd'`）、P の ω = 0、v = 0
- [ ] 端から戻る: 端にいる状態でモーターの向きを −1 に → ロックなし、v = −40π。次のフレームで s < 28π
- [ ] 歯数 10 のラック → s の範囲 `[-8π, 8π]`
- [ ] 2 つ目のピニオン: R に `'rack'` の中・20 歯 Q（`position: 16π` = 8 ピッチ。歯先円どうしが当たらない最初の位置）→ Q の中心 `[16π, 60, 4]`、Q の ω = P の ω（同じ向き）。s の範囲 `[-12π, 28π]`。`position: 10π`（5 ピッチ）では P と干渉する
- [ ] 2 つ目のピニオンの候補: `position` がピッチの整数倍で、P と干渉しない
- [ ] 固定: R を固定 → P の ω = 0、ロック（`'anchor'`）。モーター OFF なら ロックなし
- [ ] 手で動かす: R の s に規定値（毎秒 +10 mm）→ P の ω = 0.5 rad/s。端を越える規定値 → 端で止まりロック
- [ ] 歯数の変更: P を 30 歯に → 基準位置 `[0, 30, 4]`。R を 10 歯に変えたとき s = 20π なら、s が 8π に寄せられる
- [ ] 削除: P を消す → R が `detached`、`origin` が `[0, 40, 4]`、`direction: 'x'`・`normal: 'y'`・`normalSign: 1`。Undo で戻る
- [ ] 干渉: R の動く範囲（x ≈ −182〜182）の途中に置いた別の歯車 → 干渉に入る。範囲の外 → 入らない
- [ ] 位相: s = 0 で、P の歯の中心が接点にあり、R の基準位置が歯溝の中心
### Playwright
- [ ] `rack-basic.json` → `getMotion().rackVelocities[R]` が `40 * Math.PI`（`toBeCloseTo`）
- [ ] 1.2 秒待つ → `rackPositions[R]` が `28 * Math.PI`、`locks` に `'rackEnd'`
- [ ] P を選び、プロパティでモーターの向きを逆に → `locks` が空、`rackVelocities[R]` が負
- [ ] モーターを OFF にして R を `direction` に沿ってドラッグ → `rackPositions[R]` が変わり、P のシャフトの角度が変わる
### Playwright（見た目）
- [ ] `rack-basic.json` のかみ合い部分の拡大 → `screenshots/rack-closeup.png`。端でロックした場面 → `screenshots/rack-end-locked.png`

## 人が手で確かめる項目
- ラックの歯とピニオンの歯がずれずにかみ合って動いて見える
- 端で止まったときのロックの表示が、壊れたように見えず「端に当たった」と分かる

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（§4、§5、§6）
- [ ] `status: done` にしてコミットした
