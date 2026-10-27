# Gear Simulator 設計

全タスクで共有する設計の前提。要件は [requirements.md](requirements.md)、タスクは [tasks/README.md](tasks/README.md) を参照。

- 前提を変えるタスクは、そのタスクのコミットでこの資料も書き換える。
- ここに書くのは「複数のタスクにまたがる取り決め」だけ。各タスク固有の詳細はタスク資料に書く。

## 1. ディレクトリ構成

```
src/
  core/            純粋関数のみ。three・DOM・Web Audio・IndexedDB を import しない
    constants.ts   寸法・モーター特性・しきい値などの定数（要件で決めた値はすべてここ）
    math/          Vec3 などの最小限のベクトル演算
    scene/         シーンの型、ID 生成、シーンの検証
    geometry/      インボリュート歯形、かみ合いの幾何（中心距離、位相）
    layout/        配置の木構造の解決、干渉判定、生やす候補の列挙
    kinematics/    かみ合いグラフ、力のつり合い、ロック判定、角度の積分
    edit/          編集コマンド、Undo/Redo の履歴
    audio-model/   音の高さ、鳴らす音源の選び方など、音の計算
    i18n/          辞書と翻訳関数
    io/            保存形式（JSON）のシリアライズ、バージョン移行
  render/          Three.js による描画（シーン → Object3D の同期、テーマ、ハンドル）
  input/           Pointer Events・キーボード・カメラ操作
  ui/              画面 UI（パレット、プロパティ、ツールバー、メニュー、設定）
  audio/           Web Audio による合成と再生
  storage/         IndexedDB と localStorage
  app/             状態ストア、毎フレームの更新ループ、各層の組み立て
  debug/           window.__gearSim（開発用・テスト用ビルドのみ）
  main.ts
e2e/               Playwright の通しテスト（*.spec.ts）
e2e/visual/        Playwright の見た目確認（*.spec.ts）
e2e/fixtures/      テスト用のシーン JSON、共通フィクスチャ
scripts/           性能計測などの手元用スクリプト
```

- `src/core/` から three などを import できないように、Biome の `noRestrictedImports` で禁止する。
- 単体テストは対象の隣に `*.test.ts` で置く。Vitest は `src/core/` を node 環境で実行する。

## 2. 座標系と単位

- 右手系で **Y が上**。床は y = 0 の XZ 平面。
- 長さは mm（1 = 1 mm）。角度は内部では常にラジアン、角速度は rad/s。rpm は表示と設定でだけ使う。
- 軸の向きは `'x' | 'y' | 'z'` の 3 種類だけ。軸の正の向きは各座標軸の正の向き。
- 回転の正の向きは、軸の正の向きに対する右ねじの向き（反時計回り）。
- ベクトルは `readonly [number, number, number]` の `Vec3` で表す。`core` では Three.js の `Vector3` を使わない。
- **軸の基底**（S1-03 の `core/math/axis.ts`）: 軸 `w` ごとに、軸に垂直な平面の基底 `u`・`v` を `u × v = w` の右手系で決める。
  - `'x'`: `u = +Y`、`v = +Z`、`w = +X`
  - `'y'`: `u = +Z`、`v = +X`、`w = +Y`
  - `'z'`: `u = +X`、`v = +Y`、`w = +Z`
- **軸まわりの角度**: 角度 `angle` の方向は `cos(angle)·u + sin(angle)·v`（`radialDirection(axis, angle)`）。`angle` が増える向きが回転の正の向き（右ねじ）。`mesh` の `angle` もこの角度。
- 歯形の 2D 輪郭（S1-02）のローカルの x・y・z（歯幅の方向）は、この `u`・`v`・`w` に対応させて置く（S1-04 の描画もこれに従う）。

## 3. 定数

`src/core/constants.ts` に置く（値は要件の §3.2、§5 と同じ）。

```ts
export const PRESSURE_ANGLE = (20 * Math.PI) / 180;

export const GEAR_SIZES = {
  S: { module: 1, faceWidth: 4, minTeeth: 12, maxTeeth: 80 },
  M: { module: 2, faceWidth: 8, minTeeth: 12, maxTeeth: 60 },
  L: { module: 3, faceWidth: 12, minTeeth: 12, maxTeeth: 40 },
} as const;

export const MOTOR_SIZES = {
  S: { stallTorque: 1, defaultRpm: 60 },
  M: { stallTorque: 3, defaultRpm: 30 },
  L: { stallTorque: 10, defaultRpm: 15 },
} as const;
export const MOTOR_RPM_RANGE = { min: 1, max: 120 } as const;

export const LOCK_OMEGA_EPS = 1e-6; // rad/s
export const MESH_DISTANCE_EPS = 1e-3; // mm。偶然のかみ合いの判定に使う
export const MAX_AUDIO_VOICES = 16;
export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const THUMBNAIL_SIZE = 256;
export const AXIAL_SNAP = 4; // mm。シャフト上の位置の吸着の単位（全サイズ共通）
export const MESH_PHASE_EPS = 1e-6; // rad（S1-03）
export const COLLISION_EPS = 1e-6; // mm（S1-08）
export const SHAFT_END_MARGIN = 4; // mm（S1-09）
export const EMPTY_SHAFT_HALF_LENGTH = 10; // mm（S1-09）
export const PERIMETER_CANDIDATE_COUNT = 8; // 外周の候補の方向の数（S1-10）
export const HISTORY_LIMIT = 100; // Undo の履歴に残すシーンの数の上限（S1-11）
```

各タスクで足す定数（足したタスクがこの一覧の値と合わせる）:

| 定数 | 値 | 追加するタスク |
|---|---|---|
| `COLLISION_EPS` | 1e-6 mm | S1-08 |
| `SHAFT_END_MARGIN` | 4 mm（歯車の両端からシャフトを伸ばす長さ） | S1-09 |
| `EMPTY_SHAFT_HALF_LENGTH` | 10 mm | S1-09 |
| `MESH_PHASE_EPS` | 1e-6 rad（位相が同じかどうかの比較。contact の判定には使わない） | S1-03 |
| `PERIMETER_CANDIDATE_COUNT` | 8（45° 刻み） | S1-10 |
| `HISTORY_LIMIT` | 100 | S1-11 |
| `DEFAULT_TEETH` | `{ S: 30, M: 20, L: 16 }` | S1-17 |
| `GRID_SNAP` | 5 mm（起点シャフトの床上の位置） | S1-17 |

音・カメラ・UI だけで使う定数は、各タスクの資料に書く。

## 4. シーンのデータ形式

シーンは **ユーザーが決めたこと（意図）だけ** を持つ不変データ。位置・位相・かみ合い・干渉などの導出できる値は持たない。Undo/Redo、自動保存、エクスポートはすべてこの形式を使う。

```ts
type ShaftId = string; // "shaft_xxx"
type GearId = string;  // "gear_xxx"
type MotorId = string; // "motor_xxx"
type Axis = 'x' | 'y' | 'z';
type SizeKey = 'S' | 'M' | 'L';

interface Scene {
  readonly shafts: Readonly<Record<ShaftId, Shaft>>;
  readonly gears: Readonly<Record<GearId, Gear>>;
  readonly motors: Readonly<Record<MotorId, Motor>>;
}

interface Shaft {
  readonly id: ShaftId;
  readonly placement: ShaftPlacement;
}

type ShaftPlacement =
  // 起点のシャフト。origin はワールド座標
  | { readonly kind: 'root'; readonly origin: Vec3; readonly axis: Axis }
  // 親の歯車の外周に生やしたシャフト。軸の向きは保存せず、親から導く（平歯車なら親と同じ）
  | {
      readonly kind: 'mesh';
      readonly parentGearId: GearId; // かみ合う相手（親）
      readonly childGearId: GearId;  // このシャフト上の、親とかみ合う歯車
      readonly angle: number;        // 親の軸まわりの角度（rad）
    }
  // 親が削除されてその場に残ったシャフト。削除時点のワールド座標と向きを持つ
  | { readonly kind: 'detached'; readonly origin: Vec3; readonly axis: Axis };

interface Gear {
  readonly id: GearId;
  readonly kind: 'spur'; // 段階 2・3 で 'helical' | 'bevel' | ... を足し、kind で分ける判別共用体にする
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly teeth: number;
  readonly offset: number; // シャフトの原点から、歯幅の負側の面までの軸方向の位置（mm）。AXIAL_SNAP の倍数
}

interface Motor {
  readonly id: MotorId;
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly rpm: number;       // 無負荷回転数（1〜120）
  readonly direction: 1 | -1; // 回転の正の向きに対する向き
  readonly on: boolean;
}
```

- 歯車の中心は `シャフトの原点 + (offset + 歯幅 / 2) × 軸の単位ベクトル`。`offset` を中心ではなく面の位置にしているのは、歯幅がすべて 4 の倍数なので、大きさの違う歯車を面を接して並べても 4 mm の格子に乗るようにするため。
- **区画**: 一般には、部品はシャフト上で「区画」（幅は軸方向の長さを 4 の倍数に切り上げた値）を占め、`offset` は区画の負側の面とする。平歯車では区画の幅＝歯幅。ウォームのように長さが 4 の倍数でない部品や、かさ歯車のように基準点が中心でない部品は、各タスク（S2-02、S2-03）で区画との関係を決める。
- `offset` は負の値もとれる（`AXIAL_SNAP` の倍数であればよい）。
- **向きの違う子**: 段階 2 以降の、親と軸の向きが違う配置（bevel、skew、rack など）は、向きを絶対値で持たず、親の軸からの相対値（`axisStep: 1 | 2` ＝ 親の軸を x→y→z→x の順に何回進めたか）で持つ。向きの計算は `stepAxis` 関数 1 つにまとめる（S2-02 で作る）。
- シャフトの長さの決め方は、部品によって例外がある。かさ歯車が載るシャフトは、頂点側の端を頂点の 2 mm 手前で切る（同じシャフトの頂点側にほかの部品があれば、そこまで伸ばす）。詳細は S2-02。
- `mesh` のシャフトの原点は、子の歯車が親の歯車と同じ面に来るように決める（子の `offset` を 0 として置く。かみ合う相手は同じ大きさなので、面がそろえば中心もそろう）。
- `detached` は、`mesh` だった親が削除されたときに、木から切り離して浮かせた状態。`root` と同じく位置と高さのハンドルを出す。ドラッグして別の歯車の外周候補の上で離すと、`mesh` に付け直せる（S1-19）。
- シャフトの長さは保存しない。載っている歯車の両端から `SHAFT_END_MARGIN` ずつ伸ばした長さを、レイアウトで求める。
- モーターは 1 本のシャフトに 1 個まで。軸方向の位置は持たず、描画ではシャフトの端の外側に置く。段階 1 では干渉判定に含めない。
- 歯車が 1 枚も残らなくなったシャフトは、モーターごと削除する。
- ID は `core/scene` の ID 生成関数で作る。テストでは決まった順の ID を返す生成関数を注入する。
- 段階 3 で `anchors` などのコレクションを足すときは、保存形式のバージョンを上げて移行を書く（§9）。

## 5. 導出データ（レイアウト）

`resolveLayout(scene): Layout` は純粋関数で、シーンから位置などを毎回求める。シーンの参照が同じなら、前回と同じ `Layout` のオブジェクトを返す（`WeakMap` のキャッシュ）。型は `src/core/layout/types.ts`、関数は `src/core/layout/resolve.ts`（S1-09。S1-04 の暫定版を置き換えた）。検証済みのシーン（`validateScene` が ok）を前提とし、根から到達できないシャフトとその歯車は `Layout` に含めない（例外にしない）。app は `createLayoutMemo()`（`src/app/store.ts`）でシーンの参照ごとに 1 回だけ求める。

```ts
interface Layout {
  shafts: Record<ShaftId, { origin: Vec3; axis: Axis; span: [number, number] }>;
  gears: Record<GearId, { center: Vec3; axis: Axis; pitchRadius: number; basePhase: number }>;
  meshes: Mesh[];           // かみ合っている歯車の組
  interferences: Array<[string, string]>; // 干渉している部品の組（赤い警告に使う）
}

interface Mesh {
  a: GearId;
  b: GearId;
  source: 'tree' | 'contact'; // 木の親子による / 偶然ちょうどの距離にある
}
```

- **木構造**: `mesh` のシャフトは親の歯車の位置から決まる。根（`root` / `detached`）から幅優先でたどって位置を求める。
  - `mesh` のシャフト: 向きは親の歯車の軸。原点 = 親の歯車の負側の面の位置（親のシャフトの原点 + 親の `offset` × 軸）+ `radialDirection(親の軸, angle) × centerDistance(大きさ, 親の歯数, 子の歯数)`。
  - 位相: 根のシャフトの歯車は 0、`mesh` のシャフトの子の歯車は `meshPhase(親の basePhase, 親の歯数, 子の歯数, angle)`、`mesh` のシャフトの子以外の歯車は 0。
  - `descendantShafts(scene, shaftId)`（`resolve.ts`）: `shaftId` とその先（mesh で子孫になる）シャフトの ID を幅優先の順で返す（S1-11 の削除・付け直しの循環の判定、S1-19 の吸着の相手の除外に使う）。シーンに無いシャフトなら空。
- **シャフトの長さ（`span`）**: シャフトの原点から軸方向の区間。載っている歯車の両面（`offset` と `offset + 歯幅`）の最小〜最大に、両側 `SHAFT_END_MARGIN` を足す。歯車が載っていないシャフトは `[−EMPTY_SHAFT_HALF_LENGTH, +EMPTY_SHAFT_HALF_LENGTH]`。
- **meshes の並び**: 各組は `a < b`（ID の符号単位の比較）、一覧は `(a, b)` の辞書順。`tree` は `mesh` のシャフトの `parentGearId` と `childGearId` の組。
- **偶然のかみ合い（contact）**: 木の親子でない、別のシャフトの歯車の組で、同じ大きさで、軸が同じ、歯幅の軸方向の重なりが `COLLISION_EPS` より大きく、軸に垂直な方向の中心距離がピッチ円半径の和と `MESH_DISTANCE_EPS` 以内で一致する組は、木の親子でなくてもかみ合いとして扱う。**位相が合っているかどうかは問わない**（拘束として扱い、干渉にもしない）。三角形のロックなどは、ここから生まれる。
- **ループを作る操作**: 外周の角度ハンドル（S1-19）は、子の歯車が別の歯車とちょうどかみ合う角度に吸着する。これで、ループを意図して作れる。
- **ループの辻褄**: 編集の結果、contact の距離がずれた組は、単にかみ合いではなくなる（木の辺ではないので位置は変わらない）。重なっていれば干渉として赤く表示する。
- **位相（basePhase）**: 基準シャフト（§6）の回転角が 0 のときの、歯車の回転のずれ。歯車の回転角 = `basePhase + シャフトの回転角` で、回転角 0 のとき 0 番目の歯の中心線が `u` の向き（2D 輪郭の +x）にある。木の親子では、子の歯が親の歯の谷に入るように決める（S1-03 の `meshPhase`）。
  - 親 A（位相 `φ_A`、歯数 `z_A`）の軸まわりの角度 `α` の方向に子 B（歯数 `z_B`）を置くとき、`f_A = frac((α − φ_A)·z_A / 2π)`（A の歯の並びの中での接点の位置、0〜1）、`φ_B = α + π − (2π / z_B)·(1/2 − f_A)` を `[0, 2π/z_B)` に正規化する。
  - シャフトの回転角が `θ_B = −(z_A / z_B)·θ_A` の関係を保つ限り、かみ合いが保たれる。
  - 位相を比べるときは `2π/z` を法とし、`MESH_PHASE_EPS` 以内なら同じとする（`samePhase`）。偶然のかみ合い（contact）の判定には使わない。
- **シャフトの向き**: `Shaft` は `axis` を持たない。`root`・`detached` は `placement.axis`、`mesh` は親の歯車のシャフトの向き（段階 1 では親と同じ）。`core/scene` の `shaftAxis(scene, shaftId)` で親をたどって求める（循環していれば `null`）。`Layout.shafts[id].axis` も同じ値になる。
- **干渉の判定**（S1-08。`src/core/layout/collision.ts`）: 歯車は円柱（`gearCollider`。中心・軸・半径 = 歯先円半径・半分の厚み = 歯幅/2）、シャフトは線分（`origin + span × 軸`、太さ 0）で近似する。モーターは段階 1 では判定しない（§4）。重なりの深さが `COLLISION_EPS` 以下（触れているだけ）は干渉にしない。円柱 × 円柱は軸が平行なら軸方向の区間と中心間の距離、直交なら残りの軸の座標で切った断面の区間の重なりで正確に判定する。線分 × 円柱は円柱を `COLLISION_EPS` だけ内側に縮めたものに線分の一部が入るか、線分 × 線分は同じ直線の上で `COLLISION_EPS` より長く重なるか、平行でなく両方の内側の点で交わるか。長さ 0 の線分どうしは判定しない。`findInterferences(colliders, exempt)` は全ての組を調べ（軸に平行な外接箱を x の区間で並べる sweep and prune で粗く絞り込み、箱が重なる組だけを詳しく判定する）、`exempt` の組（`meshes` の組。順序は問わない）と、歯車とそれが載ったシャフトの組を除く。結果は `[小さい ID, 大きい ID]` を辞書順（符号単位の比較）に並べ、重複しない。部品 400 個（歯車 200 枚 + シャフト 200 本）で 1 回 1ms 未満。`resolveLayout` は、全ての歯車の円柱と全てのシャフトの線分を渡し、`exempt` に `meshes` の組（contact を含む）を渡して `interferences` を埋める
- **生やす候補**（S1-10。`src/core/layout/candidates.ts` の `listGrowCandidates(scene, gearId, spec)`）: 選んだ歯車について 2 種類を返す。並びは外周（角度の昇順）→ 同じ軸（負の側 → 正の側）。
  - **外周**（`kind: 'perimeter'`）: 親と同じ大きさ・`spec.perimeterTeeth` 歯の歯車を、新しい `mesh` のシャフト（子の `offset` 0）に載せる。角度は連続だが、親の軸まわりの `PERIMETER_CANDIDATE_COUNT`（8）方向 `k·π/4` で代表させる（細かい角度は S1-19 の円弧ハンドル）。`center`・`axis`・`basePhase` は仮のシーンの `resolveLayout` から得る。
  - **同じ軸**（`kind: 'coaxial'`）: 選んだ歯車のシャフトに載った歯車の並びの両端の外側に、面を接して置く 2 か所（負の側 `offset = 最小の面 − 新しい歯幅`、正の側 `offset = 最大の面`）。大きさ・歯数は `spec.coaxialSize`・`spec.coaxialTeeth`。並びの途中の隙間は候補にしない。
  - 絞り込み: 候補を足した仮のシーン（仮の ID `__candidate_gear`・`__candidate_shaft`）を `resolveLayout` し、元のシーンに無かった干渉の組が 1 つでもあれば出さない（既存の干渉は候補を減らさない。contact は干渉ではないので、偶然ちょうどの距離でかみ合う候補は位相によらず出る）。歯数が大きさの範囲外・整数でない、シーンに無い歯車は例外。根からたどれない歯車は空。
  - 戻り値は S1-11 の `growGear` の引数にそのまま変換できる（`perimeter` → `parentGearId`・`angle`・`teeth`、`coaxial` → `shaftId`・`offset`・`size`・`teeth`）。歯車 200 枚で 1 回約 40ms。
- **歯車の中心**: `core/scene` の `gearCenter(シャフトの原点, 軸, gear)` = `シャフトの原点 + (offset + 歯幅/2) × 軸`（§4）。
- **歯形の 2D 輪郭の向き**（S1-02 の `spurOutline`）: 歯車の中心が原点、**0 番目の歯の中心線が +x 軸に乗る**（輪郭は x 軸について対称）。点は **反時計回り**（符号付き面積が正）に並べ、最後の点で最初の点を繰り返さない。位相 0 は「0 番目の歯がローカルの +x を向いた状態」で、basePhase（S1-03）とシャフトの角度はここからの回転角。
- **歯車の形状データ**（S1-02 の `buildSpurGeometry`）: 2D 輪郭のローカルの x・y はそのまま、歯幅の方向をローカルの z（−歯幅/2 〜 +歯幅/2、中心が原点）とする。シャフトを通す穴は開けない（シャフトの円柱が歯車を貫いて描かれる）。

## 6. 運動の状態と計算

運動の状態はシーンとは別に持つ。Undo の対象にもならず、保存もしない。`MotionState`・`LockInfo`・`LockReason`・`HandConstraint` の型は `src/core/kinematics/types.ts`（S1-04、S1-07）。`stepMotion`・`solveMotion`・`initialMotionState` と `MotionOptions` は `src/core/kinematics/motion.ts`（S1-07）。

```ts
interface MotionState {
  angles: Record<ShaftId, number>; // シャフトの回転角（rad）
  omegas: Record<ShaftId, number>; // 角速度（rad/s）。後から慣性を足せるように状態として持つ
  locks: LockInfo[];               // ロックしている部品の組と理由
  backDriven: MotorId[];           // 負けて逆に回されているモーター
}

type LockReason = 'contradiction' | 'stalemate'; // 段階 2・3 で 'wormBackDrive' | 'anchor' | 'rackEnd' を足す

interface LockInfo {
  reason: LockReason;
  shaftIds: ShaftId[];
  gearIds: GearId[];
}

// 手で回しているシャフトと、その目標角度（S1-07 で作る）
interface HandConstraint {
  shaftId: ShaftId;
  angle: number;
}

interface MotionOptions { paused?: boolean; hand?: HandConstraint }

// 毎フレーム呼ぶ。S1-07 で作り、S1-21（手）と S1-22（一時停止）が opts を使う。
// 戻り値の angles・omegas はシーンの全シャフトを含み、シーンに無いシャフトは含まない
function stepMotion(
  scene: Scene, layout: Layout, prev: MotionState, dt: number, opts?: MotionOptions,
): MotionState;
// 角度を進めずに ω・ロック・負けたモーターを求める（dt = 0 の stepMotion と同じ。loadScene の直後に使う）
function solveMotion(scene: Scene, layout: Layout, prev: MotionState, opts?: MotionOptions): MotionState;
function initialMotionState(): MotionState; // 全て空
```

- **剛体の単位はシャフト**。同じシャフトに載った歯車とモーターは一緒に回る。未知数はシャフトごとの ω。
- **かみ合いの拘束**: 外歯車同士では `z_a·ω_a + z_b·ω_b = 0`。拘束行列 C の零空間の基底 N を求め、`ω = N q`（q は機構の自由度）と書く。
- **力のつり合い**: モーターのトルクは `τ_i = T_stall · (d_i − ω_i / ω0_i)`（d_i は向き、ω0_i は無負荷角速度）で、ω に対して一次。仮想仕事の原理から `Nᵀ τ(N q) = 0` を解く（q についての一次方程式）。
- **解が一意でないとき**: 駆動されていない自由度があると、方程式の解が 1 つに決まらない。その場合は、解のうち **ω の二乗和が最小のもの** をとる（N の基底の取り方に結果が左右されない）。モーターがつながっていない連結成分は、これで自然に ω = 0（止まったまま）になる。OFF のモーターは無いものとして扱う。
- **つり合いの実装**（S1-06。`src/core/kinematics/motor.ts` と `balance.ts`）: シャフトごとに `D_s = Σ T_stall/ω0`、`b_s = Σ T_stall·d`（そのシャフトの ON のモーターの和）とし、シャフトに働くトルクを `b − D ω` とする。成分ごとに `(Nᵀ D N) q = Nᵀ b` を解く（`solveBalance(basis, drives)`）。一意でないときは一般解 `q_p + Z z`（`Z` は `Nᵀ D N` の零空間の基底）について `|N (q_p + Z z)|²` を最小にする `z` を取る。シーン全体は `solveVelocities(scene, graph, { paused? })` で解き、全シャフトの `omegas`、ON のモーターだけの解でのトルク `motorTorques`、成分ごとの `componentQ` を返す。`paused` なら全モーターを OFF とみなす（`motorTorques` は空）。自由度 0 の成分は `ω = 0` で、そこの ON のモーターのトルクは `T_stall·d`。ロックの判定はしない（S1-07）。rpm と rad/s の換算は `rpmToRadPerSec`・`radPerSecToRpm`。
- **基準シャフトと角度の引き継ぎ**: 連結成分ごとに基準シャフトを 1 本決める（root / detached を優先し、次に ID 順）。N は基準シャフトの行が単位行列になるように作り、q は基準シャフトの角度とする。構成が変わったら、新しい基準シャフトの現在の角度から q を引き継ぐ（S1-05、S1-07）。
- **かみ合いのグラフ**（S1-05。`src/core/kinematics/graph.ts` の `buildMeshGraph(scene, meshes)`、線形代数は `linalg.ts`）: 頂点はシャフト、辺は `Mesh`（多重辺あり、`source` は問わない）。連結成分ごとに、`Mesh` 1 つにつき 1 行の拘束行列を作り、零空間の基底 N（行 = シャフト、列 = 自由度 `dof`）を求める。`dof = 0` が回転条件の矛盾。一般の自由度では基準シャフトは `dof` 本（`referenceShaftIds`）で、root / detached を先に、次に ID の昇順（ロケールに依らない文字列の比較）に見て、それまでに選んだ行と独立なものを取る。N はその行が単位行列になる。階数の判定は、行列の成分の最大の絶対値 × 1e-9 をしきい値にする。拘束の行の係数は `meshConstraint` の 1 か所で決める（内歯車などは S2・S3 でここを分ける）。速度比は `speedRatio(graph, from, to)`（`ω_to / ω_from`、決まらなければ `null`）。
- **ロック**: 次の場合に、その連結成分をロックとし、ω = 0 にする。
  - 零空間が 0 次元なのにモーターがある（回転条件の矛盾）
  - 解の |ω| が `LOCK_OMEGA_EPS` 未満なのに、トルクを出しているモーターがある
  - 段階 2 以降で、ウォームの逆駆動、ラックの端、固定具との矛盾
  - 実装（S1-07）: 成分ごとに判定する。`contradiction` は自由度 0 の成分に ON のモーターがある（一時停止中は無いとみなす）か、手でつかんでいるとき。`stalemate` は成分に ON のモーターがあり、つり合いの解で成分の全シャフトの `|ω| < LOCK_OMEGA_EPS` のとき（ON のモーターは速度 0 で `|τ| = T_stall > 0` を出すので、「トルクを出しているモーターがある」を満たす）。`LockInfo.shaftIds`・`gearIds` はその成分のシャフトと歯車（ID の昇順）。`locks` は成分の順（先頭のシャフトの ID の昇順）。ロックした成分は `ω = 0` で、他の成分には影響しない
- **負けたモーター**（`backDriven`。S1-07）: ON のモーター（一時停止中は無い）のうち、そのシャフトの `ω · direction < −LOCK_OMEGA_EPS` のもの。ID の昇順。ロックした成分のモーターは ω = 0 なので入らない。手で回している成分では、手で求めた ω で同じ式を使う
- **角度の積分**: 毎フレーム q を積分して `θ = N q` で角度を求める。シャフトごとに積分しないので、かみ合った歯車の位相がずれない。
  - 実装（S1-07）: 成分ごとに、前の状態の基準シャフトの角度を `q` とみなし（前の状態に無ければ 0）、`q += q̇·dt`（`q̇` は S1-06 の `componentQ`。ロックした成分は 0）、全シャフトの角度を `θ = N q` で求め直す。かみ合いの構成が変わったときも同じ式なので、基準シャフトの角度は保たれ、他のシャフトはそれに合わせて付き直る。自由度 0 の成分の角度は前の値のまま（無ければ 0）。角度は `2π` で折り返さない
  - かみ合いのグラフは `stepMotion` の中で `buildMeshGraph(scene, layout.meshes)` で作り、`Layout` の参照をキーに、シーンの参照が同じ間は使い回す
- **手で回す**: つかんだシャフトの角度を手の位置で拘束する（無限に強い力）。手を離したら、つり合いの解に戻す。
  - 実装（S1-07 の `opts.hand`）: つかんだシャフトの成分（段階 1 では自由度 1）は、`(N q)_{つかんだ行} = angle` となる `q` に決め、`θ = N q`、`ω = N (q − q_前) / dt`（`q_前` は前の状態の基準シャフトの角度。`dt = 0` なら 0）とする。モーターのつり合いは無視し、`stalemate` のロックは出さない。自由度 0 なら角度を変えず `contradiction` のロックにする（モーターの有無によらない）。一時停止中でも効く。シーンに無いシャフトをつかんでいたら手は無いものとして扱う。自由度 2 以上は今は例外を投げる（S3-03 で、残りの自由度をつり合いで解く）
- **一時停止**（Space）: すべてのモーターを止めた状態で解く。シーンは変えない。`opts.paused` で渡す（S1-07）。ON のモーターが無いのと同じなので、ロックも負けたモーターも出ない

## 7. アプリの状態と層の関係

```
input / ui ──(コマンド)──▶ app/store ──▶ core（純粋関数）
                              │
                              ├─▶ render（毎フレーム、状態から Three.js のオブジェクトを同期）
                              ├─▶ audio（毎フレーム、運動の状態から音を更新）
                              └─▶ storage（シーンが変わったら自動保存）
```

- ストアは `getState` / `dispatch` / `subscribe` を持つ自作の小さなもの。

```ts
interface AppState {
  scene: Scene;
  history: History;              // S1-11
  selection: string | null;      // 選択は 1 つだけ（S1-16）
  motion: MotionState;
  sim: { paused: boolean; hand: HandConstraint | null }; // S1-21、S1-22
  view: { infoOverlay: boolean; watchMode: boolean };    // S1-14（watchMode。済）、S1-23
  palette: { size: SizeKey };    // パレットで選んでいる大きさ（S1-17）。S2-05 で種類を足す
  settings: Settings;            // localStorage に保存する（S1-30）
  currentWork: { id: string; name: string } | null;      // 開いている作品。保存しない（S1-27）
}

interface Settings {
  quality: 'high' | 'low';
  inputDevice: 'auto' | 'mouse' | 'trackpad';
  trackpadScroll: 'pan' | 'orbit';
  language: 'ja' | 'en';
  theme: 'brass' | 'wood';
  muted: boolean;
}
```

- 各欄は、それを使うタスクで足していく（上の型は段階 1 の完成形）。S1-14 で `view.watchMode`・`settings.inputDevice`・`settings.trackpadScroll` を足した（`src/app/store.ts` の `ViewState`・`Settings`。初期値は `DEFAULT_VIEW`・`DEFAULT_SETTINGS`）。ストアのアクションは `updateSettings { patch }`（値が `undefined` の項目は変えない）と `setWatchMode { on }`。どちらも値が変わらなければ購読者に知らせない。`loadScene` と編集コマンドは `view`・`settings` を保つ。
- シーンの変更は、必ず `core/edit` のコマンドを通す（Undo の履歴に積まれる）。コマンドの一覧と引数は S1-11 の資料が正。選択・カメラ・設定はシーンに含めない。
- `offset` が `AXIAL_SNAP` の倍数であることは、シーンの検証（S1-03）とコマンドの引数チェック（S1-11）で強制する。
- **部品の上での左ドラッグ**: 選択中の detached シャフトの本体なら付け直し（S1-19）、それ以外は手で回す（S1-21）。
- `reattachShaft` は、子の歯車の `offset` が 0 になるように、そのシャフト上の全歯車の `offset` を同じ量だけずらす（S1-11）。
- **編集コマンド**（S1-11。`src/core/edit/commands.ts` の `applyCommand(scene, command, { ids })`）: 入力のシーンを変えずに新しいシーンを返し、変わらない部分（コレクション・部品）は元の参照を使い回す。何も変わらなければ同じシーンの参照を返す。失敗は例外にせず `{ ok: false, error: { code: 'notFound' | 'invalidValue' | 'notAllowed', message } }`。成功の `created` は新しく作った部品の ID（作った順。例: `addRootShaft` は `[シャフト, 歯車]`）。成功したシーンは必ず `validateScene` を通る。コマンドの一覧:
  - `addRootShaft { axis, origin, gear: { size, teeth } }`、`growGear { mode: 'perimeter', parentGearId, angle, teeth }`（親と同じ大きさ・`offset 0` の歯車と `mesh` のシャフト）、`growGear { mode: 'coaxial', shaftId, offset, size, teeth }`
  - `deleteParts { ids }`（複数を 1 回の Undo で。下の削除の規則）、`removeMotor { motorId }`（モーターだけを消す別名）
  - `setGearTeeth { gearId, teeth }`、`setMeshAngle { shaftId, angle }`（`mesh` だけ。`[0, 2π)` に正規化）、`setGearOffset { gearId, offset }`（`AXIAL_SNAP` の倍数。`mesh` のシャフトの子は `notAllowed`）
  - `addMotor { shaftId, size }`（`rpm` は `MOTOR_SIZES[size].defaultRpm`、`direction 1`、`on: true`。1 本に 1 個）、`updateMotor { motorId, patch: { size?, rpm?, direction?, on? } }`（`size` を変えても `rpm` は変えない）
  - `moveShaft { shaftId, origin }`・`setShaftAxis { shaftId, axis }`（`root`・`detached` だけ。その先の `mesh` は書き換えない）
  - `reattachShaft { shaftId, childGearId, parentGearId, angle }`（`detached` だけ。大きさが同じで、親がこのシャフトとその先（`descendantShafts`）に無いこと）
  - `replaceScene { scene }`（`validateScene` を通らなければ `invalidValue`）
- **削除の規則**: 歯車を消すと、その歯車を `parentGearId` に持つ `mesh` のシャフトと、その歯車を `childGearId` に持つ自分のシャフトは、消す直前（入力のシーンの `resolveLayout`）の原点と向きで `detached` になる（その先はそのまま）。歯車が 1 枚も残らなくなったシャフトはモーターごと消す。シャフトを消すと載っている歯車とモーターも消える。同じコマンドの中で先に消えた ID は無視し、シーンに無い ID が 1 つでもあれば `notFound`。
- **Undo/Redo の履歴**（S1-11。`src/core/edit/history.ts`）: `History { past（古い順）, future（次に Redo するものが先頭）, coalesceKey }`。`execute(state, command, ctx, { coalesceKey? })` は成功し、シーンの参照が変わったときだけ積み（未来は消える。上限 `HISTORY_LIMIT`、古いものから捨てる）、失敗・何も変えないコマンドでは履歴もそのまま。`coalesceKey` を渡すと、直前に積んだときと同じキーなら新しく積まない（ドラッグなど連続した入力を 1 回の Undo にする。UI は操作ごとに別のキーを作る）。Undo・Redo・キーなしの実行でキーは途切れる。
- **ストアのアクション**（S1-11）: `loadScene`（履歴を空にしてシーンを置き換え、運動を初期化）、`command { command, coalesceKey? }`、`undo`、`redo`。シーンが変わったときは角度を引き継いで `solveMotion` で ω などを求め直す。失敗したコマンドや戻せない Undo は状態を変えず、購読者にも知らせない。新しい部品の ID は `createStore(scene, { ids })` の生成関数（既定はランダム）で作る。
- シーンの検証エラー（`SceneError`）は、問題の場所を示す `path` を持つ（S1-03 で作り、S1-28 が表示に使う）。`code` の一覧は `src/core/scene/validate.ts` の `SceneErrorCode`。
- `__gearSim.loadScene` は、Undo の履歴を空にしてシーンを置き換える（テストの準備用。ユーザーの操作で使う `replaceScene` コマンドとは別）。
- 編集コマンドは、干渉を理由に失敗しない（干渉は Layout が赤い警告として出す）。干渉する位置に置かせない・戻すといった判断は、UI 側（候補の列挙、ハンドル）が行う。
- エラーや通知は、S1-15 で作るトーストで表示する。想定内の失敗（読み込めないファイルなど）は `console.warn` にとどめ、`console.error` は出さない（§10 のテストで失敗になるため）。
- **描画の層**（S1-04）: app は `src/render/scene-view.ts` の `SceneView`（`sync(scene, layout)` / `update(motion, layout)` / `render()` / `projectToScreen(world)`）だけを使う。毎フレームの更新ループは `src/app/loop.ts`（`requestAnimationFrame`、`dt` は 0.1 秒で頭打ち）で、`sync` → 運動を進める（`stepMotion`）→ `update` → `render` の順に呼ぶ。`loadScene` の直後の運動は `solveMotion(scene, layout, initialMotionState())`（`src/app/store.ts` の `initialMotion`）。歯車は中心に置いた `Group` のローカルの x・y・z を `u`・`v`・`w` に合わせ、その子のメッシュをローカルの z まわりに `basePhase + シャフトの角度` だけ回す。
- ストア（S1-04 の `src/app/store.ts`）は、`dispatch` で状態が変わったときに購読者に知らせる（S1-11 から。失敗したコマンドでは知らせない）。毎フレームの運動は `setMotion` で入れ、購読者には知らせない。
- render は、前回と参照が変わった部品だけを作り直す。形状データ（BufferGeometry）は `(種類, 大きさ, 歯数)` をキーに共有する。
- UI は素の TypeScript で書き、DOM を直接操作する。文字列はすべて `t('key')` を通す。
- **カメラと入力**（S1-13）: `src/render/renderer.ts` の `createRenderer` は `SceneView` に加えて `camera`・`canvas`・`pickPoint(pageX, pageY)`（部品に当たればその点、なければ床 y = 0 との交点、どちらも無ければ null）を返す。カメラは `src/input/camera.ts` の `createCameraInput` が camera-controls で動かし、`main.ts` が描く前に毎フレーム `update()` を呼ぶ。マウスのボタンは camera-controls に渡さず、`src/input/pointer-route.ts` の `routePointerDown` で振り分けて自前で `rotate` / `truck` を呼ぶ（ホイールだけ camera-controls の `dollyToCursor`）。カメラのドラッグは、どのボタンも押した位置から `DRAG_THRESHOLD_PX`（4px）動いてから始まる。
  - 「部品の上か」は `CameraInput.setHitTest((pageX, pageY) => boolean)` で差し替える（既定は常に false。S1-16 がピッキングに差し替える）。経路が `'app'` のポインターはカメラが無視する（受け取り手は S1-16 以降が canvas に付ける）。
  - 右クリック（ドラッグなし）は `CameraInput.onContextRequest(listener)` で通知する（S1-29 が使う）。ブラウザ標準のメニューは canvas の `contextmenu` で止める。
  - キー入力は `src/input/keyboard.ts` の `createKeyboard(window).bind({ key | code, ctrl?, alt?, shift? }, { onDown, onUp })` にまとめる。フォーカスがテキストの入力先（`isTypingTarget`）なら `onDown` を呼ばない。`ctrl`・`alt` は省略すると「押されていない」、`shift` は「どちらでもよい」。文字キーは `event.key`（大文字・小文字を区別しない）、テンキーは `event.code`。Space（押している間は平行移動の修飾キー）・F・Home は `camera.ts` が登録する。
  - F で寄る先の選択は `CameraInputDeps.getSelection`（S1-16 で `AppState.selection` を渡す。それまでは省略して常に全体表示）。全体表示の範囲は `src/core/layout/bounds.ts` の `boundsOf`。
- **選択とピッキング**（S1-16）:
  - ピッキングは `src/render/picking.ts`。render が作る Object3D に `setPickTarget(object, kind, id)` で `userData` の `{ pickKind, pickId }` を付け、当たった物から親をたどって判別する。`Renderer.pick(pageX, pageY): PickHit | null`（`{ kind, id, point }`）は `Renderer.pickRoot`（`Group`）の下だけを `activeCamera()` で調べ、`src/input/pick-priority.ts` の `choosePick`（ハンドル ＞ 候補 ＞ 歯車 ＞ モーター ＞ シャフト、同じ種類なら手前）で 1 つ選ぶ。ハンドル（S1-17・S1-19）と候補（S1-18）は、自分の Object3D を `pickRoot` に足して `setPickTarget` する。シャフトには見えない太めの当たり判定（半径 `SHAFT_PICK_RADIUS` = 3 mm、`render/sync.ts`）を子に付けている。`pickPoint` も同じピッキングを使う（当たらなければ床）。
  - `main.ts` の `pickAt` は、描く前（`loadScene` や編集の直後）でも今のシーンで当たるように、`sync` してから `pick` する。`CameraInput.setHitTest` には「`pickAt` が null でない」を渡す。
  - クリックは `src/input/selection-input.ts` の `createSelectionInput` が canvas で受ける（カメラの経路とは別。左ボタンを `DRAG_THRESHOLD_PX` 未満の移動で離したら `onClick`。何もない所も知らせる）。`main.ts` が `selectionForPick(pickAt(x, y), scene)`（`src/app/selection.ts`。モーターはそのシャフト、ハンドル・候補は null）をストアの `select { id }` に渡す。S1-21 の手で回すは、`'app'` の経路のドラッグ（しきい値以上動いたもの）だけを扱えばよい（動かさずに離したクリックは、このまま選択になる）。
  - ストアのアクション `select { id }`（シーンに無い ID は null として扱う）。シーンが変わるアクション（編集・Undo・Redo・`loadScene`）のあとは `pruneSelection` で、無くなった部品の選択を外す。
  - ハイライトは `Renderer.setHighlight({ selected, hovered })`（`render/sync.ts`）。材質を水色の発光（選択は強く、マウスを乗せた部品は弱く）の複製に差し替える。シャフトのときはモーターも光らせる。マウスを乗せた部品は `main.ts` が描く前に毎フレーム求め直す。S1-22 のロックの赤はこれと見分けられる色・方法にする。
  - キー（`keyboard.ts` に登録）: Esc → 選択を外す、Delete・Backspace → `deleteParts { ids: [選択] }`、Ctrl+Z → Undo、Ctrl+Shift+Z → Redo（Ctrl は Mac の Cmd も含む）。
- **カメラ（応用）**（S1-14）: ホイールも camera-controls に渡さず（`mouseButtons.wheel = NONE`）、`camera.ts` が canvas の `wheel`（`passive: false`）で受ける。`src/input/wheel.ts` の `createWheelClassifier` でマウスとトラックパッドを判別し（`AppState.settings.inputDevice` が `'auto'` のときだけ）、`decideWheelAction` で zoom / pan / rotate に分ける。ズームはカーソルの下の点（注視点を通り視線に垂直な平面上）を中心に、注視点と位置を同じ倍率で縮める（マウスのホイールだけなめらかに移る）。Safari のピンチは `gesturestart` / `gesturechange` の `scale` でズームする。
  - 視点の切り替え（`src/input/views.ts`）は camera-controls の `rotateTo(方位角, 極角)` で行う（方位角は +Z が 0、+X が π/2。上・下は極角 0・π で方位角 0）。テンキーは `keyboard.ts` に `code`（`Numpad1/3/7/5`）で登録する。NumLock が切れているとテンキー 7 の `key` が `'Home'` になるので、Home の全体表示は `code` が `Numpad` で始まるときは無視する。
  - 平行投影: `createRenderer` が `PerspectiveCamera`（`camera`）と `OrthographicCamera`（`orthoCamera`。視錐台の縦の幅 `ORTHO_FRUSTUM_HEIGHT` = 100、near は負の値）を持ち、`setProjection(p)` / `activeCamera()` で描く・写す（`projectToScreen`）・ピッキングに使うカメラを切り替える。camera-controls の `camera` を差し替え、zoom を「見える高さ = 透視投影でその距離から見える高さ」（`orthoHeightForDistance`）に合わせる。平行投影でもカメラと注視点の距離は透視投影と同じ値を保つ（ズームでは距離と zoom を両方変える）ので、戻すときは zoom を 1 にするだけ。
  - 眺めるモード: `CameraInputDeps.isWatching`（`AppState.view.watchMode`）が真の間、`update()` で毎フレーム `watchAzimuthDelta`（`src/input/watch.ts`）だけ方位角を回す。ユーザーのカメラ操作（ドラッグ中・ホイール・gesture・ダブルクリック・F・Home・テンキー・軸の目印）の時刻を覚え、そこから 2 秒は止める。`setCamera`（`__gearSim`）は操作に数えない。
  - 軸の目印（`src/render/axis-gizmo.ts`）: `UiShell.gizmoSlot` に、球をボタン（`data-testid="gizmo-<ViewName>"`、`data-view`）、軸の線を SVG で置く。`main.ts` が毎フレーム描く前に `update(activeCamera)` を呼ぶ。球の位置は純粋関数 `layoutGizmo`（`axis-gizmo-layout.ts`）で求める。

- **画面の骨組み**（S1-15。`src/ui/shell.ts` の `createUiShell(root)`）: `index.html` の `#root` を CSS グリッドで分け、上にツールバー（44px）、左に部品パレット（200px）、右にプロパティパネル（260px）、中央に描画領域を置く。`main.ts` が canvas を作って `UiShell.canvasHost` に入れる。描画領域の右下に軸の目印の置き場 `UiShell.gizmoSlot`（96×96px。S1-14）。
  - ツールバーのボタンは `UiShell.toolbar.button(id)`（`ToolbarButtonId`）で受け取る。最初は `disabled` なので、各担当タスク（S1-23・S1-24・S1-25・S1-27・S1-28・S1-30）が動作を付けて `disabled = false` にする。`data-testid` は `toolbar-<id>`。文字は `toolbar.<id>`（文字と `aria-label`）・`toolbar.<id>.tooltip`（`title`）。
  - パレットの中身は `UiShell.palette.body` に入れる（S1-17・S1-18）。プロパティパネルの中身は `UiShell.properties.setContent(el)`、`null` で案内文（`properties.empty`）に戻す（S1-20）。
  - 文字列を言語の切り替えに追従させるには `src/ui/dom.ts` の `bindText(el, key, attr?, params?)`（解除関数を返す）を使う。
  - パネル・ツールバー・トーストは canvas の兄弟の要素なので、その上のポインターとホイールは canvas に届かない。カメラなど描画領域の入力は canvas に付け、`window` や `document` には付けない（ドラッグ中の `pointermove` は `setPointerCapture` で受ける）。パネルのホイールはパネルのスクロールになる。
  - canvas の大きさの変化は `createRenderer` の中の `ResizeObserver` で受け、描画バッファとカメラの縦横比を合わせる。`projectToScreen` は呼んだ時点のカメラで写す（`setCamera` の直後でも、次のフレームを待たなくてよい）。
- **トースト**（S1-15。`src/ui/toast.ts` の `showToast(key, kind, params?)`。閉じる関数を返す）: 描画領域の下寄りに重ね、新しいものを下に積む。`kind` は `'info'`（`role="status"`、3 秒）と `'error'`（`role="alert"`、6 秒）。閉じるボタンでも消せる。文字は `t(key, params)` で出し、言語が変わったら書き換える。要素は `data-testid="toast"`・`data-kind`、文字は `toast-message`、閉じるボタンは `toast-close`。シェルが無いとき（単体で import したとき）は `body` の下に出す。

## 8. 国際化

- 辞書は `core/i18n/ja.ts` と `core/i18n/en.ts`。`ja` のキーを正とし、`en` は同じキーを持つことを型で強制する。
- 言語は設定から切り替える。初期値はブラウザの言語（`ja` で始まれば日本語、それ以外は英語）。
- 純粋な部分は `core/i18n/index.ts`（`Lang`・`MessageKey`・`MessageParams`・`detectLanguage`・`translate`・`interpolate`・`placeholdersOf`）。差し込みは `{name}` の形で、`params` に無い差し込みはそのまま残す。`ja` と `en` の差し込みの集合は同じにする（Vitest で確かめる）。
- 実行時の言語は `app/i18n.ts` が持つ（`t`・`getLanguage`・`setLanguage`・`onLanguageChange`。DOM には触れない）。画面の文字列はすべて `t()` で出し、言語が変わったら `onLanguageChange` で書き換える。`setLanguage` は言語が変わったときだけ購読者に知らせる。
- `main.ts` が、言語が変わるたびに `document.title = t('app.title')` と `<html lang>` を合わせる。
- 辞書のキーは各 UI タスクが、そのタスクで `ja.ts` と `en.ts` の両方に足す。

## 9. 保存形式

```ts
interface SaveFile {
  format: 'gear-simulator';
  version: number; // 1 から始める
  scene: Scene;
}
```

- JSON のエクスポート、IndexedDB の作品と自動保存は、すべてこの形式を使う。
- 読み込むときは `migrate(file)` で最新のバージョンまで順に変換し、`core/scene` のシーン検証関数（S1-03）で検証する。検証はこの 1 か所にまとめる。不正な形式は例外にせず、エラーの結果を返す。
- IndexedDB は `gear-simulator` データベースの `works` ストア（作品：id、名前、更新日時、サムネイルの Blob、SaveFile）と `autosave` ストア（キー `'current'` に `{ updatedAt, file: SaveFile }` の 1 件のみ）。
- 作品を開くこととインポートは、`replaceScene` コマンドでシーン全体を差し替える（Undo で前のシーンに戻れる）。
- 設定は localStorage の `gear-simulator:settings` に JSON で保存する。読み書きは try/catch で囲み、失敗したら初期値で動かす。

## 10. テストの取り決め

- `pnpm verify` = `biome check . && tsc --noEmit && vitest run && playwright test`。コミット前に必ず通す。
- **Vitest**: `src/**/*.test.ts`。`core` は厚くテストする。浮動小数の比較は `toBeCloseTo` を使う。
- **型検査**: `tsconfig.json` は `strict: true` と `noUncheckedIndexedAccess: true`（配列や Record の添字アクセスは `T | undefined` になる）を採る。`noEmit` で、`src/`・`e2e/`・設定ファイルを対象にする。
- **Biome**: `docs/`・`.claude/`・Markdown は検査しない（資料の書式を崩さないため）。`src/core/**` には `noRestrictedImports` で three・camera-controls と外の層への import を禁止し、表しきれない規則は `src/core/import-rules.test.ts` で補う。
- **Playwright**: Chromium のみ。`webServer` で `vite --mode e2e --port 5174 --strictPort` を起動する。WebGL は SwiftShader で動かす（起動引数 `--use-angle=swiftshader` と `--enable-unsafe-swiftshader`。GPU の無い環境でも動く）。ブラウザが無い環境では `pnpm e2e:install`（`playwright install chromium`）を先に実行する。
  - 共通フィクスチャ（`e2e/fixtures/test.ts`）で、コンソールエラーと pageerror を集め、テストの終わりに 0 件であることを確かめる。すべての spec はこの `test` を import する。
  - Playwright は `__gearSim.isReady()` が `true` になる（最初のフレームを描いた）のを待ってから操作する。
  - 準備に時間のかかるシーンは `e2e/fixtures/*.json` を `__gearSim.loadScene()` で読み込んで作る。
- `core` の部品（S1-05〜S1-11）を作ったタスクは、そのタスクの中でアプリ（`app/`）にも組み込み、画面で使われる状態にする。ただし S1-10（候補の列挙）は選択の仕組み（S1-16）が必要なので、組み込みは S1-18 で行う。
- **見た目の確認**（`e2e/visual/`）: スクリーンショットを `screenshots/<場面名>.png` に保存する（git では無視する）。自動で判定するのは「真っ黒・真っ白でない」（画素の分散がしきい値以上）ことだけ。`e2e/fixtures/visual.ts` の `captureScene(page, name)` を使う（しきい値は `e2e/fixtures/blank.ts` の `BLANK_VARIANCE_THRESHOLD` = 輝度の分散 4）。
- **`window.__gearSim`**: `import.meta.env.MODE !== 'production'` のときだけ公開する（`src/debug/gear-sim.ts` の `installGearSim`。型は `GearSimDebug` で、API を足すタスクがこの型を広げる）。

```ts
interface GearSimDebug {
  isReady(): boolean; // 最初のフレームを描いたら true（S1-01）
  getScene(): Scene;
  getLayout(): Layout;
  getMotion(): MotionState;
  getSelection(): string[];          // 選択が無ければ []、あれば [id]（S1-16。AppState.selection は string | null）
  loadScene(scene: Scene): void;     // 履歴を空にする（Undo の対象にしない）
  dispatch(command: Command): void;  // 編集コマンドを実行して履歴に積む。失敗したら何も変えない
  undo(): void;                      // 戻せなければ何もしない
  redo(): void;
  // 画面上の位置を求める。Playwright でクリックやドラッグの座標に使う
  projectToScreen(world: Vec3): { x: number; y: number };
  getLanguage(): Lang;               // 現在の画面の言語（S1-12）
  setLanguage(lang: Lang): void;     // タブの題名と <html lang> も変わる（S1-12）
  getCamera(): CameraPose;           // 今の視点（移っている途中ならその時点の値。S1-13）
  setCamera(pose: Pick<CameraPose, 'position' | 'target'>): void; // transition なしで即座に（S1-13）
  getLastContextRequest(): { x: number; y: number } | null; // 最後の右クリック（ドラッグなし）のページ座標（S1-13）
  getInputDevice(): InputDevice;     // 'mouse' | 'trackpad'。今使っている（判別した、または固定した）デバイス（S1-14）
  updateSettings(patch: Partial<Settings>): void; // 設定の一部を変える。S1-30 の設定画面も同じ経路（S1-14）
  setWatchMode(on: boolean): void;   // 眺めるモードの ON/OFF（S1-14）
  getGizmoTargets(): Array<{ view: ViewName; x: number; y: number }>; // 軸の目印の球の中心のページ座標（S1-14）
  pick(x: number, y: number): PickHit | null; // ページ座標の下の部品（優先順位つき。S1-16）
  select(id: string | null): void;   // 選択を置き換える。null で外す。シーンに無い ID は null と同じ（S1-16）
}

// src/render/picking.ts（S1-16）
type PickKind = 'handle' | 'candidate' | 'gear' | 'motor' | 'shaft';
interface PickHit { kind: PickKind; id: string; point: Vec3 }

// src/input/camera.ts（S1-13）
interface CameraPose { position: Vec3; target: Vec3; projection: 'perspective' | 'orthographic' }
```

API はタスクで必要になった時点で足していく。足したらこの節も更新する。各タスクの資料で予定している追加は次のとおり。

| タスク | 追加する API |
|---|---|
| S1-01 | `isReady`（済） |
| S1-04 | `getScene` / `getLayout` / `getMotion` / `loadScene` / `projectToScreen`（済） |
| S1-11 | `dispatch` / `undo` / `redo`（済） |
| S1-12 | `getLanguage` / `setLanguage`（済） |
| S1-13 | `getCamera` / `setCamera` / `getLastContextRequest`（済） |
| S1-14 | `getInputDevice` / `updateSettings` / `setWatchMode` / `getGizmoTargets`（済） |
| S1-16 | `getSelection` / `pick` / `select`（済） |
| S1-17 | `getHandles` |
| S1-18 | `getCandidates` |
| S1-21 | `getHand` |
| S1-22 | `isPaused` / `getWarningParts` |
| S1-23 | `getInfoOverlay` |
| S1-24 | `getRenderInfo`（S1-30 で品質の切り替えを確かめるのにも使う） |
| S1-25 | `getAudio`（S1-26、S2-05、S3-05 で中身を広げる） |
| S1-27 | `getStorageStatus` |
| S1-29 | `getView` |
| S1-30 | `getSettings` |

- トーストは `__gearSim` を通さず、Playwright から `page.evaluate` で `/src/ui/toast.ts` を動的 import して呼ぶ（S1-15）。`tsconfig.json` の `paths`（`/src/*` → `./src/*`）で、この形の import にも型が付く。時間で消えることは `page.clock.install()` で開いたあと `pauseAt` で時計を止め、`runFor` で進めて確かめる。
- 描画領域は S1-15 からページより小さい（ツールバーとパネルの分）。ページ座標で「画面の内側」を確かめるときは、`page.viewportSize()` ではなく `page.locator('canvas').boundingBox()` を使う。

- テスト用のシーンは `e2e/fixtures/<名前>.json` に置く（サブフォルダは作らない）。先に作られたものがあれば使い回し、S1-31 で重複を整理する。

## 11. コミットの取り決め

- `main` に直接コミットする。1 タスク＝1 コミットを基本とする（大きいときは数コミットに分けてよい）。
- メッセージは `feat(S1-05): 力のつり合いを一次方程式で解く` の形。種類は `feat` / `fix` / `refactor` / `test` / `docs` / `chore`。
- タスク資料の `status` の更新（`doing` → `done`）は、そのタスクの最後のコミットに含める。
