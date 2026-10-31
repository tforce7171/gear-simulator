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
e2e/               Playwright の機能ごとのテスト（*.spec.ts）
e2e/flows/         Playwright の通しテスト（主要な操作の流れ。S1-31）
e2e/visual/        Playwright の見た目確認（*.spec.ts）
e2e/fixtures/      テスト用のシーン JSON、共通フィクスチャ（test.ts）、共通の操作（sim.ts）
scripts/           性能計測などの手元用スクリプト（pnpm perf。S1-31）
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
export const HELIX_ANGLE = (20 * Math.PI) / 180; // ハスバ歯車のねじれ角（固定。S2-01）

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
export const DEFAULT_TEETH = { S: 30, M: 20, L: 16 } as const; // 新しく置く・生やす歯車の歯数（S1-17）
export const GRID_SNAP = 5; // mm。起点のシャフトの床上の位置と高さの吸着の単位（S1-17）
export const BEVEL_APEX_CLEARANCE = 2; // mm。かさ歯車が載るシャフトの頂点側の端を、頂点のこの距離だけ手前で切る（S2-02）
export const WORM_THREADS = 1; // ウォームの条数（固定。右ねじ。S2-03）
export const WORM_DIAMETER_FACTOR = 10; // ウォームのピッチ円直径 = 10·m（進み角 atan(1/10)。S2-03）
export const WORM_LENGTH_PITCHES = 5; // ウォームの歯のある部分の長さ = 5·π·m（S2-03）
export const CROSSED_HELIX_ANGLE = Math.PI / 4; // ねじ歯車のねじれ角 45°（固定。右ねじれ。S2-04）
export const INTERNAL_MIN_TEETH = 24; // 内歯車の歯数の最小（最大は大きさの最大。S3-02）
export const INTERNAL_MIN_TOOTH_DIFF = 12; // 内歯車とかみ合う外歯車の歯数差の最小（S3-02）
export const INTERNAL_WEB_GAP = 8; // mm。内歯車のリングの面からウェブまでの隙間（SHAFT_END_MARGIN より大きく。S3-02）
export const INTERNAL_WEB_THICKNESS = 4; // mm。内歯車のウェブ（円板とボス）が軸方向に占める幅（S3-02）
export const PLANET_COUNT_RANGE = { min: 1, max: 6 } as const; // 1 つのキャリアの遊星の数（S3-03）
export const DEFAULT_PLANET_COUNT = 3; // 候補から作る遊星の数（S3-03）
export const PLANET_MIN_TEETH = 12; // 候補から作る遊星の歯数の最小（S3-03）
export const CARRIER_THICKNESS = { S: 4, M: 4, L: 8 } as const; // mm。キャリアの板の厚み（S3-03）
export const CARRIER_GAP = 4; // mm。太陽の歯幅の正側の面からキャリアの板までの隙間（S3-03）
export const CARRIER_RADIUS_MARGIN = 4; // mm。キャリアの腕の半径 = 公転半径 + この余白（S3-03）
export const RACK_TEETH = { min: 10, max: 60 } as const; // ラックの歯数の範囲（S3-04）
export const RACK_DEFAULT_TEETH = 30; // 候補から作るラックの歯数（S3-04）
export const RACK_ADDENDUM = 1; // ラックの歯先の高さ（m の倍数。S3-04）
export const RACK_DEDENDUM = 1.25; // ラックの歯底の深さ（m の倍数。S3-04）
export const RACK_BACK = 2; // ラックの歯底から背までの厚み（m の倍数。S3-04）
export const RACK_END_MARGIN_PITCHES = 1; // ラックの端の余白（π·m の倍数。S3-04）
export const RACK_END_EPS = 1e-6; // mm。ラックの変位が端にいるとみなす許容（S3-04）
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
| `GRID_SNAP` | 5 mm（起点シャフトの床上の位置。高さのハンドルの吸着にも使う） | S1-17 |
| `HELIX_ANGLE` | 20°（ハスバ歯車のねじれ角。ユーザーは変えられない） | S2-01 |
| `BEVEL_APEX_CLEARANCE` | 2 mm（かさ歯車のシャフトの頂点側の端と頂点の間） | S2-02 |
| `WORM_THREADS` | 1（ウォームの条数。右ねじ。ユーザーは変えられない） | S2-03 |
| `WORM_DIAMETER_FACTOR` | 10（ウォームのピッチ円直径 = 10·m。進み角 γ = atan(1/10) ≈ 5.71°） | S2-03 |
| `WORM_LENGTH_PITCHES` | 5（ウォームの歯のある部分の長さ = 5·π·m。区画の幅は 4 の倍数に切り上げて 小 16・中 32・大 48） | S2-03 |
| `CROSSED_HELIX_ANGLE` | 45°（ねじ歯車のねじれ角。向きは右で固定。同じねじれ角・同じ向きの 2 枚が軸の角度 90° = 45° + 45° でかみ合う。ユーザーは変えられない） | S2-04 |
| `INTERNAL_MIN_TEETH` | 24（内歯車の歯数の最小。最大は大きさの最大 小 80・中 60・大 40。`teethRange('internal', 大きさ)`） | S3-02 |
| `INTERNAL_MIN_TOOTH_DIFF` | 12（内歯車とかみ合う外歯車との歯数差の最小。内側での歯先の干渉を避ける。満たさない組は `canMesh` が偽） | S3-02 |
| `INTERNAL_WEB_GAP` | 8 mm（内歯車のリングのウェブ側の面からウェブまで。段階 1 のシャフトの端の余白 `SHAFT_END_MARGIN`（4 mm）より大きくし、内側の歯車のシャフトの端がウェブに当たらないようにする） | S3-02 |
| `INTERNAL_WEB_THICKNESS` | 4 mm（内歯車のウェブ（厚さ m の円板と、残りのボス）が軸方向に占める幅。`AXIAL_SNAP` の倍数にして、内歯車全体が 4 mm の格子に乗るようにする） | S3-02 |
| `PLANET_COUNT_RANGE` | 1〜6（1 つのキャリアの遊星の数） | S3-03 |
| `DEFAULT_PLANET_COUNT` | 3（遊星歯車機構の候補・`growGear`（planetary）で作る遊星の数） | S3-03 |
| `PLANET_MIN_TEETH` | 12（`defaultPlanetTeeth` が試す遊星の歯数の最小） | S3-03 |
| `CARRIER_THICKNESS` | `{ S: 4, M: 4, L: 8 }` mm（キャリアの板の厚み。`AXIAL_SNAP` の倍数） | S3-03 |
| `CARRIER_GAP` | 4 mm（太陽の歯幅の正側の面からキャリアの板の負側の面まで。`SHAFT_END_MARGIN` と同じにし、遊星のシャフトの端がちょうど板に届き、太陽・遊星の歯車が板に当たらない） | S3-03 |
| `CARRIER_RADIUS_MARGIN` | 4 mm（キャリアの腕の半径 = 公転半径 + この余白。遊星のシャフトの太さの分） | S3-03 |
| `RACK_TEETH`・`RACK_DEFAULT_TEETH` | 10〜60・既定 30（ラックの歯数。長さ L = 歯数 × π·m） | S3-04 |
| `RACK_ADDENDUM`・`RACK_DEDENDUM`・`RACK_BACK` | 1・1.25・2（m の倍数。歯先はピッチ線から m、歯底は 1.25m、背は歯底から 2m。断面の高さ 4.25m、幅は大きさの歯幅） | S3-04 |
| `RACK_END_MARGIN_PITCHES` | 1（端の余白 = π·m。ピニオンの接点がラックの端からこの距離に来たら端） | S3-04 |
| `RACK_END_EPS` | 1e-6 mm（変位が端にいるとみなす許容。範囲の外に出たと判定するときも同じ） | S3-04 |

音・カメラ・UI だけで使う定数は、各タスクの資料に書く。

## 4. シーンのデータ形式

シーンは **ユーザーが決めたこと（意図）だけ** を持つ不変データ。位置・位相・かみ合い・干渉などの導出できる値は持たない。Undo/Redo、自動保存、エクスポートはすべてこの形式を使う。

```ts
type ShaftId = string; // "shaft_xxx"
type GearId = string;  // "gear_xxx"
type MotorId = string; // "motor_xxx"
type AnchorId = string; // "anchor_xxx"（S3-01）
type CarrierId = string; // "carrier_xxx"（S3-03）
type RackId = string; // "rack_xxx"（S3-04）
type Axis = 'x' | 'y' | 'z';
type SizeKey = 'S' | 'M' | 'L';

interface Scene {
  readonly shafts: Readonly<Record<ShaftId, Shaft>>;
  readonly gears: Readonly<Record<GearId, Gear>>;
  readonly motors: Readonly<Record<MotorId, Motor>>;
  readonly anchors: Readonly<Record<AnchorId, Anchor>>; // 固定具（S3-01）
  readonly carriers: Readonly<Record<CarrierId, Carrier>>; // 遊星歯車のキャリア（S3-03）
  readonly racks: Readonly<Record<RackId, Rack>>; // ラック（S3-04）
}

interface Shaft {
  readonly id: ShaftId;
  readonly placement: ShaftPlacement;
  // シャフトの軸方向の範囲 [始まり, 終わり]（S4-03）。原点からの mm。載っている部品の範囲（余白込み）を含む。
  // 保存形式 version 4 では必須。メモリ上では省いてもよい（省けば部品から求める。下の「シャフトの長さ」）
  readonly span?: readonly [number, number];
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
  // 親のかさ歯車とかみ合うかさ歯車を載せたシャフト（S2-02）。軸の向きは親の軸を axisStep 回進めたもの
  | {
      readonly kind: 'bevel';
      readonly parentGearId: GearId; // 親のかさ歯車
      readonly childGearId: GearId;  // このシャフト上の、親とかみ合うかさ歯車
      readonly axisStep: 1 | 2;      // このシャフトの軸 = 親の軸を x → y → z → x の順に axisStep 回進めた軸
      readonly side: 1 | -1;         // 子が、親の大端の中心から見てこのシャフトの軸の正・負どちら側にあるか
    }
  // ねじれた位置の 90° でかみ合う歯車（ウォームとホイール（S2-03）、ねじ歯車同士（S2-04））を載せたシャフト（S2-03）
  | {
      readonly kind: 'skew';
      readonly parentGearId: GearId;
      readonly childGearId: GearId;
      readonly axisStep: 1 | 2;      // このシャフトの軸 = 親の軸を x → y → z → x の順に axisStep 回進めた軸
      readonly side: 1 | -1;         // 子の中心 = 親の中心 + (r_親 + r_子)·side·u（u は 2 本の軸のどちらとも直交する座標軸）
    }
  // 親が削除されてその場に残ったシャフト。削除時点のワールド座標と向きを持つ
  | { readonly kind: 'detached'; readonly origin: Vec3; readonly axis: Axis }
  // 親のシャフトと同じ線上の別のシャフト（S3-03）。原点・軸は親と同じ。キャリアやリングのシャフトに使う
  | { readonly kind: 'concentric'; readonly parentShaftId: ShaftId }
  // キャリアに載った遊星のシャフト（S3-03）
  | {
      readonly kind: 'planet';
      readonly carrierId: CarrierId;
      readonly parentGearId: GearId; // かみ合う相手。キャリアのシャフトと同じ線上の歯車（太陽歯車かリング）
      readonly childGearId: GearId;  // このシャフト上の、親とかみ合う歯車
      readonly angle: number;        // キャリアの角度が 0 のときの、キャリアの軸まわりの角度（rad）
    }
  // ラックに載せた 2 つ目以降のピニオンのシャフト（S3-04）。軸はラックの歯幅の方向（持たない）
  | {
      readonly kind: 'rack';
      readonly rackId: RackId;
      readonly childGearId: GearId;  // このシャフト上の、ラックとかみ合う平歯車（offset 0）
      readonly position: number;     // ラックの基準位置からの direction の向きの位置（mm）。π·m の整数倍に吸着
    };
// 親の歯車から位置と向きを導く配置（mesh・bevel・skew・planet）、自分で持つ配置（root・detached）、親のシャフトと同じ位置と
// 向きの concentric（S3-03）、ラックから導く rack（S3-04。parentGearId を持たないので isChildPlacement は偽）。
// isChildPlacement(p)・isFreePlacement(p) で分ける（S2-02、S3-03）
type ChildPlacement = Extract<ShaftPlacement, { parentGearId: GearId }>;
type FreePlacement = Extract<ShaftPlacement, { origin: Vec3 }>; // root・detached

interface GearBase {
  readonly id: GearId;
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly teeth: number;
  readonly offset: number; // シャフトの原点から、歯幅の負側の面までの軸方向の位置（mm）。AXIAL_SNAP の倍数
  readonly width?: number; // 厚さ（mm。S4-03 で足した省略できる欄。省けば GEAR_SIZES の faceWidth。使うのは S4-05 から）
}
interface SpurGear extends GearBase { readonly kind: 'spur' }
interface HelicalGear extends GearBase { readonly kind: 'helical'; readonly hand: 'left' | 'right' } // S2-01
interface BevelGear extends GearBase { readonly kind: 'bevel'; readonly apex: 1 | -1 } // S2-02
interface WormGear extends GearBase { readonly kind: 'worm' }       // S2-03。teeth は条数で常に WORM_THREADS（1）
interface WormWheel extends GearBase { readonly kind: 'wormWheel' } // S2-03
interface CrossedHelicalGear extends GearBase { readonly kind: 'crossedHelical' } // S2-04。右ねじれ 45°（固定）
interface InternalGear extends GearBase { readonly kind: 'internal'; readonly webSide: 1 | -1 } // S3-02
type Gear = SpurGear | HelicalGear | BevelGear | WormGear | WormWheel | CrossedHelicalGear | InternalGear;
type GearKind = Gear['kind'];
// 種類と、形を変える属性（Gear から GearBase のフィールドを除いたもの。S2-01）
type GearShape = DistributiveOmit<Gear, keyof GearBase>;

interface Motor {
  readonly id: MotorId;
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly rpm: number;       // 無負荷回転数（1〜120）
  readonly direction: 1 | -1; // 回転の正の向きに対する向き
  readonly on: boolean;
}

// 固定具（S3-01）。対象のシャフトを地面に固定する（運動の拘束 ω = 0。§6）
// 遊星歯車のキャリア（S3-03）。シャフト shaftId と一緒に回る剛体で、遊星のシャフトを支える。
// 遊星の数は、このキャリアを参照する遊星のシャフトの数（別に持たない）
interface Carrier {
  readonly id: CarrierId;
  readonly shaftId: ShaftId; // このシャフトと一緒に回る
  readonly offset: number;   // 板の負側の面の位置（mm）。AXIAL_SNAP の倍数（Gear.offset と同じ考え方）
  readonly size: SizeKey;    // 板の厚み（CARRIER_THICKNESS）に使う
}

interface Anchor {
  readonly id: AnchorId;
  readonly target:
    | { readonly kind: 'shaft'; readonly id: ShaftId }
    | { readonly kind: 'rack'; readonly id: RackId }; // S3-04（ラックの拘束 v = 0）
}

// ラック（S3-04）。直線に動く剛体。長さ L = 歯数 × π·m、歯形は圧力角 20° の直線歯（台形）
interface Rack {
  readonly id: RackId;
  readonly size: SizeKey;
  readonly teeth: number; // RACK_TEETH（10〜60）
  readonly placement:
    | {
        readonly kind: 'pinion';     // ピニオンにかみ合わせて置いた。向きはピニオンの軸から導く
        readonly gearId: GearId;
        readonly axisStep: 1 | 2;    // direction = ピニオンの軸を axisStep 回進めた軸。normal は残りの軸
        readonly normalSign: 1 | -1; // 歯が normal の正・負どちらを向くか
      }
    | {
        readonly kind: 'detached';   // ピニオンが消されて浮いた。その時点の Layout の基準位置と向きを写す
        readonly origin: Vec3;
        readonly direction: Axis;
        readonly normal: Axis;       // direction と異なる
        readonly normalSign: 1 | -1;
      };
}
```

- **歯車の種類ごとの追加フィールド**（`GearBase` に足すもの）:

  | 種類 | 追加フィールド | タスク |
  |---|---|---|
  | `'spur'`（平歯車） | なし | S1 |
  | `'helical'`（ハスバ歯車） | `hand: 'left' \| 'right'`（ねじれの向き。`'right'` は軸の正の向きに進むほど歯が正の向きに回る。ねじれ角は `HELIX_ANGLE` で固定。モジュールは軸直角モジュール） | S2-01 |
  | `'bevel'`（かさ歯車） | `apex: 1 \| -1`（ピッチ円すいの頂点が、大端のピッチ円の中心から見てシャフトの軸の正・負のどちらにあるか）。交わる角度 90°・歯数比 1:1（ピッチ円すい角 45°）のみ | S2-02 |
  | `'worm'`（ウォーム）・`'wormWheel'`（ホイール） | なし。ウォームは 1 条・右ねじ（`teeth` は条数で常に `WORM_THREADS`）、ホイールは進み角と同じねじれ角の右ねじれ（歯数の範囲・歯幅は平歯車と同じ） | S2-03 |
  | `'crossedHelical'`（ねじ歯車） | なし。ねじれ角 `CROSSED_HELIX_ANGLE`（45°）の右ねじれ（固定）。モジュールは軸直角モジュール（2 枚のねじれ角が同じなので歯直角モジュールも一致）、ピッチ円半径 `m·z/2`、歯数の範囲・歯幅は平歯車と同じ | S2-04 |
  | `'internal'`（内歯車） | `webSide: 1 \| -1`（カップの底（ウェブ）が、リングから見てシャフトの軸の正・負どちら側にあるか。既定は −1）。ピッチ円半径 `R = m·z/2`、歯先（内側）`R − m`、歯底 `R + 1.25m`、リムの外側 `R + 3.25m`、歯幅は大きさの歯幅、歯数は `INTERNAL_MIN_TEETH` 〜 大きさの最大 | S3-02 |

- **種類ごとの分岐**（S2-01）: 種類で分ける箇所は `switch (gear.kind)` にし、`default` で `assertNever`（`src/core/scene/gear-shape.ts`）を呼ぶ。種類を足すと、直す場所がコンパイルエラーで分かる（S2-01 の時点で `gear-shape.ts` の `gearShape`・`newGearShape`・`meshPartnerShape`・`GEAR_KINDS`、`geometry/can-mesh.ts` の `canMesh`・`meshKindOf`、`geometry/shape-key.ts` の `gearShapeKey`、`scene/parse.ts` の `parseScene`、`render/gear-geometry.ts` の `buildGeometry`）。歯車は `makeGear(base, shape)` で作る。
  - 新しく置く歯車の形は `newGearShape(kind)`（ハスバ歯車は `'right'`、かさ歯車は `apex: 1`）、外周に生やす子の形は `meshPartnerShape(gearShape(親))`（平歯車は平歯車、ハスバ歯車は逆の `hand`、かさ歯車・ウォーム・ホイールは `null`＝外周には生やさない。S2-02、S2-03）。ねじれた位置（`skew`）に生やす子の形は `skewPartnerShape(gearShape(親))`（ウォームにはホイール、ホイールにはウォーム（S2-03）、ねじ歯車にはねじ歯車（S2-04）、それ以外は `null`）。
  - S2-02 で `'bevel'` を足したときに直した分岐は、上の 9 か所に加えて `kinematics/mesh-coefficients.ts` の `meshCoefficients`（`mesh.kind` で分ける）。配置の種類（`ShaftPlacement['kind']`）で分ける箇所は、`isChildPlacement(p)`（`mesh`・`bevel`・`skew`）と `root`・`detached` で分ける。
  - S2-03 で `'worm'`・`'wormWheel'` を足したときに直した分岐は、上に加えて `gear-shape.ts` の `skewPartnerShape`、`geometry/can-mesh.ts` の `meshGeometryOf`（かみ合う 2 軸の位置関係 `'parallel' | 'bevel' | 'skew'`。`placementKindOf` で木の配置の種類 `mesh`・`bevel`・`skew` に対応させる）、`geometry/dimensions.ts` の `sectionWidth`（区画の幅）・`gearPitchRadius`・`gearEnvelope`（歯車を囲む円柱。干渉と表示の範囲）、`layout/resolve.ts` の `skewPhase`。歯車の中心（`gearCenter`）・シャフトの長さ・同じ軸の候補の面・干渉の円柱・表示の範囲は、歯幅でなくこれらの関数で求める。
  - S2-04 で `'crossedHelical'` を足したときは、上の分岐（`skewPartnerShape`・`meshGeometryOf`（`'skew'`）・`canMesh`・`meshKindOf`・`sectionWidth`・`gearPitchRadius`・`gearEnvelope`（歯幅・`m·z/2`・歯先円）・`skewPhase`・`meshCoefficients`・`gearShapeKey`・`buildGeometry`・`parseScene`・`GEAR_KINDS`・`newGearShape`・`gearShape`・`meshPartnerShape`（`null`））にねじ歯車の場合を足しただけで、配置の解決・4 か所の列挙・拘束の式・干渉の判定は S2-03 のものをそのまま使う。
  - 編集コマンド（S2-01）: `addRootShaft` の `gear.kind?` と `growGear`（coaxial）の `kind?`（省くと `'spur'`。`'worm'` は渡した `teeth` によらず 1 条。S2-03）。`growGear`（perimeter）の子の種類は親から決まる。`reattachShaft` はかみ合えない組（`canMesh` が偽）を `notAllowed` にする。
  - 検証（S2-01）: `parseScene` は種類ごとのフィールドを拾い（`'helical'` の `hand` は文字列）、`validateScene` は `hand` の値（`invalidHand`）と、`mesh` の親子がかみ合えること（`meshKindMismatch`）を確かめる。
- **かさ歯車**（S2-02。幾何は `src/core/geometry/bevel.ts`）:
  - R = 大端のピッチ円半径 `m·z/2`、円すい距離 `R·√2`、歯の幅 b（母線に沿った長さ）= `min(大きさの歯幅, 円すい距離 / 3)`（`bevelToothWidth`）。軸方向には `b·cos45°` を占める。
  - **区画と大端**: かさ歯車も大きさの歯幅の区画を占め、`offset` は区画の負側の面、中心は平歯車と同じ式。**大端の中心** = `中心 − apex·(歯幅/2)·軸`（区画の、頂点と反対側の面。`bevelBigEndCenter`）、**頂点** = `大端の中心 + R·apex·軸`（`bevelApex`）。歯は大端から頂点の側へ伸び、区画からはみ出さない。`apex` を反転すると（`flipBevelApex`）、区画はそのままで大端が区画の反対の面に移る。
  - **`bevel` の配置**: 子のシャフトの軸 = `stepAxis(親の軸, axisStep)`（`src/core/math/axis.ts`。S2-03 の `'skew'` などでも使う）。子の大端の中心 = `親の大端の中心 + R·side·(子の軸) + R·親の apex·(親の軸)`、子の `apex` = `−side`（親の頂点を向き、2 枚の頂点は一致する）。子の `offset` は 0 として原点を逆算する: `原点 = 子の大端の中心 − (歯幅/2)·(1 + side)·(子の軸)`（`bevelChildFrame`・`bevelChildOrigin`）。`axisStep` 2 通り × `side` 2 通りで親 1 枚につき 4 か所。親の向きが R で変わっても、子は相対の関係を保ってついてくる。
  - 位置は 4 か所の離散なので、外周の角度の円弧ハンドルは出さない。`bevel` の子の歯車には軸方向の矢印も出さない（`mesh` の子と同じ）。
  - かさ歯車は外周（`mesh`）には生やさない（`meshPartnerShape` が `null`）。`mesh` の親子はかさ歯車以外、`bevel` の親子はかさ歯車同士（検証の `meshKindMismatch`）。検証は加えて `apex` が ±1（`invalidApex`）、`axisStep` が 1・2（`invalidAxisStep`。0 は親と同じ軸）、`side` が ±1（`invalidSide`）、子の `apex === −side`（`bevelApexMismatch`）を確かめる。`version` は 1 のまま（S2-05 で 2 に上げた。§9）。
- **ウォームギア**（S2-03。寸法は `src/core/geometry/worm.ts`、ねじれた位置の幾何は `src/core/geometry/skew.ts`）:
  - ウォームは 1 条・右ねじ。m はその大きさのモジュール（ホイールの軸直角モジュールと同じ）。軸方向ピッチ `π·m`、ピッチ円半径 `5m`（`WORM_DIAMETER_FACTOR·m/2`）、歯先 `6m`、歯底 `3.75m`、進み角 `γ = atan(1/10)`、歯のある部分の長さ `5πm`。ホイールのピッチ円半径は `m·z/2`、歯幅は大きさの歯幅。
  - **区画**: ウォームの長さ `5πm` は 4 の倍数にならないので、長さを `AXIAL_SNAP` の倍数に切り上げた **区画の幅** `ceil(5πm/4)·4`（小 16、中 32、大 48。`wormSectionWidth`）を歯幅の代わりに使う。`offset` は区画の負側の面、ねじ山は区画の中央（中心 = `原点 + (offset + 区画の幅/2)·軸`）。シャフトの長さ・同じ軸に並べたときの面も区画の幅で求める。
  - **`skew` の配置**（ねじれた位置の 90°。S2-04 のねじ歯車同士も同じものを使う）: 子のシャフトの軸 = `stepAxis(親の軸, axisStep)`、u = 2 本の軸のどちらとも直交する座標軸（`thirdAxis`）として、子の中心 = `親の中心 + (r_親 + r_子)·side·u`（r はピッチ円半径。ウォームは `5m`。`skewChildFrame`）。子の `offset` は 0 として原点を逆算する: `原点 = 子の中心 − (区画の幅/2)·(子の軸)`。`axisStep` 2 通り × `side` 2 通りで親 1 枚につき 4 か所。位置は離散なので外周の角度の円弧ハンドルは出さない。
  - ウォームとかみ合えるのはホイールだけ、ホイールとかみ合えるのはウォームだけ（同じ大きさ）。`mesh` の親子は平行にかみ合う種類（平歯車・ハスバ歯車）、`bevel` の親子はかさ歯車、`skew` の親子はウォームとホイールか、ねじ歯車同士（S2-04）（検証の `meshKindMismatch`）。検証は加えて、ウォームの `teeth === 1`（`teethOutOfRange`）、`skew` の `axisStep` が 1・2（`invalidAxisStep`）、`side` が ±1（`invalidSide`）を確かめる。`version` は 1 のまま（S2-05 で 2 に上げた。§9）。
  - コマンド: `growGear { mode: 'skew', parentGearId, axisStep, side, teeth }`（ウォームにはホイール（`teeth` 歯）、ホイールにはウォーム（1 条）、ねじ歯車にはねじ歯車（`teeth` 歯。S2-04）を、同じ大きさ・`offset 0` で新しい `skew` のシャフトに載せる。ほかの親は `notAllowed`）。ウォームの `setGearTeeth` は `notAllowed`。`reattachShaft` は平行にかみ合う種類の親だけ。
- **ねじ歯車**（S2-04）: 右ねじれ 45° のねじ歯車同士（同じ大きさ。歯数は自由）が、ねじれた位置の 90° でかみ合う。S2-03 の `skew` の配置（`axisStep`・`side`、子の中心 = `親の中心 + (r_親 + r_子)·side·u`、子の `offset` 0）・4 か所の候補・拘束の式をそのまま使う。平行な軸ではかみ合わない（同じ向きのねじれは平行軸でかみ合わないため。`meshPartnerShape` は `null` で外周には生やさない）。ウォームと違ってセルフロックはせず、どちらの側からでも駆動できる（`worm-solve.ts` は `mesh.kind === 'worm'` だけを一方通行にする）。
- 歯車の中心は `シャフトの原点 + (offset + 歯幅 / 2) × 軸の単位ベクトル`。`offset` を中心ではなく面の位置にしているのは、歯幅がすべて 4 の倍数なので、大きさの違う歯車を面を接して並べても 4 mm の格子に乗るようにするため。
- **区画**: 一般には、部品はシャフト上で「区画」（幅は軸方向の長さを 4 の倍数に切り上げた値）を占め、`offset` は区画の負側の面とする。平歯車では区画の幅＝歯幅。かさ歯車は大きさの歯幅の区画を占め、大端は区画の頂点と反対側の面（S2-02。上）。ウォームは長さ `5πm` を 4 の倍数に切り上げた区画を占め、ねじ山は区画の中央（S2-03。上）。
- `offset` は負の値もとれる（`AXIAL_SNAP` の倍数であればよい）。
- **向きの違う子**: 段階 2 以降の、親と軸の向きが違う配置（bevel、skew、rack など）は、向きを絶対値で持たず、親の軸からの相対値（`axisStep: 1 | 2` ＝ 親の軸を x→y→z→x の順に何回進めたか）で持つ。向きの計算は `stepAxis(axis, step)`（`src/core/math/axis.ts`。S2-02 で作った）1 つにまとめる。`shaftAxis` は親をたどって `axisStep` を足し合わせる。
- 部品の範囲（シャフトが含まなければならない区間）の決め方は、部品によって例外がある。かさ歯車が載るシャフトは、頂点側の端を `頂点 − BEVEL_APEX_CLEARANCE·apex·軸`（2 mm 手前）より先へ伸ばさない。同じシャフトの頂点側にほかの部品が載っていれば、その部品の面 + `SHAFT_END_MARGIN` まで伸ばす（S2-02。§5 の `span`）。
- `skew` のシャフト（S2-03）の原点は、子の中心から区画の幅の半分だけ軸の負の向きに戻した点（子の `offset` は 0）。
- `mesh` のシャフトの原点は、子の歯車が親の歯車と同じ面に来るように決める（子の `offset` を 0 として置く。かみ合う相手は同じ大きさなので、面がそろえば中心もそろう）。中心距離は組の種類で決まる（`centerDistance(a, b)`。`src/core/geometry/dimensions.ts`。外歯車同士は `r_a + r_b`、内歯車と外歯車は `R − r`。S3-02）。内歯車が親なら子の外歯車は内側の、角度 `angle` の向きに `R − r` 離れた位置。外歯車が親なら子の内歯車の中心が、親の中心から角度 `angle` の向きに `R − r` 離れた位置（親を囲む）。
- **内歯車**（S3-02。寸法・軸方向の範囲・内歯の輪郭・位相は `src/core/geometry/internal.ts`）:
  - かみ合えるのは同じ大きさの平歯車だけで、歯数差（内歯車 − 平歯車）が `INTERNAL_MIN_TOOTH_DIFF` 以上の組（`canMesh`）。内歯車同士・ハスバ歯車とはかみ合わない（ハスバの内歯車は範囲外）。`meshGeometryOf` は `'parallel'`（`mesh` の配置）。
  - **カップの形**: `offset` は歯のあるリング（歯幅の区画）の負側の面で、中心はリングの中心。リングの `webSide` の側の面から `INTERNAL_WEB_GAP` 離れた位置からウェブ（軸方向に `INTERNAL_WEB_THICKNESS`）があり、リングとウェブは外周の薄い筒（半径 `R + 2.25m` 〜 `R + 3.25m`）でつながる。反対側は開いている。`webSide` −1 なら軸方向に `[offset − 12, offset + 歯幅]` を占める（`internalExtent`）。ウェブとつなぎの筒は区画の外に出る。
  - **自分のシャフト**: ウェブ（ボス）だけを通る。`span` はウェブの外側の面から `SHAFT_END_MARGIN` 伸ばし、内側の面で止める（`webSide` −1・`offset` 0 なら `[−16, −8]`）。中の空洞にシャフトを通さないので、内側に置いた歯車と干渉しない。
  - 歯数の範囲は `teethRange(kind, size)`（`src/core/geometry/dimensions.ts`。内歯車は `{ min: 24, max: 大きさの最大 }`、ウォームは `{ min: 1, max: 1 }`、それ以外は大きさの範囲）。検証（`teethOutOfRange`）、編集コマンド、プロパティパネルの歯数の入力（S1-20）もこれを使う。
  - 検証: `webSide` が ±1（`invalidWebSide`）。`mesh` の親子の歯数差は `canMesh` で見る（`meshKindMismatch`）。`version` は 2 のままだった（S3-05 で 3 に上げた）。
  - コマンド: `growGear { mode: 'perimeter' }` は内歯車の親の内側に平歯車を生やす（歯数差が足りなければ `notAllowed`）。`growGear { mode: 'enclose', parentGearId, angle, teeth }` は平歯車の親を囲む内歯車（`webSide` −1、`offset` 0）と `mesh` のシャフトを作る（平歯車以外の親・歯数差が足りない組は `notAllowed`）。`setGearTeeth` は、木の親子（`mesh`）がかみ合えなくなる変更（歯数差 12 未満）を `notAllowed` にする（シーンは変わらない）。`setWebSide { gearId, webSide }` はウェブの向きを変える（内歯車以外は `notAllowed`。UI は S3-05）。
- `detached` は、`mesh` だった親が削除されたときに、木から切り離して浮かせた状態。`root` と同じく位置と高さのハンドルを出す。ドラッグして別の歯車の外周候補の上で離すと、`mesh` に付け直せる（S1-19）。
- **シャフトの長さ**（S4-03）: シャフトは範囲 `span: [始まり, 終わり]`（原点からの mm）を持ち、レイアウトの `span` はこの値になる（S4-02 までは保存せず、部品からレイアウトで求めていた）。
  - **部品の範囲**（`requiredShaftSpans(scene)`。`resolve.ts`）: 載っている歯車ごとの区間（両面から `SHAFT_END_MARGIN`。内歯車・かさ歯車の例外は §5。`requiredSpanOf(gears)`）と、キャリアの板・遊星のシャフトの支え（S3-03）の和。部品が無ければ `null`。S4-02 までのシャフトの長さはこれ（部品が無ければ ±`EMPTY_SHAFT_HALF_LENGTH`）。
  - 検証（`validateScene`）: `span` は有限の 2 つの数で始まり < 終わり（`invalidSpan`）、部品の範囲を含む（`spanTooShort`。丸めの誤差は `COLLISION_EPS` まで許す）。4 の倍数かは見ない（version 3 から移したかさ歯車のシャフトは、頂点の手前で切った端が 4 の倍数でない）。`width` は `AXIAL_SNAP` の正の倍数（`invalidWidth`。範囲 4〜32 mm は S4-05）。
  - **範囲を省いたシャフト**: メモリ上（テストで組んだシーンなど）では `span` を省いてよく、レイアウトは部品の範囲（無ければ ±`EMPTY_SHAFT_HALF_LENGTH`。`defaultShaftSpan`）を使う。`withShaftSpans(scene)` が省いたシャフトに範囲を入れる（ストアの `createStore`・`loadScene`、`replaceScene`、`toSaveFile`、version 3 → 4 の移行が使う）。なのでアプリの中のシャフトはいつも範囲を持つ。`e2e/fixtures/*.json` の `Scene` の形のものは S4-03 からすべて `span` を持つ（今までと同じ長さ）。
  - **編集のあとの範囲**（`fitShaftSpans(prev, next)`。`applyCommand` が成功してシーンが変わったら必ず通す）: 編集で新しくできたシャフトには部品の範囲（無ければ ±10）を入れる。部品にぴったりだったシャフト（編集の前の範囲 = 部品の範囲。伸縮していないシャフト）は、部品の範囲が変われば新しい部品の範囲にする（部品についていく。かさ歯車の頂点の反転・内歯車のウェブの向きを変えても、相手のシャフトや空洞へ伸びたまま残らない）。それ以外（伸縮したシャフト）は、部品がはみ出したらその分だけ伸ばす（縮めない）。範囲を省いたままの既存のシャフトはそのまま。
  - 原点を移す編集は範囲もそのまま扱う: `deleteParts` で浮いた（`detached`）シャフトは範囲を保ち、`reattachShaft` は歯車の `offset` と一緒に範囲もずらす。
- モーターは 1 本のシャフトに 1 個まで。軸方向の位置は持たず、描画ではシャフトの端の外側に置く。段階 1 では干渉判定に含めない。
- 歯車が 1 枚も残らなくなったシャフトは、モーターごと削除する（`deleteParts` で歯車を消したとき）。
- **歯車の無いシャフト**（S4-04）: 起点のシャフトは歯車なしで置く（`addRootShaft` の `gear` を省く。長さは ±`EMPTY_SHAFT_HALF_LENGTH` の 20 mm）。歯車の無いシャフトは検証を通り、保存・読み込みできる。モーター・固定具も付けられ、回してもそのシャフトが回るだけ。上の削除の規則は変えない（置いたばかりの歯車の無いシャフトは残るが、歯車を消して 1 枚も残らなくなったシャフトは今までどおり消える）。
- ID は `core/scene` の ID 生成関数で作る。テストでは決まった順の ID を返す生成関数を注入する。
- **固定具**（S3-01）: `anchors` は固定具のコレクション。対象はシャフトで、歯車を固定するときはその歯車のシャフトを固定する（剛体の単位がシャフトのため。§6）。1 つの対象に固定具は最大 1 つ。S3-03 のキャリアはシャフトに載るので、キャリアの固定はそのシャフトの固定になる（S3-04 で対象にラックを足す）。シャフトを消すとその固定具も消える（同じ `deleteParts` の中。Undo で両方戻る）。歯車を消しても、シャフトが残る限り固定具は残る。干渉判定には含めない（見た目のための部品）。`anchorOfShaft(scene, shaftId)`・`anchoredShaftIds(scene)` は `src/core/scene/scene.ts`。
  - 検証（`validateScene`）: キーと `id` の一致（`idMismatch`）、対象の種類が `'shaft'`（`invalidAnchorTarget`）、対象のシャフトがある（`missingRef`）、1 つのシャフトに 2 つ以上（`multipleAnchors`）。`parseScene` は `anchor_` の接頭辞・`target` のオブジェクト・`kind` と `id` の文字列を確かめる。
  - **保存**: S3-01〜S3-04 の間は、`parseScene` が `anchors` の無いシーンに `{}` を補っていた（暫定）。S3-05 で保存形式を version 3 に上げ、この暫定処理を `MIGRATIONS[2]`（2 → 3 で `anchors: {}` を足す）に置き換えた（§9）。version 3 では `anchors` は必須（無い・オブジェクトでない → `invalidShape`、path `'anchors'`）。
  - テストのフィクスチャ（`e2e/fixtures/*.json` の `Scene` の形のもの）は、S3-01 からすべて `"anchors": {}` を持つ。`e2e/fixtures/anchor-pair.json`: 縦軸の起点 `shaft_a`（原点 `[0, 35, 0]`）に中・20 歯 `gear_a` とモーター 中（30 rpm、正の向き、ON）、`gear_a` の外周（角度 0）に中・40 歯 `gear_b`（`shaft_b`）。固定具はなし。
- **ラック＆ピニオン**（S3-04。寸法は `src/core/geometry/rack.ts`、関係の引きは `src/core/scene/scene.ts` の `rackFrame`・`rackShaftsOf`・`racksOfPinion`・`anchorOfRack`・`anchoredRackIds`）:
  - ラックはシャフトではなく、直線に動く新しい剛体。向きは 3 本の軸: 動く向き `direction`、歯が向く軸 `normal`（向きは `normalSign`）、残りの軸が歯幅の方向（`width`。ピニオンの軸）。`pinion` は向きを絶対の軸で持たず、ピニオンのシャフトの向きから導く（`direction = stepAxis(ピニオンの軸, axisStep)`、`normal` = 残りの軸）ので、ピニオンのシャフトの向きが変わっても相対の関係を保ってついてくる。`detached` だけが絶対の向きを持つ。
  - **基準位置**（変位 s = 0 のときのピッチ線の中央）: `pinion` では `ピニオンの中心 − r·normalSign·normal`。歯幅の方向にはピニオンと同じ区画（ピニオンの `offset` から歯幅）を占める。
  - かみ合えるのは同じ大きさの平歯車（ピニオン）だけ。ピニオンが遊星のシャフトの歯車のラックは置かない（検証の `nestedOrbit`）。
  - **2 つ目以降のピニオン**（`'rack'` の配置）: 子の中心 = 基準位置 + `position`·direction + r_子·normalSign·normal、子の `offset` は 0 として原点を逆算する（原点 = 子の中心 − 歯幅/2·width）。`position` はコマンドが π·m の整数倍に吸着させる（`snapRackPosition`）。シャフトの向きは `shaftAxis` がラックの歯幅の方向として求める（`pinion` のラックはピニオンのシャフトをたどる）。`placementParentShafts` はラックのピニオンのシャフト（浮いたラックなら無し）。
  - 検証（`validateScene`）: ラックの大きさ、歯数（`teethNotInteger`・`teethOutOfRange`）、`normalSign` が ±1（`invalidNormalSign`）、`pinion` のピニオンがある（`missingRef`）・同じ大きさ（`meshSizeMismatch`）・平歯車（`meshKindMismatch`）・遊星のシャフトでない（`nestedOrbit`）・`axisStep` が 1・2（`invalidAxisStep`）、`detached` の原点が有限（`notFinite`）・軸が正しい（`invalidAxis`）・`direction` と `normal` が違う（`rackAxesNotDistinct`）。`'rack'` のシャフトはラックがあり（`missingRef`）、子が同じ大きさの平歯車で `offset` 0。固定具の対象は `'shaft'` か `'rack'`（それ以外は `invalidAnchorTarget`）で、対象ごとに 1 つ（`multipleAnchors`）。
  - **保存**: S3-04 の間は `parseScene` が `racks` の無いシーンに `{}` を補っていた（暫定）。S3-05 で version 3 の移行（`MIGRATIONS[2]`）に置き換え、`racks` は必須になった。`e2e/fixtures/*.json` の `Scene` の形のものは S3-04 からすべて `"racks": {}` を持つ。s は運動の状態なので保存しない（読み込むと s = 0）。`e2e/fixtures/rack-basic.json`: 横 Z の起点 `shaft_p`（原点 `[0, 60, 0]`）に中・20 歯のピニオン `gear_p`（中心 `[0, 60, 4]`）とモーター 中（60 rpm、正の向き、ON）、ラック `rack_r`（中・30 歯、`axisStep` 1・`normalSign` 1 → direction x・normal y、基準位置 `[0, 40, 4]`）。
- **遊星歯車**（S3-03。条件は `src/core/geometry/planetary.ts`、部品の組み立ては `src/core/scene/planetary.ts` の `withPlanetary`、関係の引きは `src/core/scene/scene.ts` の `planetShaftsOf`・`carrierOfPlanetShaft`・`carriersOnShaft`・`lineRootOf`・`placementParentShafts`）:
  - 部品: 太陽歯車（平歯車）、キャリア（太陽と同じ線上の別のシャフト `concentric` に載る）、遊星歯車（`planet` のシャフトの平歯車）、リング（S3-02 の内歯車。太陽と同じ線上の別のシャフト `concentric`）。リングは遊星と contact でかみ合う（木の親子ではない）。
  - **同じ線上**: `concentric` を親へたどった先のシャフト（線の根。`lineRootOf`）が同じシャフトどうし。原点・軸は線の根と同じ。
  - **配置の条件**（`planetaryConditions(zs, zp, zr | null, n)`。候補と編集のコマンドが守る）: 等配 `(z_s + z_r) / n` が整数（リングなしなら真。満たさないと 1 番以降の遊星とリングの位相が合わず、歯が重なって見える。contact は位相を問わないので干渉としては検出されない）、同心 `z_r = z_s + 2·z_p`、隣どうしの遊星が当たらない `(z_s + z_p)·sin(π/n) > z_p + 2`（n = 1 は真）。n は `PLANET_COUNT_RANGE`（1〜6）。`defaultPlanetTeeth(sun, n)` は、`PLANET_MIN_TEETH` 以上で 3 条件・遊星とリングの歯数の範囲（`teethRange`）・内歯車の歯数差を満たす最小の z_p と z_r（中・24 歯 → 12・48、中・20 歯 → 13・46、大・12 歯 → 12・36、大・16 歯 → null）。
  - **作り方**（`growGear { mode: 'planetary', parentGearId }`。`withPlanetary`）: キャリアのシャフト（`concentric`）とキャリア（`offset` = 太陽の `offset` + 歯幅 + `CARRIER_GAP`。リングのウェブの反対側＝太陽の軸の正の側）、遊星のシャフト `DEFAULT_PLANET_COUNT` 本（`angle` = 2πk/n）と遊星歯車（太陽と同じ大きさ、`offset` 0）、リングのシャフト（`concentric`）と内歯車（`webSide` −1、`offset` は太陽と同じ）。`created` は `[キャリアのシャフト, キャリア, (遊星のシャフト, 遊星歯車) × n, リングのシャフト, リング]`。
  - 検証（`validateScene`）: `concentric` の親のシャフトがある（`missingRef`）、`planet` のキャリアがある（`missingRef`）、`planet` の親の歯車がキャリアのシャフトと同じ線上（`planetLineMismatch`）、`planet` の子・親の歯車の条件は `mesh` と同じ（子の `offset` 0、同じ大きさ、平行にかみ合える組）、キャリアのシャフトがあり `offset` が `AXIAL_SNAP` の倍数・大きさが正しい、キャリアのシャフト・`concentric` の親・`mesh` などの親の歯車のシャフトが遊星のシャフトでない（`nestedOrbit`。2 段以上の遊星は範囲外）。配置の親（`placementParentShafts`。`planet` は親の歯車のシャフトとキャリアのシャフトの 2 つ）をたどって循環しない（`meshCycle`）。
  - **保存**: S3-03 の間は `parseScene` が `carriers` の無いシーンに `{}` を補っていた（暫定）。S3-05 で version 3 の移行（`MIGRATIONS[2]`）に置き換え、`carriers` は必須になった。`e2e/fixtures/*.json` の `Scene` の形のものは S3-03 からすべて `"carriers": {}` を持つ。`e2e/fixtures/planetary-ring-fixed.json`: 縦軸の起点 `shaft_s`（原点 `[0, 60, 0]`）に中・24 歯の太陽 `gear_s`（`offset` 0）とモーター 中（60 rpm、正の向き、ON）、キャリア `carrier_k`（`shaft_k`、`offset` 12）、遊星 `gear_p0`〜`p2`（中・12 歯、`shaft_p0`〜`p2`、angle 0・2π/3・4π/3）、リング `gear_r`（中・48 歯、`shaft_r`）、リングのシャフトに固定具 `anchor_r`。

## 5. 導出データ（レイアウト）

`resolveLayout(scene): Layout` は純粋関数で、シーンから位置などを毎回求める。シーンの参照が同じなら、前回と同じ `Layout` のオブジェクトを返す（`WeakMap` のキャッシュ）。型は `src/core/layout/types.ts`、関数は `src/core/layout/resolve.ts`（S1-09。S1-04 の暫定版を置き換えた）。検証済みのシーン（`validateScene` が ok）を前提とし、根から到達できないシャフトとその歯車は `Layout` に含めない（例外にしない）。app は `createLayoutMemo()`（`src/app/store.ts`）でシーンの参照ごとに 1 回だけ求める。

```ts
interface Layout {
  shafts: Record<ShaftId, { origin: Vec3; axis: Axis; span: [number, number]; orbit?: Orbit }>; // orbit は S3-03
  gears: Record<GearId, { center: Vec3; axis: Axis; pitchRadius: number; basePhase: number; orbit?: Orbit }>;
  carriers: Record<CarrierId, { center: Vec3; axis: Axis; radius: number; planetShaftIds: ShaftId[] }>; // S3-03
  // ラック（S3-04）。origin は基準位置、travel は s の範囲、歯溝の中心は origin + (grooveOffset + k·π·m + s)·direction
  racks: Record<RackId, {
    origin: Vec3; direction: Axis; normal: Axis; normalSign: 1 | -1; width: Axis;
    length: number; travel: [number, number]; grooveOffset: number;
  }>;
  // ラックとピニオンのかみ合い（S3-04）。position は接点のラック上の位置（pinion のピニオンは 0、'rack' のピニオンは position）。
  // ラックの ID、次に歯車の ID の昇順
  rackMeshes: Array<{ gear: GearId; rack: RackId; position: number; source: 'tree' | 'contact' }>;
  meshes: Mesh[];           // かみ合っている歯車の組
  interferences: Array<[string, string]>; // 干渉している部品の組（赤い警告に使う）
}

interface Mesh {
  a: GearId;
  b: GearId;
  source: 'tree' | 'contact'; // 木の親子による / 偶然ちょうどの距離にある
  kind: MeshKind;             // かみ合いの種類（S2-01。meshKindOf）
  carrierShaftId?: ShaftId;   // 遊星のシャフトの歯車がかかわるかみ合いの、キャリアのシャフト（S3-03。§6 のウィリスの式）
}

// 公転（S3-03）。遊星のシャフトとその歯車に付く。center はキャリアの軸の上の点（キャリアのシャフトの原点）
interface Orbit { carrierId: CarrierId; carrierShaftId: ShaftId; center: Vec3 }

type MeshKind = 'spur' | 'helical' | 'bevel' | 'worm' | 'crossedHelical' | 'internal'; // 'internal' は S3-02
```

- **かみ合える組**（S2-01。`src/core/geometry/can-mesh.ts`）: `canMesh(a, b)` は種類・大きさ・形を変える属性だけで判定する（位置は見ない）。同じ大きさで、平歯車同士か、ねじれの向きが逆のハスバ歯車同士か、同じ歯数のかさ歯車同士（S2-02。歯数比 1:1 のみなので歯数も見る。`apex` は問わない）か、ウォームとホイール（S2-03。`meshKindOf` はどちらも `'worm'`）か、ねじ歯車同士（S2-04。どれも右ねじれ 45° なので向きは見ない。歯数は問わない。`meshKindOf` は `'crossedHelical'`）。ねじ歯車とハスバ歯車・平歯車・ホイールはかみ合わない。平歯車とハスバ歯車、同じ向きのハスバ歯車同士はかみ合わない（ねじれの向きが 2 種類しかないので、ハスバ歯車 3 枚の三角形は作れない）。内歯車（S3-02）は同じ大きさの平歯車とだけ、歯数差が `INTERNAL_MIN_TOOTH_DIFF` 以上のとき（`meshKindOf` は `'internal'`）。木の親子（`mesh`）も、かみ合える組でなければ検証で弾く。`meshKindOf(a, b)` が組のかみ合いの種類を返す（S3-02 で 2 つの形を取るようにした。どちらかが内歯車なら `'internal'`、それ以外は組のどちらの形からも同じ）。

- **木構造**: `mesh`・`bevel`・`skew` のシャフトは親の歯車の位置から決まる。根（`root` / `detached`）から幅優先でたどって位置を求める（`resolve.ts` の `placeChild` が配置の種類ごとに原点・向き・位相を決める。`resolveAddition` も同じものを使う）。（S3-03: `concentric` のシャフトは親のシャフトと同じ原点・向きで、親を置いたときに続けて置く。`planet` のシャフトは `mesh` と同じ求め方（`placeChild`）で、キャリアのシャフトが置かれてから置く（まだなら、置かれた後にもう一度試す））
  - `bevel` のシャフト（S2-02）: §4 のかさ歯車の式（`bevelChildFrame`・`bevelChildOrigin`）。
  - `skew` のシャフト（S2-03。S2-04 のねじ歯車も同じ）: §4 のウォームギアの式（`skewChildFrame`、原点 = 子の中心 − 区画の幅/2·軸）。
  - `mesh` のシャフト: 向きは親の歯車の軸。原点 = 親の歯車の負側の面の位置（親のシャフトの原点 + 親の `offset` × 軸）+ `radialDirection(親の軸, angle) × centerDistance(親, 子)`（外歯車同士は `r_a + r_b`、内歯車と外歯車は `R − r`。S3-02。外歯車同士の式は `geometry/mesh.ts` の `spurCenterDistance(大きさ, 歯数, 歯数)`）。
  - 位相: 根のシャフトの歯車は 0、`mesh` のシャフトの子の歯車は `meshPhase(親の basePhase, 親の歯数, 子の歯数, angle)`、`bevel` のシャフトの子の歯車は `bevelPhase`（下）、`skew` のシャフトの子の歯車は `skewPhase`（下）、子以外の歯車は 0。
  - `descendantShafts(scene, shaftId)`（`resolve.ts`）: `shaftId` とその先（mesh・bevel・skew で子孫になる）シャフトの ID を幅優先の順で返す（S1-11 の削除・付け直しの循環の判定、S1-19 の吸着の相手の除外に使う）。シーンに無いシャフトなら空。S3-03 から、`concentric` の子と、シャフトに載ったキャリアの遊星のシャフトも子孫に含める。
- **シャフトの長さ（`span`）**: シャフトの原点から軸方向の区間。S4-03 からシャフトの範囲 `Shaft.span`（§4）そのもの（省いたシャフトだけ下の部品の範囲。部品が無ければ `[−EMPTY_SHAFT_HALF_LENGTH, +EMPTY_SHAFT_HALF_LENGTH]`）。**部品の範囲**（`requiredShaftSpans`）: 載っている歯車ごとに、両面（`offset` と `offset + 区画の幅`。ウォーム以外は区画の幅 = 歯幅）から `SHAFT_END_MARGIN` ずつ伸ばした区間を求め、その最小〜最大をとる（`requiredSpanOf`。S4-02 までの `spanOf`。歯車が無ければ `null`）。内歯車（S3-02）の区間は、ウェブの外側の面 − `SHAFT_END_MARGIN` 〜 ウェブの内側の面（`webSide` 1 なら向きが逆。§4）。キャリア（S3-03）の載ったシャフトは、板 `[offset, offset + 厚み]` の両面から `SHAFT_END_MARGIN` 伸ばした区間も含める（歯車が無ければ板の区間だけ）。遊星のシャフトは、板の遠い側の面まで伸ばす（板を貫いて支えられる）。
  - かさ歯車（S2-02）は、自分の区間の頂点側の端を `頂点 − BEVEL_APEX_CLEARANCE`（`apex` −1 なら `頂点 + BEVEL_APEX_CLEARANCE`）より先へ伸ばさない（余白込みの端は大端から `歯幅 + SHAFT_END_MARGIN` で、小の 12〜15 歯では頂点を越え、小の 16 歯・中の 12 歯ではちょうど頂点に届くため）。切ったあとの端が、かさ歯車自身の区画の内側に入ってもよい。同じシャフトの頂点側にほかの部品が載っていれば、その部品の区間（面 + `SHAFT_END_MARGIN`）まで伸び、相手のシャフトと交われば干渉として赤く出る。
- **meshes の並び**: 各組は `a < b`（ID の符号単位の比較）、一覧は `(a, b)` の辞書順。`tree` は `mesh` のシャフトの `parentGearId` と `childGearId` の組。
- **偶然のかみ合い（contact）**: 木の親子でない、別のシャフトの歯車の組で、`canMesh(a, b)` が真（同じ大きさを含む）で、軸が同じ、歯幅の軸方向の重なりが `COLLISION_EPS` より大きく、軸に垂直な方向の中心距離がピッチ円半径の和と `MESH_DISTANCE_EPS` 以内で一致する組は、木の親子でなくてもかみ合いとして扱う。かさ歯車（S2-02）は、どちらもかさ歯車、同じ大きさ・同じ歯数、軸が直交し、頂点の距離が `MESH_DISTANCE_EPS` 以内の組（頂点が一致すればピッチ円すいは必ず接する）。ウォームとホイール（S2-03）は、同じ大きさで、軸が直交し、2 つの中心を結ぶ線が両方の軸に直交し（軸方向の成分がどちらも `MESH_DISTANCE_EPS` 以内）、その長さが `r_ウォーム + r_ホイール`（`5m + m·z/2`）と `MESH_DISTANCE_EPS` 以内の組。ねじ歯車（S2-04）も同じ条件で、どちらもねじ歯車・同じ大きさ、長さが `r_a + r_b`（`m·(z_a + z_b)/2`）と `MESH_DISTANCE_EPS` 以内の組（`inContact` の位置関係 `'skew'` の判定は種類に共通で、最後に `canMesh` を見る）。内歯車と平歯車（S3-02）は、平行軸の条件（軸が同じ、歯幅が重なる）で、軸に垂直な中心距離が `R − r` と `MESH_DISTANCE_EPS` 以内、歯数差が 12 以上（`canMesh`）の組（平行軸の中心距離は `centerDistance(a, b)` で求める）。**位相が合っているかどうかは問わない**（拘束として扱い、干渉にもしない）。三角形のロックなどは、ここから生まれる。かみ合えない組（平歯車とハスバ歯車など）がちょうどの距離にあると、歯先円の円柱が重なるので干渉になる。
- **遊星歯車の基準配置と実際の位置**（S3-03。`src/core/layout/world.ts`）: `resolveLayout` はシーンだけから求める純粋関数のまま、遊星のシャフトとその歯車の位置を **基準配置**（すべてのキャリアの角度が 0）で返し、公転の情報 `orbit`（`carrierId`・`carrierShaftId`・`center` = キャリアのシャフトの原点）を添える。実際の位置は `shaftWorldOrigin(layout, motion, shaftId)`・`gearWorldCenter(layout, motion, gearId)` で、キャリアのシャフトの回転角 `motion.angles[carrierShaftId]` だけ、`center` を通るキャリアの軸まわりに回す（`rotateAboutAxis`）。描画（毎フレーム置き直す）・音源の位置（`meshContactPoint(layout, mesh, motion)`）・情報表示のラベルと矢印・`__gearSim.getShaftWorldOrigin` はこれを使う（ピッキングは描画の位置で当たる。`projectToScreen` はワールド座標を受けるのでそのまま）。`MotionState` の形は変えない（キャリアの ω はそのシャフトの ω）。
  - `Layout.carriers`: 板の中心 = キャリアのシャフトの原点 + (`offset` + 厚み/2)·軸、`radius` = 遊星のシャフトの公転半径の最大 + `CARRIER_RADIUS_MARGIN`（遊星が無ければ余白の 2 倍）、`planetShaftIds` は `angle` の昇順（同じなら ID 順）。
  - contact と干渉の判定は基準配置で行う。太陽・リングはキャリアと同軸なので、公転しても遊星との距離は変わらない。contact は、同じキャリアで公転する組と、公転する歯車とキャリアの軸の上の歯車（太陽・リング）の組だけ（公転する歯車と、キャリアと同軸でない歯車の偶然のかみ合い・別のキャリアで公転する組は扱わない）。遊星のシャフトの歯車がかかわるかみ合いには `carrierShaftId` を添える。
  - 位相: `planet` のシャフトの子は `mesh` と同じ（`meshPhase`・`internalMeshPhase`）。`concentric` のシャフトの歯車で遊星と contact でかみ合うもの（リング）は、かみ合う遊星のうち最初のもの（`angle` の昇順、次にシャフトの ID 順。候補から作ったものでは 0 番の遊星）に合わせる（遊星を親、リングを遊星から見た向き `angle + π` の子とした `internalMeshPhase`。外歯車なら `meshPhase`）。等配の条件を満たせば、残りの遊星とも位相が合う（接点で歯の位置の端数が 0.5 ずれる）。
- **ラック**（S3-04。`resolve.ts` の `placeRackOnPinion`・`placeRackPinion`・`rackMeshesOf`・`rackLayoutsOf`・`rackCollider`、実際の位置は `world.ts` の `rackWorldOrigin`）: 浮いたラックは最初に、`pinion` のラックはピニオンを置いたときに置き、続けてラックに載ったシャフト（`'rack'`）をキューに積む（木の幅優先の一部）。`descendantShafts` は、シャフトの歯車をピニオンにしたラックに載ったシャフトも子孫に含める。
  - **位相**: 基準位置の歯溝の位置は `grooveOffset`（`[−π·m/2, π·m/2)`）。浮いたラックは 0（基準位置が歯溝の中心）。`pinion` のラックは、ピニオンの位相が木で先に決まっているので、接点に一番近いピニオンの歯の中心に歯溝が来るように決める（`grooveOffset = r·k·δφ`、δφ はその歯の接点の向きからの角度のずれ。rack-basic では 0）。`'rack'` のピニオンは、接点に一番近い歯溝の中心に歯の中心が来るように `basePhase` を決める（`position` がピッチの整数倍なら、接点が歯溝の中心）。
  - **s の範囲** `travel`: かみ合うピニオンの位置 p（木と contact の全部。無ければ 0）から `[max(p) − (L/2 − 余白), min(p) + (L/2 − 余白)]`（`rackTravel`。空なら真ん中の 1 点）。
  - **偶然のかみ合い（contact）**: 同じ大きさの平歯車で、軸がラックの歯幅の方向、中心がピッチ線から歯の側へ r（`MESH_DISTANCE_EPS` 以内）、歯幅の区画が `COLLISION_EPS` より重なり、接点が s = 0 のラックの長さの範囲にある（公転する歯車は除く）。位相は問わず、干渉にしない。
  - **干渉**: ラックを、動く範囲全体（s の最小 − L/2 〜 最大 + L/2）を長さとし、断面（歯幅 × 4.25m）の外接円を半径とする、direction 向きの円柱で近似する（中心はピッチ線から背の側へ 1.125m）。`rackMeshes` の組は `exempt`。ラックのあるシーンの `resolveAddition` は全体を解き直す（候補でピニオンが増えると範囲が変わるため）。
- **ループを作る操作**: 外周の角度ハンドル（S1-19）は、子の歯車が別の歯車とちょうどかみ合う角度に吸着する。これで、ループを意図して作れる。
- **ループの辻褄**: 編集の結果、contact の距離がずれた組は、単にかみ合いではなくなる（木の辺ではないので位置は変わらない）。重なっていれば干渉として赤く表示する。
- **位相（basePhase）**: 基準シャフト（§6）の回転角が 0 のときの、歯車の回転のずれ。歯車の回転角 = `basePhase + シャフトの回転角` で、回転角 0 のとき 0 番目の歯の中心線が `u` の向き（2D 輪郭の +x）にある。木の親子では、子の歯が親の歯の谷に入るように決める（S1-03 の `meshPhase`）。
  - 親 A（位相 `φ_A`、歯数 `z_A`）の軸まわりの角度 `α` の方向に子 B（歯数 `z_B`）を置くとき、`f_A = frac((α − φ_A)·z_A / 2π)`（A の歯の並びの中での接点の位置、0〜1）、`φ_B = α + π − (2π / z_B)·(1/2 − f_A)` を `[0, 2π/z_B)` に正規化する。
  - シャフトの回転角が `θ_B = −(z_A / z_B)·θ_A` の関係を保つ限り、かみ合いが保たれる。
  - 位相を比べるときは `2π/z` を法とし、`MESH_PHASE_EPS` 以内なら同じとする（`samePhase`）。偶然のかみ合い（contact）の判定には使わない。
  - ウォームとホイール（S2-03。`skewPhase` → `wheelPhaseFromWorm`・`wormPhaseFromWheel`）: 接点でウォームのねじ山の中心とホイールの歯溝の中心が重なるようにする。ウォームの位相は、ねじ山が軸方向に進む量と同じに扱う（位相 0 で、ウォームの軸まわりの角度 θ の方向のねじ山の中心は、ウォームの中心から軸方向に `π·m·θ/2π`（π·m を法として）。回転角 φ でねじ山は `π·m·φ/2π` だけ軸の負の向きに移る）。n = ウォームの中心からホイールの中心への単位ベクトル、θ_c = n のウォームの軸まわりの角度、α_c = −n のホイールの軸まわりの角度、s = `(e_W × n)·e_H` として `z·(φ_H − α_c)/2π + 1/2 ≡ s·(θ_c − φ_W)/2π (mod 1)`。時間で微分すると §6 の拘束 `z·ω_H + s·ω_W = 0` と一致するので、回してもずれない。ホイールの歯幅の中央の面はウォームの軸を通るので、ねじれ（中央の断面が平歯車と一致）は位相に効かない。
  - ねじ歯車（S2-04。`skewPhase` → `crossedHelicalPhase`）: 接点（中心を結ぶ線上。歯幅の中央の断面どうし）で、親の歯の中心と子の歯溝の中心が重なるようにする。ウォームとホイールの式の条数 1 を親の歯数に置き換えたもの: P = 親（歯数 `z_P`、位相 `φ_P`）、C = 子（歯数 `z_C`）、n = P の中心から C の中心への単位ベクトル、`θ_c` = n の P の軸まわりの角度、`α_c` = −n の C の軸まわりの角度、`s = (e_P × n)·e_C` として `z_C·(φ_C − α_c)/2π + 1/2 ≡ s·z_P·(θ_c − φ_P)/2π (mod 1)`。`φ_C` を `[0, 2π/z_C)` に正規化する。時間で微分すると拘束の式になり、P と C を入れ替えても同じ関係になる。
  - かさ歯車（S2-02。`bevelPhase`）: 2 つの大端のピッチ円の接点 `P = 親の大端の中心 + R·side·(子の軸)` で、親の歯の中心と子の歯溝の中心が重なるようにする。`f_A` = P での親の歯の位置（歯 1 ピッチを 1 とした端数。`toothFraction`）。P での周速の向き `e × (P − 大端の中心)` が親子で同じ（ω の比が +1）なら子の端数 `f_B = f_A + 1/2`、逆（比が −1）なら `f_B = 1/2 − f_A`。`φ_B = (P の子の軸まわりの角度) − (2π/z)·f_B` を `[0, 2π/z)` に正規化する。
- **シャフトの向き**: `Shaft` は `axis` を持たない。`root`・`detached` は `placement.axis`、`mesh` は親の歯車のシャフトの向き、`bevel`・`skew` は親の歯車のシャフトの向きを `axisStep` 回進めたもの（S2-02、S2-03）。`core/scene` の `shaftAxis(scene, shaftId)` で親をたどって求める（循環していれば `null`）。`Layout.shafts[id].axis` も同じ値になる。`concentric` は親のシャフト、`planet` はキャリアのシャフトの向き（S3-03）。
- **干渉の判定**（S1-08。`src/core/layout/collision.ts`）: 歯車は円柱（`gearCollider`。中心・軸・半径 = 歯先円半径・半分の厚み = 歯幅/2。かさ歯車（S2-02）は歯のある円すい台に外接する円柱: 大端の中心から頂点の側へ `b·cos45°` の長さ、半径 `R + m·cos45°`（大端の歯先）。ウォーム（S2-03）は半径 `5m + m`・長さ `5πm`（区画の幅ではなく歯のある部分）の円柱、ホイールとねじ歯車（S2-04）は歯先円の円柱（`gearEnvelope`）。内歯車（S3-02）は、リングとつなぎの筒を **中空の円柱**（`kind: 'hollow'`。内側の半径 `R − m`、外側 `R + 3.25m`、軸方向はリングとウェブまでの隙間）と、ウェブの円柱（半径 `R + 3.25m`、軸方向に `INTERNAL_WEB_THICKNESS`）の 2 つ（どちらも歯車の ID）で近似する）、シャフトは線分（`origin + span × 軸`、太さ 0）で近似する。モーターは段階 1 では判定しない（§4）。重なりの深さが `COLLISION_EPS` 以下（触れているだけ）は干渉にしない。円柱 × 円柱は軸が平行なら軸方向の区間と中心間の距離、直交なら残りの軸の座標で切った断面の区間の重なりで正確に判定する。線分 × 円柱は円柱を `COLLISION_EPS` だけ内側に縮めたものに線分の一部が入るか、線分 × 線分は同じ直線の上で `COLLISION_EPS` より長く重なるか、平行でなく両方の内側の点で交わるか。長さ 0 の線分どうしは判定しない。`findInterferences(colliders, exempt)` は全ての組を調べ（軸に平行な外接箱を x の区間で並べる sweep and prune で粗く絞り込み、箱が重なる組だけを詳しく判定する）、`exempt` の組（`meshes` の組。順序は問わない）と、歯車とそれが載ったシャフトの組を除く。結果は `[小さい ID, 大きい ID]` を辞書順（符号単位の比較）に並べ、重複しない。部品 400 個（歯車 200 枚 + シャフト 200 本）で 1 回 1ms 未満。**中空の円柱**（S3-02）: 平行な円柱（軸からの距離 d、半径 ρ）は `d + ρ ≤ R − m` なら空洞に収まって干渉なし、`d − ρ ≥ R + 3.25m` なら外にあって干渉なし、それ以外で軸方向が重なれば干渉。平行な線分は軸からの距離が `R − m` 以下なら空洞を通るので干渉なし（ウェブまで伸びればウェブの円柱と干渉。自分のシャフトは除く）。平行でない部品は空洞を無視して外側の円柱として扱う（安全側）。中空同士は、どちらかがもう一方の空洞に収まるか外側どうしが離れていれば干渉なし。`resolveLayout` は、全ての歯車の円柱と全てのシャフトの線分を渡し、`exempt` に `meshes` の組（contact を含む）を渡して `interferences` を埋める
  - **遊星歯車**（S3-03）: キャリアの板を円柱（板の中心・`radius`・厚み）で足す。同じ線上のシャフト同士（`lineRootOf` が同じ。入れ子の中空軸）と、機構の部品（キャリアとそのシャフト、遊星のシャフトとその子の歯車、親の歯車（太陽）、子の歯車と contact でかみ合うキャリアの軸の上の歯車（リング）、太陽とリングのシャフト）の間の組は `exempt` に入れる（かみ合いと支えの関係。隣どうしの遊星は配置の条件で保証する）。公転する部品（遊星のシャフトとその歯車）は、同じキャリアで公転する部品とは基準配置で、それ以外の部品とは **公転で掃く範囲**（キャリアの軸まわりの中空の円柱。歯車は軸からの距離 d・半径 ρ で内側 d − ρ・外側 d + ρ、シャフトの線分は内側・外側とも d。軸方向の範囲はそのまま）で判定する（`findInterferences` を 2 回呼び、組の公転の有無で分ける）。段付きの遊星（遊星のシャフトに同じ軸で足した歯車）は機構の部品に含めないので、リングやキャリアと重なれば干渉になる。
- **生やす候補**（S1-10。`src/core/layout/candidates.ts` の `listGrowCandidates(scene, gearId, spec)`）: 選んだ歯車について、新しいシャフトを作る候補を返す。並びは外周（角度の昇順）→ 囲む → 遊星歯車機構 → ラック → かさ歯車 → ねじれた位置。**同じ軸の候補（`'coaxial'`）は S4-03 で廃止した**（シャフトを選んでマウスを乗せ、シャフトの上の好きな位置に置く。下の「シャフトの上に置く」）。`GrowSpec` は `{ perimeterTeeth, kind }`（`coaxialSize`・`coaxialTeeth` も S4-03 で除いた）。
  - 候補は作る歯車の形 `shape: GearShape` を持つ（S2-01）。
  - **パレットの種類での絞り込み**（S4-02）: `spec.kind: PaletteKind`（パレットで選んだ種類。S2-01〜S3-04 の `spec.coaxialKind` を置き換えた）の歯車ができる候補だけを出す。`PaletteKind = GearKind | 'rack' | 'planetary'`、並びは `PALETTE_KIND_LIST`（`GEAR_KIND_LIST` → `'rack'` → `'planetary'`）。ラック・遊星は歯車の種類ではない（ラックは別の部品、遊星は機構の組）ので `GearKind` には足さず、パレット専用の型にした。候補ができる種類は `candidateKind(candidate)`（`planetary` → `'planetary'`、`rack` → `'rack'`、それ以外は `shape.kind`。`rackPinion` は `'spur'`）。外周は `meshPartnerShape(親).kind === spec.kind` のとき、囲む候補は `'internal'`、遊星歯車機構は `'planetary'`、ラックは `'rack'`、かさ歯車は `'bevel'`、ねじれた位置は `skewPartnerShape(親).kind === spec.kind` のときだけ列挙する。例: 平歯車の親 × 平歯車 → 外周 8、× ラック → ラック 4、× 遊星 → 遊星歯車機構 1、× ウォーム（かみ合えない種類）→ なし（S4-03 から。S4-02 では同じ軸 2 だけが出た。かみ合えない種類はシャフトの上に置く）。親とかみ合う向きに生やせる種類は `meshableKinds(scene, partId)`（平歯車: 平歯車・内歯車・ラック・遊星、内歯車: 平歯車、ハスバ歯車: ハスバ歯車、かさ歯車: かさ歯車、ウォーム: ホイール、ホイール: ウォーム、ねじ歯車: ねじ歯車、ラック: 平歯車、遊星のシャフトの歯車: なし。`PALETTE_KIND_LIST` の順）で、パレットの注記に使う（§7）。app の `candidatesFor(scene, selection, paletteKind)`（S4-03 で `paletteSize` を除いた）は、ラックを選んでいるときはパレットが `'spur'` のときだけ 2 つ目のピニオンの候補を出す。
  - **かさ歯車**（`kind: 'bevel'`。S2-02）: 親がかさ歯車なら、外周の代わりに `axisStep` 1 → 2、それぞれ `side` −1 → 1 の 4 か所に、親と同じ大きさ・同じ歯数（`spec.perimeterTeeth` は使わない）・`apex: −side` のかさ歯車を新しい `bevel` のシャフト（子の `offset` 0）に載せる。並びは外周 → かさ歯車 → 同じ軸。`growGear { mode: 'bevel', parentGearId, axisStep, side }` に変換できる。
  - **ねじれた位置**（`kind: 'skew'`。S2-03）: 親がウォームかホイールかねじ歯車（S2-04）なら、外周の代わりに `axisStep` 1 → 2、それぞれ `side` −1 → 1 の 4 か所に、相手（`skewPartnerShape`。ウォームにはホイール（`spec.perimeterTeeth` 歯）、ホイールにはウォーム（1 条）、ねじ歯車にはねじ歯車（`spec.perimeterTeeth` 歯））を同じ大きさで新しい `skew` のシャフト（子の `offset` 0）に載せる。並びは外周 → かさ歯車 → ねじれた位置 → 同じ軸。`growGear { mode: 'skew', parentGearId, axisStep, side, teeth }` に変換できる。
  - **内歯車**（S3-02）: 内歯車の親の外周の候補は、内側の外周（角度の取り方は同じ、中心距離 `R − r`）の平歯車で、歯数は `min(spec.perimeterTeeth, 親の歯数 − 12)`（大きさの最小 12 を下回れば出さない。中・30 歯 → 18、中・24 歯 → 12、小・24 歯（既定 30）→ 12）。**囲む候補**（`kind: 'enclose'`）: パレットで内歯車を選んでいるとき（`spec.kind === 'internal'`。S4-02 までは `spec.coaxialKind`）、平歯車の親に、親を囲む内歯車（`webSide` −1）を 1 つ出す。歯数は `2 × 親の歯数` を `max(24, 親 + 12)` 以上・大きさの最大以下に収めたもの（収まらなければ出さない）。向きは `k·π/4` を順に試し、干渉の増えない最初の 1 つ。並びは外周 → 囲む → かさ歯車 → ねじれた位置 → 同じ軸。`growGear { mode: 'enclose', parentGearId, angle, teeth }` に変換できる。パレットの選択で出し分けるのは、いつも出すと親を覆う大きなリングの候補が、親をつかんで回す操作や外周の候補のクリックを奪うため（ピッキングは候補を歯車より優先する）。
  - **遊星歯車機構**（`kind: 'planetary'`。S3-03）: 平歯車の親（遊星のシャフト上でないもの）に 1 つ（S4-02 からパレットが `'planetary'` のときだけ）。歯数は `defaultPlanetTeeth(親, DEFAULT_PLANET_COUNT)`（無ければ出さない）。機構を足した仮のシーン（仮の ID）全体を `resolveLayout` し、元のシーンに無かった干渉の組があれば出さない。並びは外周 → 囲む → 遊星歯車機構 → かさ歯車 → ねじれた位置 → 同じ軸。`center`・`axis`・`basePhase` はリング、`planets` は遊星の中心と位相、`teeth` はリング・`planetTeeth` は遊星の歯数。`growGear { mode: 'planetary', parentGearId }` に変換できる。仮の表示（`render/candidates.ts`）はリングを歯を省いた輪と、ウェブの側へ伸びるつなぎの筒で描き（ウェブの円板は描かない。太陽の下に入って太陽のクリックを奪うため）、遊星を仮の歯車として添える。輪は外周の候補と同じ面で重なるので、輪と遊星は描くだけで選べなくし、押す所は輪と筒の外側の壁（外向きの面だけの見えない円筒）にする。
  - **ラック**（`kind: 'rack'`。S3-04）: 平歯車の親（遊星のシャフト上でないもの）に（S4-02 からパレットが `'rack'` のときだけ）、`axisStep` 1 → 2、それぞれ `normalSign` −1 → 1 の 4 か所。ラックは同じ大きさ・`RACK_DEFAULT_TEETH` 歯で中央でピニオンにかみ合う。仮のシーン全体を `resolveLayout` し、新しい干渉の組があれば出さない。並びは外周 → 囲む → 遊星歯車機構 → ラック → かさ歯車 → ねじれた位置 → 同じ軸（S4-02 の前は、平歯車の親に 8 + 1 + 4 + 同じ軸が一度に出ていた）。`center` は基準位置、`axis` は direction。`growRack { gearId, axisStep, normalSign, teeth }` に変換できる。仮の表示はラックの形を止めたまま描く（ピニオンに合わせて動かすと遠くへ行くため）。
  - **ラックを選んだとき**（`listRackCandidates(scene, rackId, { perimeterTeeth })`。`kind: 'rackPinion'`。S3-04）: すでにかみ合っているピニオンの位置から負の側・正の側へ、新しい干渉の無い最初の `position`（π·m の整数倍）を 1 つずつ（rack-basic では ±16π = 8 ピッチ）。どのピニオンとも範囲が残る（位置の差が L − 2·余白 以下）ところまで探す。ピニオンは同じ大きさ・`DEFAULT_TEETH` 歯の平歯車。`growGear { mode: 'rack', rackId, position, teeth }` に変換できる。仮の歯車はラックの変位 s に合わせて回す。
  - **遊星のシャフトの歯車**（S3-03）からは候補を出さない（外周・囲む・遊星歯車機構・かさ歯車・ねじれた位置は出さない。段付きの遊星は、S4-03 から遊星のシャフトの上に置く）。
  - **外周**（`kind: 'perimeter'`。かさ歯車・ウォーム・ホイール・ねじ歯車の親には出さない）: 親と同じ大きさ・`spec.perimeterTeeth` 歯・親とかみ合う形（`meshPartnerShape`。ハスバ歯車なら逆の `hand`）の歯車を、新しい `mesh` のシャフト（子の `offset` 0）に載せる。角度は連続だが、親の軸まわりの `PERIMETER_CANDIDATE_COUNT`（8）方向 `k·π/4` で代表させる（細かい角度は S1-19 の円弧ハンドル）。`center`・`axis`・`basePhase` は仮のシーンのレイアウト（`resolveAddition`）から得る。
  - **同じ軸**（`kind: 'coaxial'`。S1-10〜S4-02）: 選んだ歯車のシャフトの歯車の並びの両端の外側の 2 か所。S4-03 で廃止した。
  - 絞り込み: 候補を足した仮のシーン（仮の ID `__candidate_gear`・`__candidate_shaft`）で、元のシーンに無かった干渉の組が 1 つでもあれば出さない。仮のシーン全体を `resolveLayout` し直す代わりに、`resolve.ts` の `resolveAddition(scene, layout, shaft, gear)` で、足した歯車のレイアウトと、変わった部品（足した歯車・足したシャフト・既にあるシャフトに通すなら伸びたシャフト）を含む干渉の組だけを求める（それ以外の部品の位置・形・かみ合いは変わらないので、結果は `resolveLayout` の該当部分と一致する。S2-01。歯車 200 枚の木で、候補ごとに全体を解き直すと余裕が無かったため）（既存の干渉は候補を減らさない。contact は干渉ではないので、偶然ちょうどの距離でかみ合う候補は位相によらず出る）。歯数が大きさの範囲外・整数でない、シーンに無い歯車は例外。根からたどれない歯車は空。キャリアのあるシーン（S3-03）では、`resolveAddition` は全体を解き直して、変わった部品を含む組を取り出す（公転・機構の扱いを `resolveLayout` と一致させるため。機構は小さい）。
  - 戻り値は S1-11 の `growGear` の引数にそのまま変換できる（`perimeter` → `parentGearId`・`angle`・`teeth`）。歯車 200 枚で 1 回約 40ms。`resolveAddition` の既にあるシャフトに通す形（`shaft` が `null`）は、範囲を持つシャフトなら足した歯車がはみ出す分だけ伸ばす（`fitShaftSpans` と同じ。S4-03）。
- **シャフトの上に置く**（S4-03。`src/app/grow.ts` の `shaftGhostAt(scene, shaftId, along, paletteSize, paletteKind)`）: シャフトの原点から軸方向に `along` の位置に、パレットの種類・大きさの歯車を置く仮の歯車（`ShaftGhost`）。`along` をシャフトの範囲に収め、歯車の中心が `along` に来るように `offset` を `AXIAL_SNAP` の倍数に丸める（`shaftGhostOffset`）。歯数は `DEFAULT_TEETH[大きさ]` を `teethRange` に収めたもの（ウォームは 1 条、内歯車は 24 以上）。コマンドは `growGear { mode: 'coaxial', shaftId, offset, size, teeth, kind }`。コマンドが `notAllowed`（重なる）なら `blocked`（赤）。パレットがラック・遊星なら `null`（シャフトの上には出さない。パレットに注記）。
- **伸縮**（S4-03。`commands.ts` の `stretchShaftSpan(scene, shaftId, end, target)`）: シャフトの端 `end`（0: 始まり、1: 終わり）を `target` へ動かすときの範囲。`target` を 4 の倍数に丸め、部品の範囲より内側には行かず（その外側の 4 の倍数で止める。反対の端から `AXIAL_SNAP` 以上）、伸ばす向きではほかの部品にぶつかる手前の 4 の倍数で止める（線分は長いほど相手を含むので、ぶつかる長さは単調。二分探索）。最大の長さは決めない。
- **歯車の中心**: `core/scene` の `gearCenter(シャフトの原点, 軸, gear)` = `シャフトの原点 + (offset + 歯幅/2) × 軸`（§4）。
- **歯形の 2D 輪郭の向き**（S1-02 の `spurOutline`）: 歯車の中心が原点、**0 番目の歯の中心線が +x 軸に乗る**（輪郭は x 軸について対称）。点は **反時計回り**（符号付き面積が正）に並べ、最後の点で最初の点を繰り返さない。位相 0 は「0 番目の歯がローカルの +x を向いた状態」で、basePhase（S1-03）とシャフトの角度はここからの回転角。
- **歯車の形状データ**（S1-02 の `buildSpurGeometry`）: 2D 輪郭のローカルの x・y はそのまま、歯幅の方向をローカルの z（−歯幅/2 〜 +歯幅/2、中心が原点）とする。シャフトを通す穴は開けない（シャフトの円柱が歯車を貫いて描かれる）。
- **かさ歯車の形**（S2-02。描画は `render/gear-geometry.ts` の `buildBevelGeometry`）: ローカルの原点は区画の中心、大端は z = −歯幅/2、頂点は +z。大端の断面は歯数 z の平歯車の 2D 輪郭（簡略化。相当平歯車の歯数は使わない）で、頂点に向かって相似に `1 − b/(R√2)` 倍まで縮めながら、軸方向に `b·cos45°` 押し出す（ピッチ円すいに沿う）。両端（大端の背面と頂点側の面）は平らな面で閉じる。形状データのキーは `(種類, 大きさ, 歯数)` で `apex` を含めず、`apex` −1 の歯車は本体の `scale.z = −1`（`gearBodyScaleZ`。z について鏡映しても z まわりの回転は変わらないので位相はそのまま）で表す。候補の仮の歯車も同じ。
- **ウォームの形**（S2-03。描画は `render/gear-geometry.ts` の `buildWormGeometry`。形状データのキーは `(種類, 大きさ)`）: ローカルの原点はねじ山の中央（区画の中央）、軸はローカルの z。軸まわりの角度 θ・軸方向の位置 z の点の半径を `wormThreadRadius(z − π·m·θ/2π)`（軸方向断面が圧力角 20° の台形＝ラックの歯形のねじ山を、右ねじのらせんに沿って掃いた形）とした側面を、θ 64 分割 × 軸方向ピッチ 1 つあたり 48 分割で張る。両端は 45° で歯底円まで面取りし（半径を `歯底 + 端までの距離` 以下にする）、歯底円の円板で閉じる。
- **内歯車の形**（S3-02。描画は `render/gear-geometry.ts` の `buildInternalGeometry`）: ローカルの原点はリングの中心、軸はローカルの z、ウェブは −z の側。リングは外側がリムの円 `R + 3.25m`、内側が内歯の輪郭（`internalOutline`。外歯車と同じインボリュートで歯と歯溝を入れ替えたもの: 半径 ρ での歯溝の幅の半分の角度は外歯車の歯厚の半分 `toothHalfAngleAt(m, z, ρ)` と同じ。歯先 `R − m` から歯底 `R + 1.25m`。**位相 0 で 0 番目の歯（内向き）の中心線が +x**）。これに、つなぎの筒（`R + 2.25m` 〜 `R + 3.25m`、長さ `INTERNAL_WEB_GAP`）、ウェブ（厚さ m の円板）、ボス（半径 `3 + m`、ウェブと合わせて `INTERNAL_WEB_THICKNESS`）を足す。形状データのキーは `(種類, 大きさ, 歯数)` で、`webSide` 1 は本体の `scale.z = −1`（`gearBodyScaleZ`）で表す。
  - 位相（`internalMeshPhase`）: 接点で外歯車の歯の中心と内歯車の歯溝の中心が重なるようにする。接点の向き β は、内歯車が親なら子のある向き `angle`、外歯車が親なら `angle + π`（両方の中心から見て同じ向き）。同じ向きに回るので、歯の位置の端数は `f_子 = f_親 + 1/2`、`φ_子 = β − (2π/z_子)·f_子` を `[0, 2π/z_子)` に正規化する。
- **ねじ歯車の形**（S2-04）: ねじれ角 `CROSSED_HELIX_ANGLE`（45°）の右ねじれのハスバ歯車（`buildHelicalGeometry(size, teeth, 'right', CROSSED_HELIX_ANGLE)`）。歯幅 b でのねじれの角度は `b·tan45° / r = b / r`（中・20 歯で 0.4 rad）。形状データのキーは `(種類, 大きさ, 歯数)`。右ねじれ 45° 同士は、ねじれた位置の 90° の接点で歯すじの向きが一致する（例: 軸 x の A の上側の接点と、軸 z の B の下側の接点で、どちらも `(1, 0, 1)` の向き）。
- **ホイールの形**（S2-03）: 進み角 γ と同じねじれ角の右ねじれのハスバ歯車（`buildHelicalGeometry(size, teeth, 'right', WORM_LEAD_ANGLE)`。`helicalTwistAt` などはねじれ角を省くと `HELIX_ANGLE`）。のど（ウォームを抱く凹み）は省く。形状データのキーは `(種類, 大きさ, 歯数)`。
- **ハスバ歯車の形**（S2-01。`src/core/geometry/helical.ts`、描画は `render/gear-geometry.ts` の `buildHelicalGeometry`）: 軸直角断面は平歯車と同じ 2D 輪郭で、ローカルの z の断面を `helicalTwistAt = ±z·tan(HELIX_ANGLE) / r`（r はピッチ円半径、`'right'` が +）だけ回す。歯幅全体のねじれは `Δφ = b·tan β / r`。**歯幅の中央（z = 0）の断面が平歯車の歯形と一致する**ので、`basePhase`・`meshPhase` は平歯車と同じで、位相は中央の断面で合う（逆向きのねじれ同士なので歯幅全体でかみ合う）。中心距離・ピッチ円半径・干渉の円柱も平歯車と同じ。歯幅の方向の分割数は断面の間の回転が `HELICAL_SLICE_ANGLE`（0.02 rad）以下になるように決める（`helicalSliceCount`）。

## 6. 運動の状態と計算

運動の状態はシーンとは別に持つ。Undo の対象にもならず、保存もしない。`MotionState`・`LockInfo`・`LockReason`・`HandConstraint` の型は `src/core/kinematics/types.ts`（S1-04、S1-07）。`stepMotion`・`solveMotion`・`initialMotionState` と `MotionOptions` は `src/core/kinematics/motion.ts`（S1-07）。

```ts
interface MotionState {
  angles: Record<ShaftId, number>; // シャフトの回転角（rad）
  omegas: Record<ShaftId, number>; // 角速度（rad/s）。後から慣性を足せるように状態として持つ
  locks: LockInfo[];               // ロックしている部品の組と理由
  backDriven: MotorId[];           // 負けて逆に回されているモーター
  rackPositions: Record<RackId, number>;  // ラックの変位 s（mm。S3-04）
  rackVelocities: Record<RackId, number>; // ラックの速度 v（direction の正の向き、mm/s。S3-04）
}

// 'wormBackDrive' は S2-03、'anchor' は S3-01、'rackEnd' は S3-04（ラックが端に達した）
type LockReason = 'contradiction' | 'stalemate' | 'wormBackDrive' | 'anchor' | 'rackEnd';

interface LockInfo {
  reason: LockReason;
  shaftIds: ShaftId[];
  gearIds: GearId[];
  rackIds?: RackId[]; // ロックした成分のラック（S3-04。ラックの無い成分では省く）
}

// 手で回しているシャフトと、その目標角度（S1-07 で作る）。ラック（S3-04）をつかんだときは shaftId にラックの ID、
// angle に目標の変位 s（mm）
interface HandConstraint {
  shaftId: ShaftId | RackId;
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

- **剛体の単位はシャフト**。同じシャフトに載った歯車とモーターは一緒に回る。未知数はシャフトごとの ω と、ラックごとの速度 v（S3-04。direction の正の向き、mm/s）。
- **かみ合いの拘束**: かみ合い 1 組につき `c_a·ω_a + c_b·ω_b = 0`（ω は各シャフトの軸の正の向きまわり）。係数は種類ごとに `meshCoefficients(mesh, scene)`（`src/core/kinematics/mesh-coefficients.ts`。S2-02）の 1 か所で決める。拘束行列 C の零空間の基底 N を求め、`ω = N q`（q は機構の自由度）と書く。

  | かみ合いの種類 | `c_a` | `c_b` | タスク |
  |---|---|---|---|
  | 外歯車同士（`'spur'`・`'helical'`） | `z_a` | `z_b` | S1、S2-01 |
  | ねじれた位置の組（`'worm'`・`'crossedHelical'`） | `s·z_a` | `z_b` | S2-03、S2-04（`s = (e_a × u_ab)·e_b`。e は各シャフトの軸の単位ベクトル、`u_ab` は a の中心から b の中心への単位ベクトルで、a と b を入れ替えても s は変わらない。ウォームの z は条数（1）。中心は `resolveLayout(scene)` から取る。右ねじのウォームと右ねじれのホイールのねじ山の向きから導いた。例: ウォームの軸 x、ホイールの軸 z で中心が −y 側 → s = −1 → `ω_H = ω_W / z`。ねじ歯車（S2-04）も同じ係数の関数で、右ねじれ 45° 同士の、接点での歯すじの法線方向の周速の一致から導いた式が同じ形になる。例: A（軸 x、20 歯）、B（軸 z、40 歯）で B が +y 側 → s = 1 → `ω_B = −ω_A / 2`。ねじ歯車の組は一方通行にしない（セルフロックしない）） |
  | 内歯車と外歯車（`'internal'`） | `±z_a` | `±z_b` | S3-02（外歯車は `+z`、内歯車は `−z`。`z_ext·ω_ext − z_int·ω_int = 0` で、内側でかみ合うので同じ向きに回る） |
  | かさ歯車（`'bevel'`） | `apex_a·z_a` | `apex_b·z_b` | S2-02（ピッチ点 P での周速の一致 `ω_a·(e_a × (P − c_a)) = ω_b·(e_b × (P − c_b))` から導いた。親の向き・子の軸・side の 24 通りで成り立つことを Vitest で確かめている） |

- **ウィリスの式**（S3-03）: 遊星のシャフトの歯車がかかわるかみ合い（`mesh.carrierShaftId` がある）は、両方の ω からキャリアの ω_c を引いた相対値で拘束を書く: `c_a·(ω_a − ω_c) + c_b·(ω_b − ω_c) = 0`（係数は上の表のまま。行の項は `meshTerms(mesh, scene)` が `[シャフト a, c_a]`・`[シャフト b, c_b]`・`[キャリアのシャフト, −(c_a + c_b)]` で返し、`buildMeshGraph` と `worm-solve.ts` が同じシャフトの項を足し合わせて行にする。連結成分も 3 本をつなぐ）。太陽 s・遊星 p・リング r では `z_s·(ω_s − ω_c) + z_p·(ω_p − ω_c) = 0`、`z_p·(ω_p − ω_c) − z_r·(ω_r − ω_c) = 0`。ω_p は遊星のシャフトの、ワールドに対する自転の角速度。拘束は ω について一次のままなので、零空間・つり合い・角度の積分はそのまま使う（角度も `θ = N q` で拘束を満たすので、公転しても歯の位相がずれない）。自由度 2 の機構（太陽・キャリア・リング）は、固定具で 1 つ止めると 1 になる。

- **ラックの拘束**（S3-04。`mesh-coefficients.ts` の `rackMeshTerms`・`rackSign`）: ラックとピニオンのかみ合い 1 組につき `v − k·r·ω = 0`、`k = (e × u)·d`（e はピニオンの軸、u はピニオンの中心から接点への単位ベクトル `−normalSign·normal`、d は direction。rack-basic では `(z × −y)·x = 1`）。拘束行列の列はシャフト、続けてラック（`buildMeshGraph(scene, meshes, anchored, rackMeshes)` の第 4 引数に `Layout.rackMeshes`。シーンの全ラックが頂点になり、ピニオンの無いラックは 1 本だけの成分）。`KinematicComponent` に `rackIds`・`rackMeshes`・`anchoredRackIds` を足し、`basis` の行は `shaftIds` の後に `rackIds`（`bodyIdsOf(component)`）。基準に選ぶ順はラックが最後（ラックだけの成分ではラック）。ラックの「角度」は変位 s で、シャフトの角度と同じく `θ = N q` の一部として積分する。ラックにはモーターを付けない（つり合いでは力を出さない剛体。`NO_DRIVE`）。ウォームを含む成分（`worm-solve.ts`）では、ラックの拘束はピニオンのシャフトと同じ区画に入る双方向の拘束。
- **固定具の拘束**（S3-01）: 固定されたシャフトは `ω = 0`（拘束行列 C に、そのシャフトの列だけ 1 の行を 1 つ足す）。`buildMeshGraph(scene, meshes, anchored?)` の第 3 引数（固定するシャフトの集合）で入れ、`KinematicComponent.anchoredShaftIds` に残す。運動は `anchoredMeshGraphOf(scene, layout)`（固定具の拘束を入れたグラフ。固定具が無ければ `meshGraphOf` と同じオブジェクト）で解き、`meshGraphOf`（かみ合いだけ）は `'anchor'` の判定と情報表示の逃げ道に使う。固定具は連結のしかたを変えないので、2 つのグラフの連結成分は同じシャフトの組になる。固定具があっても、駆動されていなければロックではない（止まっているだけ。ω の二乗和の最小で ω = 0 になる）。
  - 情報表示のギア比（S1-23）は、固定具を入れたグラフの `speedRatio` で求め、決まらなければ（固定具で止まった成分など）かみ合いだけのグラフで求める（S3-03 の遊星歯車で、1 つを固定して自由度 1 になったときの比が出るように）。
- **力のつり合い**: モーターのトルクは `τ_i = T_stall · (d_i − ω_i / ω0_i)`（d_i は向き、ω0_i は無負荷角速度）で、ω に対して一次。仮想仕事の原理から `Nᵀ τ(N q) = 0` を解く（q についての一次方程式）。
- **解が一意でないとき**: 駆動されていない自由度があると、方程式の解が 1 つに決まらない。その場合は、解のうち **ω の二乗和が最小のもの** をとる（N の基底の取り方に結果が左右されない）。モーターがつながっていない連結成分は、これで自然に ω = 0（止まったまま）になる。OFF のモーターは無いものとして扱う。
  - S3-03 で、遊星歯車機構（自由度 2、駆動はモーター 1 つ）がこの方式のまま解けることを確かめた。二乗和には遊星のシャフトも 1 本ずつ数える（`planetary-ring-fixed` の固定具を外し太陽 60 rpm だけ → キャリア ≈ 37.190、リング ≈ 25.785、遊星 ≈ −8.430 rpm。基底を入れ替えても同じ）。
- **つり合いの実装**（S1-06。`src/core/kinematics/motor.ts` と `balance.ts`）: シャフトごとに `D_s = Σ T_stall/ω0`、`b_s = Σ T_stall·d`（そのシャフトの ON のモーターの和）とし、シャフトに働くトルクを `b − D ω` とする。成分ごとに `(Nᵀ D N) q = Nᵀ b` を解く（`solveBalance(basis, drives)`）。一意でないときは一般解 `q_p + Z z`（`Z` は `Nᵀ D N` の零空間の基底）について `|N (q_p + Z z)|²` を最小にする `z` を取る。シーン全体は `solveVelocities(scene, graph, { paused? })` で解き、全シャフトの `omegas`、ON のモーターだけの解でのトルク `motorTorques`、成分ごとの `componentQ` を返す。`paused` なら全モーターを OFF とみなす（`motorTorques` は空）。自由度 0 の成分は `ω = 0` で、そこの ON のモーターのトルクは `T_stall·d`。ロックの判定はしない（S1-07）。rpm と rad/s の換算は `rpmToRadPerSec`・`radPerSecToRpm`。
- **基準シャフトと角度の引き継ぎ**: 連結成分ごとに基準シャフトを 1 本決める（root / detached を優先し、次に ID 順）。N は基準シャフトの行が単位行列になるように作り、q は基準シャフトの角度とする。構成が変わったら、新しい基準シャフトの現在の角度から q を引き継ぐ（S1-05、S1-07）。
- **かみ合いのグラフ**（S1-05。`src/core/kinematics/graph.ts` の `buildMeshGraph(scene, meshes)`、線形代数は `linalg.ts`）: 頂点はシャフト、辺は `Mesh`（多重辺あり、`source` は問わない）。連結成分ごとに、`Mesh` 1 つにつき 1 行の拘束行列を作り、零空間の基底 N（行 = シャフト、列 = 自由度 `dof`）を求める。`dof = 0` が回転条件の矛盾。一般の自由度では基準シャフトは `dof` 本（`referenceShaftIds`）で、root / detached を先に、次に ID の昇順（ロケールに依らない文字列の比較）に見て、それまでに選んだ行と独立なものを取る。N はその行が単位行列になる。階数の判定は、行列の成分の最大の絶対値 × 1e-9 をしきい値にする。拘束の行の係数は `meshCoefficients` の 1 か所で決める（S2-02。後続の種類はここに足す）。基準シャフトの優先は root / detached が先（`mesh`・`bevel`・`skew` は後）。速度比は `speedRatio(graph, from, to)`（`ω_to / ω_from`、決まらなければ `null`）。
- **ロック**: 次の場合に、その連結成分をロックとし、ω = 0 にする。
  - 零空間が 0 次元なのにモーターがある（回転条件の矛盾）
  - 解の |ω| が `LOCK_OMEGA_EPS` 未満なのに、トルクを出しているモーターがある
  - ウォームの逆駆動（S2-03。下の「ウォームのセルフロック」）
  - **ラックの端**（S3-04。理由 `'rackEnd'`。`motion.ts` の `rackEndFraction`・`clampRacksIntoTravel`）: 成分ごとに、端の拘束なしで解いた q の動き（qPrev → qNext、速度 q̇）について、どれかのラックの s = n·q が `travel` を越えるなら、最初に端に届く割合だけ進めて端で止め（s を端の値にする）、成分をロックにする（ω = 0、v = 0）。端にいて（`RACK_END_EPS` 以内）外向きに動こうとしている（解いた v か、手の動きが外向き）間もロック。内向きならロックを解いて動く（モーターの向きを変えれば戻る）。ほかの理由のロックが先に決まった成分は見ない。端の判定には `MotionState` のラックの変位を使うので、ロックの判定はシーンだけで決まらない（前の状態の s による）。構成が変わって（ラックの歯数を減らした、など）前の s が範囲の外に出たら、q を n の向きに最も小さく動かして端に寄せる（ピニオンの角度も一緒に戻る）。手でピニオンやラックをつかんで端を越えても同じに止まる
  - **固定具**（S3-01・S3-04）: ラックの固定は `v = 0` の行（`anchoredRackIds`。`anchorAware` はシャフトかラックの固定具がある成分で、外して解き直す）
  - **固定具との矛盾**（S3-01。理由 `'anchor'`）: 固定具の拘束を入れて解いた成分が、上の条件（零空間が 0 次元なのに ON のモーターがある／|ω| < `LOCK_OMEGA_EPS` で ON のモーターがある／ウォームの区画の条件）に当たり、かつ、その成分から固定具の拘束を外して解き直す（`meshGraphOf` の同じ成分を、段階 1 のつり合い、ウォームを含めば `solveWormSections` で）とロックしない場合。外してもロックするなら、外して解き直したときの理由（段階 1 の `contradiction`・`stalemate`、ウォームの `wormBackDrive`）にする（固定具で自由度 0 になっても、本当の原因がウォームの逆駆動なら `wormBackDrive`）。`motion.ts` の `anchorAware`・`freeLockReason`
  - 実装（S1-07）: 成分ごとに判定する。`contradiction` は自由度 0 の成分に ON のモーターがある（一時停止中は無いとみなす）か、手でつかんでいるとき。`stalemate` は成分に ON のモーターがあり、つり合いの解で成分の全シャフトの `|ω| < LOCK_OMEGA_EPS` のとき（ON のモーターは速度 0 で `|τ| = T_stall > 0` を出すので、「トルクを出しているモーターがある」を満たす）。`LockInfo.shaftIds`・`gearIds` はその成分のシャフトと歯車（ID の昇順）。`locks` は成分の順（先頭のシャフトの ID の昇順）。ロックした成分は `ω = 0` で、他の成分には影響しない
- **ウォームのセルフロック**（S2-03。`src/core/kinematics/worm-solve.ts`）: ホイール側から駆動しようとすると、強さに関係なくロックする（要件 §5）。ウォームのかみ合いを **一方通行の拘束** として扱う（ウォーム側はホイール側の影響を受けず、ホイール側はウォームの動きに無限の強さで従う）。ウォームのかみ合いを含む連結成分（自由度 1 以上）は、段階 1 のつり合いの代わりに次のとおり解く（`wormSections`・`solveWormSections`）。
  1. ウォームのかみ合いを除いたかみ合いでつながる部分を「区画」とする
  2. ウォームのかみ合いを「ウォームの区画 → ホイールの区画」の有向辺とし、閉路に含まれる区画（強連結成分）はまとめて 1 つの区画にする（その中のウォームのかみ合いは通常の双方向の拘束）。区画をトポロジカル順（入ってくる辺の無いもののうち、先頭のシャフトの ID が小さい順）に解く
  3. 入ってくる辺のない区画は、段階 1 と同じ力のつり合いで解く（区画の拘束の零空間で `solveBalanceAffine`）
  4. 入ってくる辺のある区画は、上流で決まったウォームの ω から求まるホイールの ω（`c_w·ω_w + c_h·ω_h = 0`）を **規定値** として加え、規定値を満たす解のうち残りの自由度を力のつり合いで決める（ω = ω0 + N' q'。区画内のモーターは従わされ、逆向きなら `backDriven`）
  - ロックの条件（連結成分全体を ω = 0 にする）: 入ってくる辺のない区画で、自由度 0 なのに ON のモーターがある → `contradiction`、ON のモーターがあり解の ω が全て `LOCK_OMEGA_EPS` 未満 → `stalemate`。入ってくる辺のある区画で、規定値がすべて 0（上流のウォームが止まっている）・ON のモーターがある・解の ω が全て `LOCK_OMEGA_EPS` 未満 → `wormBackDrive`。規定値どうし、または区画の中の拘束と規定値が両立しない（止まったウォームが、別のウォームで回るホイールから逆に回される）→ `wormBackDrive`。連結成分全体の自由度が 0 なら、段階 1 の `contradiction` が先に決まる（閉路のウォームのギア比が合わない場合など）
  - 手で、入ってくる辺のある区画のシャフトをつかむと、手と上流のウォームの両方が規定値になるので、手の動きに関係なく常に `wormBackDrive` のロック（角度は変えない）。入ってくる辺のない区画をつかんだときは段階 1 の手の扱い（つかんだシャフトの角度から成分全体を決め、モーターは無視する）
  - 区画ごとに解いた ω も連結成分全体の拘束 `C ω = 0` を満たすので、`q̇` = 基準シャフトの ω として、角度の積分（`θ = N q`）はそのまま使う
  - 区画の構造（`wormSections`）はグラフの参照ごとに覚える
  - 固定具（S3-01）: 固定具の拘束 `ω = 0` は、固定したシャフトを含む区画の拘束の行として足す（`WormSections.anchoredShaftIds`。区画の中の拘束なので、その区画の零空間に入る）。規定値を受ける区画のホイールを固定して上流のウォームが回っていれば、規定値と両立しないので区画の解き方では `wormBackDrive` になるが、固定具を外して解き直すとロックしないので理由は `'anchor'`
- **負けたモーター**（`backDriven`。S1-07）: ON のモーター（一時停止中は無い）のうち、そのシャフトの `ω · direction < −LOCK_OMEGA_EPS` のもの。ID の昇順。ロックした成分のモーターは ω = 0 なので入らない。手で回している成分では、手で求めた ω で同じ式を使う
- **角度の積分**: 毎フレーム q を積分して `θ = N q` で角度を求める。シャフトごとに積分しないので、かみ合った歯車の位相がずれない。
  - 実装（S1-07）: 成分ごとに、前の状態の基準シャフトの角度を `q` とみなし（前の状態に無ければ 0）、`q += q̇·dt`（`q̇` は S1-06 の `componentQ`。ロックした成分は 0）、全シャフトの角度を `θ = N q` で求め直す。かみ合いの構成が変わったときも同じ式なので、基準シャフトの角度は保たれ、他のシャフトはそれに合わせて付き直る。自由度 0 の成分の角度は前の値のまま（無ければ 0）。角度は `2π` で折り返さない
  - かみ合いのグラフは `stepMotion` の中で `buildMeshGraph(scene, layout.meshes)` で作り、`Layout` の参照をキーに、シーンの参照が同じ間は使い回す
- **手で回す**: つかんだシャフトの角度を手の位置で拘束する（無限に強い力）。手を離したら、つり合いの解に戻す。
  - 実装（S1-07 の `opts.hand`）: つかんだシャフトの成分（段階 1 では自由度 1）は、`(N q)_{つかんだ行} = angle` となる `q` に決め、`θ = N q`、`ω = N (q − q_前) / dt`（`q_前` は前の状態の基準シャフトの角度。`dt = 0` なら 0）とする。モーターのつり合いは無視し、`stalemate` のロックは出さない。自由度 0 なら角度を変えず `contradiction` のロックにする（モーターの有無によらない）。**固定具**（S3-01）: つかんだシャフトが固定具で動けない（固定具の拘束を入れた零空間で、そのシャフトの行の成分がすべて `1e-9` 未満）なら、ドラッグ中はロック（角度を変えない）。理由は、固定具を外した成分の自由度が 1 以上なら `'anchor'`、0 なら `contradiction`。動ける自由度が残っていればそちらが動く（自由度 1 なら段階 1 の手の扱い）。一時停止中でも効く。シーンに無いシャフトをつかんでいたら手は無いものとして扱う。自由度 2 以上（S3-03 の遊星歯車など）は、つかんだシャフトの ω（= 角度の差 / dt）を規定値として、残りの自由度をつり合いで解く（ウォームの規定値と同じ `solveFixed`。モーターも効き、二乗和が最小になる）。`dt = 0` では角度の差を一度に動かす（モーターは無いものとし、動きの二乗和が最小。ω は 0）。遊星の歯車・遊星のシャフト・キャリアをつかむと、キャリアのシャフトをつかんだものとする（`grabTarget`。公転を手で回す）
  - 入力（S1-21）: 回している間の手の拘束は `AppState.sim.hand`。`src/app/loop.ts` の `runFrame` は `sim.hand` が null でなければ `stepMotion` の `opts` に `{ hand }` を渡す。目標の角度は `src/input/hand-rotate.ts` の `startHandRotate`（押したときのシャフトの角度 + 手の角度の変化量の積算。手の角度は `src/input/handle-drag.ts` の `pointerAngleAroundAxis` で、円弧のハンドルと共用。面を真横から見ているときは画面上の角度で代用し、求め方が切り替わった間の変化は数えない）。つかむシャフトと中心は `grabTarget`（歯車はその中心、シャフト・モーターは当たった点を軸に下ろした点）。ポインターを動かすたびに `store.setHand` で目標を入れ、離す（`pointerup`・`pointercancel`・Esc）と `null` に戻す。ロック中の成分の扱い: `contradiction`（自由度 0）は回らず、`stalemate` は回している間ロックを外す（どちらも上の `stepMotion` の実装のとおり）
- **手でラックを動かす**（S3-04）: ラックをつかむと、`HandConstraint` の `shaftId` にラックの ID、`angle` に目標の s を入れる。ラックの行の `(N q) = s` で解く（自由度 1 なら段階 1 の手の扱い、2 以上は `solveFixed`）。端より先へは行かず、端で押し続ける間はロック（`'rackEnd'`）。入力は `input/hand-rotate.ts` の `grabTarget`（ラックは `linear: true`、`axis` は direction）と `startHandSlide`（手の位置を、つかんだ点を通る direction の直線に下ろした移動量 `closestParamOnLine`）。
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
  view: { infoOverlay: boolean; watchMode: boolean };    // S1-14（watchMode。済）、S1-23（infoOverlay。済。初期値 false、保存しない。切り替えは store の `setInfoOverlay` の action）
  palette: { size: SizeKey; kind: PaletteKind }; // パレットで選んでいる大きさ（S1-17。S4-03 からシャフトの上に置く歯車の大きさ）と、生やす・置く歯車の種類（S2-05。S4-02 から PaletteKind。初期値 'spur'）。保存しない・Undo の対象にしない
  settings: Settings;            // localStorage に保存する（S1-30）
  currentWork: { id: string; name: string } | null;      // 開いている作品。保存しない（S1-27。済。変えるのは setCurrentWork の action）
}

// src/core/settings.ts（S1-30。済）。app/store.ts は再輸出するだけ
interface Settings {
  quality: Quality;                 // 'high' | 'low'（core/theme.ts）
  inputDevice: InputDeviceSetting;  // 'auto' | 'mouse' | 'trackpad'（core/settings.ts。input/wheel.ts は再輸出）
  trackpadScroll: TrackpadScroll;   // 'pan' | 'orbit'（同上）
  language: Lang;                   // 'ja' | 'en'（core/i18n）
  theme: ThemeId;                   // 'brass' | 'wood'（core/theme.ts）
  muted: boolean;
}
```

- 各欄は、それを使うタスクで足していく（上の型は段階 1 の完成形）。S1-21 で `sim`（`src/app/store.ts` の `SimState`。今は `hand` だけで、初期値は `DEFAULT_SIM`）を足した。`sim.hand` はポインターが動くたびに変わるので、`dispatch` ではなく `store.setHand(hand)`（購読者に知らせない。`setMotion` と同じ）で書き換える。`loadScene` で `null` に戻す。S1-22 で `SimState` に `paused`（初期値 false。保存しない）を足した。Space の押して離す（`src/input/space-tap.ts` の `createSpaceTapDetector`。押している間にカメラのドラッグが始まった・`SPACE_TAP_MAX_MS` = 500ms より長く押した・自動の繰り返しは切り替えない）で `dispatch({ type: 'togglePause' })` する。`togglePause` はシーンと履歴を変えず、運動をすぐ解き直す（ω が次のフレームを待たずに 0 になる・戻る）。`loadScene` と編集コマンドは `paused` を保ち、解き直すときも一時停止中ならモーターを止めて解く。`runFrame` は `stepMotion` に `{ paused: sim.paused, hand }` を渡す（一時停止中でも手で回せる）。一時停止中は `stepMotion` が `locks = []` を返すので、ロックの表示も消える。一時停止中の表示は `src/ui/pause-indicator.ts`（`data-testid="pause-indicator"`、辞書 `sim.paused`）で、描画領域の上部中央に出す。S1-14 で `view.watchMode`・`settings.inputDevice`・`settings.trackpadScroll` を足した（`src/app/store.ts` の `ViewState`・`Settings`。初期値は `DEFAULT_VIEW`・`DEFAULT_SETTINGS`）。ストアのアクションは `updateSettings { patch }`（値が `undefined` の項目は変えない）と `setWatchMode { on }`。どちらも値が変わらなければ購読者に知らせない。`loadScene` と編集コマンドは `view`・`settings` を保つ。S1-24 で `settings.theme`（`ThemeId`、初期値 `'brass'`）と `settings.quality`（`Quality`、初期値 `'high'`）を足した（型と初期値は `src/core/theme.ts` の `DEFAULT_THEME`・`DEFAULT_QUALITY`）。変えるのは同じ `updateSettings` で、ツールバーのテーマボタンは `nextTheme` で次のテーマにする。S1-25 で `settings.muted`（初期値 `false`。localStorage への保存は S1-30）を足した。M キー（`keyboard.ts` に `{ key: 'm' }`）とツールバーの `mute` ボタンが `updateSettings { patch: { muted: !muted } }` で切り替え、ボタンは `aria-pressed` で示す。
- **設定画面と設定の保存**（S1-30）: `Settings` の型・初期値・保存の形は `src/core/settings.ts`（`SETTINGS_STORAGE_KEY`・`SETTINGS_VERSION`・`defaultSettings(navigatorLanguage)`・`parseSettings(raw, defaults)`・`serializeSettings`、選択肢の一覧 `INPUT_DEVICE_SETTINGS`・`TRACKPAD_SCROLLS`・`QUALITIES`・`LANGS`）。`core` は `input` を import できないので、`InputDeviceSetting`・`TrackpadScroll` は core で定義し `input/wheel.ts` が再輸出する。`createStore(scene, { settings })` で初期値を渡す（省略すると `DEFAULT_SETTINGS` = `defaultSettings('')`、言語は英語）。
  - `main.ts` は画面を作る前に `loadSettings(browserStorage(), defaultSettings(navigator.language))`（`src/storage/settings-storage.ts`）で読み、`setLanguage` してから `createStore` に渡す。ストアの購読で、設定の参照が変わったら `saveSettings`（書けなければ `false`）し、初めて失敗したときだけトースト `settings.saveFailed`（error）を出す。
  - 言語: `settings.language` と i18n の言語をいつも一致させる。ストアの購読で `setLanguage(settings.language)`、`onLanguageChange` で `updateSettings { language }`。`__gearSim.setLanguage` も `updateSettings { language }` を通す。
  - 音の材質: `createAudioEngine({ material: THEME_AUDIO_MATERIAL[theme] })` で作り、ストアの購読で `audio.setMaterial(THEME_AUDIO_MATERIAL[settings.theme])`。
  - 設定画面は `src/ui/settings-dialog.ts` の `createSettingsDialog({ getSettings, update, subscribe })`（`open`・`close`・`isOpen`）。ツールバーの `settings` で開く `<dialog>`（`showModal`、`data-testid="settings-dialog"`）。項目は `data-setting="<フィールド名>"` の `role="radiogroup"`、選択肢は `data-value="<値>"` の `role="radio"` のボタン（`aria-checked`）。選ぶとすぐ `updateSettings`。閉じるボタン（`settings-close`）・Esc・ダイアログの外（`::backdrop`）のクリックで閉じ、閉じたら DOM から取り除く。中のキーは `stopAppKeys` でアプリのショートカットに届けない。ストアを購読して、ほかの経路（ツールバーのテーマボタンなど）の変更も選択に映す。言語の選択肢の表示名は辞書を通さず「日本語」「English」（`lang` 属性付き）。ミュートは置かない。
- シーンの変更は、必ず `core/edit` のコマンドを通す（Undo の履歴に積まれる）。コマンドの一覧と引数は S1-11 の資料が正。選択・カメラ・設定はシーンに含めない。
- `offset` が `AXIAL_SNAP` の倍数であることは、シーンの検証（S1-03）とコマンドの引数チェック（S1-11）で強制する。
- **部品の上での左ドラッグ**: 選択中の detached シャフトの本体なら付け直し（S1-19）、それ以外は手で回す（S1-21。`Interactions.pressHand`。`DRAG_THRESHOLD_PX` 以上動いてから回し始め、回している間は候補とハンドルを隠し、カーソルを `grabbing` にする。選択は変えない。マウスを乗せた部品のハイライトは続ける）。選択中の detached シャフトの本体が候補（S1-18）の陰にあるときも、左ボタンは `'app'`（付け直し）にする（S1-19）。
- `reattachShaft` は、子の歯車の `offset` が 0 になるように、そのシャフト上の全歯車の `offset` を同じ量だけずらす（S1-11）。
- **編集コマンド**（S1-11。`src/core/edit/commands.ts` の `applyCommand(scene, command, { ids })`）: 入力のシーンを変えずに新しいシーンを返し、変わらない部分（コレクション・部品）は元の参照を使い回す。何も変わらなければ同じシーンの参照を返す。失敗は例外にせず `{ ok: false, error: { code: 'notFound' | 'invalidValue' | 'notAllowed', message } }`。干渉を理由には失敗しない（赤い警告で出す）が、S4-03 の `growGear`（coaxial）と `setShaftSpan` だけは、新しい干渉を生むものを `notAllowed` にする。成功してシーンが変わったら、シャフトの範囲を部品に合わせる（`fitShaftSpans`。§4）。成功の `created` は新しく作った部品の ID（作った順。例: `addRootShaft` は `[シャフト]`、`gear` を渡せば `[シャフト, 歯車]`）。成功したシーンは必ず `validateScene` を通る。コマンドの一覧:
  - `addRootShaft { axis, origin, gear?: { size, teeth, kind? } }`（S4-04 から `gear` を省くと歯車の無いシャフトだけを作る。アプリ（`rootPlacementCommand`）は省いて送る。`gear` を渡す形はテストとフィクスチャの組み立てに残す）、`growGear { mode: 'perimeter', parentGearId, angle, teeth }`（親と同じ大きさ・`offset 0` の歯車と `mesh` のシャフト。かさ歯車の親は `notAllowed`）、`growGear { mode: 'coaxial', shaftId, offset, size, teeth, kind? }`（シャフト上の位置を指定して歯車を足す。S4-03 から、同じシャフトのほかの歯車やほかの部品と重なる（シャフトが伸びる分も含めて新しい干渉を生む）位置は `notAllowed`。はみ出せばシャフトが伸びる）、`growGear { mode: 'bevel', parentGearId, axisStep, side }`（S2-02。親と同じ大きさ・同じ歯数・`apex: −side`・`offset 0` のかさ歯車と `bevel` のシャフト。親がかさ歯車でなければ `notAllowed`）、`growGear { mode: 'skew', parentGearId, axisStep, side, teeth }`（S2-03。ウォームにはホイール、ホイールにはウォーム（1 条）を、同じ大きさ・`offset 0` で新しい `skew` のシャフトに。親がウォームでもホイールでもなければ `notAllowed`。外周 `perimeter` はウォーム・ホイールの親で `notAllowed`）
  - `deleteParts { ids }`（複数を 1 回の Undo で。下の削除の規則）、`removeMotor { motorId }`（モーターだけを消す別名）
  - `setGearTeeth { gearId, teeth }`（かさ歯車では、`bevel` の木の親子でつながったかさ歯車すべてを同じ歯数にする。1 コマンド＝Undo 1 回。S2-02。ウォームは `notAllowed`。S2-03）、`setMeshAngle { shaftId, angle }`（`mesh` だけ。`[0, 2π)` に正規化）、`setGearOffset { gearId, offset }`（`AXIAL_SNAP` の倍数。`mesh`・`bevel`・`skew` のシャフトの子は `notAllowed`）、`setShaftSpan { shaftId, span }`（S4-03。シャフトの範囲を変える。変えた端が `AXIAL_SNAP` の倍数でない・空・有限でない → `invalidValue`、部品の範囲より短い・新しい干渉を生む → `notAllowed`。1 コマンド＝Undo 1 回）
  - ラック（S3-04）: `growRack { gearId, axisStep, normalSign, teeth }`（平歯車をピニオンにしたラック。同じ大きさ、`pinion` の配置。`created` は `[ラック]`。平歯車でない・遊星のシャフトの歯車は `notAllowed`、`axisStep`・`normalSign`・歯数（`RACK_TEETH`）の範囲外は `invalidValue`）、`growGear { mode: 'rack', rackId, position, teeth }`（2 つ目以降のピニオンと `'rack'` のシャフト。`position` は π·m の整数倍に吸着。`created` は `[シャフト, 歯車]`）、`setRackTeeth { rackId, teeth }`（長さと s の範囲が変わる。今の s が範囲外なら運動の側で端に寄せる）、`addAnchor { rackId }`（ラックを固定。既にあれば何もしない）。`setGearOffset` は `'rack'` のシャフトの子を `notAllowed`。ピニオンの歯数を変えると、ラックの基準位置がついてくる（木構造）
  - `flipBevelApex { gearId }`（S2-02。かさ歯車の `apex` を反転する。区画はそのままで大端と頂点が移り、この歯車を親に持つ `bevel` のシャフトはついてくる。`bevel` のシャフトの子（`apex` は `−side` で決まる）と、かさ歯車でない歯車は `notAllowed`。UI のボタンは S2-05）
  - `addAnchor { shaftId }`（S3-01。シャフトを固定する。`created` は `[固定具の ID]`。既に固定されていれば何もしない（同じシーンを返し、履歴にも積まない）。シーンに無いシャフトは `notFound`）、`removeAnchor { anchorId }`（S3-01。無ければ `notFound`）
  - 遊星歯車（S3-03）: `growGear { mode: 'planetary', parentGearId }`（§4 の作り方。平歯車でない親・遊星のシャフトの歯車・歯数の組が無いものは `notAllowed`）、`setPlanetCount { carrierId, count }`（遊星のシャフトを消して作り直し、1 本目の `angle` から等配にする。1 本目のシャフトの歯車の並びを新しい ID で写す。範囲外は `invalidValue`、配置の条件を満たさない数は `notAllowed`。同じ並びなら何もしない）。`setGearTeeth` は機構の中の歯車（太陽・遊星・リング。`planetaryOfGear`）では、太陽か遊星を変えるとリングを `z_s + 2·z_p` に、同じキャリアの遊星を全部同じ歯数にする（リングを直接変える変更・範囲や配置の条件を満たさない変更は `notAllowed`）。`addMotor`・`addAnchor` は遊星のシャフトで `notAllowed`。`growGear` の `perimeter`・`enclose`・`bevel`・`skew`・`planetary` は、遊星のシャフトの歯車を親にすると `notAllowed`（同じ軸の `coaxial` だけ。S4-03 からシャフトの上に置く）。`moveShaft`・`setShaftAxis` は `root`・`detached` だけ（`concentric` は `notAllowed`）
  - `addMotor { shaftId, size }`（`rpm` は `MOTOR_SIZES[size].defaultRpm`、`direction 1`、`on: true`。1 本に 1 個）、`updateMotor { motorId, patch: { size?, rpm?, direction?, on? } }`（`size` を変えても `rpm` は変えない）
  - `moveShaft { shaftId, origin }`・`setShaftAxis { shaftId, axis }`（`root`・`detached` だけ。その先の `mesh`・`bevel`・`skew` は書き換えない）
  - `reattachShaft { shaftId, childGearId, parentGearId, angle }`（`detached` だけ。大きさが同じで、親がこのシャフトとその先（`descendantShafts`）に無いこと。付け直しは `mesh` だけなので、かさ歯車の組（S2-02）とウォーム・ホイール（S2-03）は `notAllowed`）
  - `replaceScene { scene }`（`validateScene` を通らなければ `invalidValue`）
- **削除の規則**: 歯車を消すと、その歯車を `parentGearId` に持つ `mesh`・`bevel`・`skew` のシャフトと、その歯車を `childGearId` に持つ自分のシャフトは、消す直前（入力のシーンの `resolveLayout`）の原点と向きで `detached` になる（その先はそのまま）。歯車が 1 枚も残らなくなったシャフトはモーター（と固定具。S3-01）ごと消す。シャフトを消すと載っている歯車とモーター・固定具も消える。同じコマンドの中で先に消えた ID は無視し、シーンに無い ID が 1 つでもあれば `notFound`。遊星歯車（S3-03）: `deleteParts` はキャリアの ID も受け付ける。キャリアを消すと、その遊星のシャフトは消す直前の基準配置の位置で `detached` になり、キャリアのシャフトに歯車もほかのキャリアも残らなければシャフトも消す。シャフトを消すと、載っているキャリアも消え（遊星のシャフトは `detached`）、`concentric` の子のシャフトはその場に `detached` で残る。太陽歯車を消すと、それを親とする遊星のシャフトは `detached` になる（`planet` も `isChildPlacement`）。ラック（S3-04）: `deleteParts` はラックの ID も受け付ける。ピニオン（`pinion` の相手）を消すと、ラックは消す直前の基準位置と向きで `detached` になる（`'rack'` のシャフトはラックについたまま）。`'rack'` のシャフトの子を消すと、そのシャフトは `detached`。ラックを消すと、それに載った `'rack'` のシャフトは消す直前の位置で `detached` になり、ラックの固定具も消える。
- **Undo/Redo の履歴**（S1-11。`src/core/edit/history.ts`）: `History { past（古い順）, future（次に Redo するものが先頭）, coalesceKey }`。`execute(state, command, ctx, { coalesceKey? })` は成功し、シーンの参照が変わったときだけ積み（未来は消える。上限 `HISTORY_LIMIT`、古いものから捨てる）、失敗・何も変えないコマンドでは履歴もそのまま。`coalesceKey` を渡すと、直前に積んだときと同じキーなら新しく積まない（ドラッグなど連続した入力を 1 回の Undo にする。UI は操作ごとに別のキーを作る）。Undo・Redo・キーなしの実行でキーは途切れる。
- **ストアのアクション**（S1-11）: `loadScene`（履歴を空にしてシーンを置き換え、運動を初期化）、`command { command, coalesceKey? }`、`undo`、`redo`。シーンが変わったときは角度を引き継いで `solveMotion` で ω などを求め直す。失敗したコマンドや戻せない Undo は状態を変えず、購読者にも知らせない。新しい部品の ID は `createStore(scene, { ids })` の生成関数（既定はランダム）で作る。
- シーンの検証エラー（`SceneError`）は、問題の場所を示す `path` を持つ（S1-03 で作り、S1-28 が表示に使う。S1-28 で形の確認の `code` `'invalidShape'` を足した）。`code` の一覧は `src/core/scene/validate.ts` の `SceneErrorCode`。
- `__gearSim.loadScene` は、Undo の履歴を空にしてシーンを置き換える（テストの準備用。ユーザーの操作で使う `replaceScene` コマンドとは別）。
- 編集コマンドは、干渉を理由に失敗しない（干渉は Layout が赤い警告として出す）。干渉する位置に置かせない・戻すといった判断は、UI 側（候補の列挙、ハンドル）が行う。例外は S4-03 の `growGear`（coaxial。シャフトの上に置く）と `setShaftSpan`（伸縮）で、新しい干渉を生むものは `notAllowed`。
- エラーや通知は、S1-15 で作るトーストで表示する。想定内の失敗（読み込めないファイルなど）は `console.warn` にとどめ、`console.error` は出さない（§10 のテストで失敗になるため）。
- **描画の層**（S1-04）: app は `src/render/scene-view.ts` の `SceneView`（`sync(scene, layout)` / `update(motion, layout)` / `render()` / `projectToScreen(world)`）だけを使う。毎フレームの更新ループは `src/app/loop.ts`（`requestAnimationFrame`、`dt` は 0.1 秒で頭打ち）で、`sync` → 運動を進める（`stepMotion`）→ `update` → `render` の順に呼ぶ。`loadScene` の直後の運動は `solveMotion(scene, layout, initialMotionState())`（`src/app/store.ts` の `initialMotion`）。歯車は中心に置いた `Group` のローカルの x・y・z を `u`・`v`・`w` に合わせ、その子のメッシュをローカルの z まわりに `basePhase + シャフトの角度` だけ回す。
- ストア（S1-04 の `src/app/store.ts`）は、`dispatch` で状態が変わったときに購読者に知らせる（S1-11 から。失敗したコマンドでは知らせない）。毎フレームの運動は `setMotion` で入れ、購読者には知らせない。
- render は、前回と参照が変わった部品だけを作り直す。形状データ（BufferGeometry）は `(種類, 大きさ, 歯数, 形を変える属性)` をキーに共有する（`gearShapeKey(shape, size, teeth)`。ハスバ歯車では `hand`。`GeometryCache.acquire(shape, size, teeth)` の `shape` は `GearShape`（歯車そのものを渡してよい））。
- **ラックの描画**（S3-04。`render/rack.ts`・`render/sync.ts`）: 形は `buildRackGeometry(size, teeth)`（断面の輪郭 `rackOutline` を歯幅だけ押し出す。ローカルの x が direction、y が歯の向き、z が歯幅、原点はピッチ線の中央、歯溝の中心が x = k·π·m。本体からはみ出す歯は描かない。形状データのキーは `(種類, 大きさ, 歯数)` の `rackShapeKey`）。`update` で毎フレーム `rackWorldOrigin + grooveOffset·direction` に置く（`placeRack`）。材質はラックの表（S3-05。`PART_KIND_MATERIALS.rack`。真鍮／明るい木）。ロック中は動く向きに小さく震わせる（`lockShakeAngle × RACK_SHAKE_MM_PER_RAD`（40 mm/rad））。`warningParts` は `LockInfo.rackIds` もロック中に入れる。ピッキングは `'rack'`。**ラックの固定具の見た目**（`rackAnchorFrame`）: ラックの背の中央に、背に接する台座（シャフトの固定具と同じ一辺 12 mm・厚み 3 mm）。背が下か横を向き、台座が床より上なら、台座の下の端から床まで支柱と足を下ろす。背が上を向く（歯が下向き）ラックは、支柱がラックとピニオンを貫くので台座だけ。材質は固定具の表（S3-05。`PART_KIND_MATERIALS.anchor`）で、ラックの選択・ロックに合わせて光る。全体表示の範囲（`boundsOf`）には s = 0 のラックの本体を含める。
- **遊星歯車の描画**（S3-03。`render/sync.ts`・`render/carrier.ts`）: 遊星のシャフトと歯車は、`update` で毎フレーム `shaftWorldOrigin`・`gearWorldCenter` の位置に置き直す。キャリアは腕のある板（中央のボス、遊星のシャフトへの腕、先の円板。`buildCarrierGeometries`）を板の中心に置き、キャリアのシャフトの回転角だけローカルの z まわりに回す（材質はキャリアの表（S3-05。`PART_KIND_MATERIALS.carrier`。鋼／濃い木）。ピッキングは `'carrier'`）。同じ線上のシャフト（`lineRootOf` が同じ）は入れ子の中空軸に見せる: シーンの `shafts` の並び（作った順）で 0, 1, 2, … と順位を付け（`shaftNestRanks`）、半径を `SHAFT_RADIUS + 順位 × SHAFT_NEST_STEP`（1 mm）にする（後から作ったほうが一回り太い）。
- UI は素の TypeScript で書き、DOM を直接操作する。文字列はすべて `t('key')` を通す。
- **カメラと入力**（S1-13）: `src/render/renderer.ts` の `createRenderer` は `SceneView` に加えて `camera`・`canvas`・`pickPoint(pageX, pageY)`（部品に当たればその点、なければ床 y = 0 との交点、どちらも無ければ null）を返す。カメラは `src/input/camera.ts` の `createCameraInput` が camera-controls で動かし、`main.ts` が描く前に毎フレーム `update()` を呼ぶ。マウスのボタンは camera-controls に渡さず、`src/input/pointer-route.ts` の `routePointerDown` で振り分けて自前で `rotate` / `truck` を呼ぶ（ホイールだけ camera-controls の `dollyToCursor`）。カメラのドラッグは、どのボタンも押した位置から `DRAG_THRESHOLD_PX`（4px）動いてから始まる。
  - 「部品の上か」は `CameraInput.setHitTest((pageX, pageY) => PointerTarget)` で差し替える（`'none' | 'app' | 'click-only'`。既定は常に `'none'`。S1-16 がピッキングに差し替え、S1-18 が候補のための `'click-only'` を足した）。左ボタンは `'app'` なら経路 `'app'`、`'click-only'`（候補）ならカメラの回転（クリックは `selection-input` が受ける）。経路が `'app'` のポインターはカメラが無視する（受け取り手は S1-16 以降が canvas に付ける）。
  - 右クリック（ドラッグなし）は `CameraInput.onContextRequest(listener)` で通知する（S1-29 が使う）。ブラウザ標準のメニューは canvas の `contextmenu` で止める。
- **コンテキストメニュー**（S1-29。`src/ui/context-menu/`）: 項目の並び・表示名のキー（`contextMenu.<action>`）・チェックの印は `items.ts` の純粋関数 `buildContextMenuItems(target, state)`、位置は `placeMenu`（カーソルの右下、はみ出すなら左・上に反転、それでも足りなければ画面の端に寄せる）。`controller.ts` の `createContextMenu` が、`onContextRequest` の位置で部品の本体（歯車・モーター・シャフト。ハンドル・候補は除く `bodyAt`）を当て、部品なら `selectionForPick` で選択を置き換えて部品のメニュー、何もなければ選択を変えずに何もない所のメニューを開く。部品の項目は「削除」・「モーターを付ける／外す」・「固定する／固定を外す」（S3-01。`anchor`／`unanchor`。歯車ならそのシャフト。`targetAnchorId`）・「ここに寄る」の順。項目の動作はストアのアクション（`deleteParts`・`addMotor`・`removeMotor`・`addAnchor`・`removeAnchor`・`setWatchMode`・`setInfoOverlay`）と `CameraInput.dollyToPoint`・`fitAll`。メニューから付けるモーターは大きさ中（`CONTEXT_MENU_MOTOR_SIZE`。回転数・向き・ON は `addMotor` の初期値）。表示（`menu.ts`）は `document.body` に `position: fixed` の `role="menu"`（`data-testid="context-menu"`、項目は `data-action`）を置き、項目を選ぶ・Esc・Tab・外での押下とホイール・リサイズ・`blur` で閉じる。メニューの中のキーは `stopAppKeys` で window のショートカットに届けない（Esc で選択が外れない。`main.ts` の Esc も、メニューが開いていれば閉じるだけにする）。
  - キー入力は `src/input/keyboard.ts` の `createKeyboard(window).bind({ key | code, ctrl?, alt?, shift? }, { onDown, onUp })` にまとめる。フォーカスがテキストの入力先（`isTypingTarget`）なら `onDown` を呼ばない。`ctrl`・`alt` は省略すると「押されていない」、`shift` は「どちらでもよい」。文字キーは `event.key`（大文字・小文字を区別しない）、テンキーは `event.code`。Space（押している間は平行移動の修飾キー）・F・Home は `camera.ts` が登録する。
  - F で寄る先の選択は `CameraInputDeps.getSelection`（S1-16 で `AppState.selection` を渡す。それまでは省略して常に全体表示）。全体表示の範囲は `src/core/layout/bounds.ts` の `boundsOf`。
- **選択とピッキング**（S1-16）:
  - ピッキングは `src/render/picking.ts`。render が作る Object3D に `setPickTarget(object, kind, id)` で `userData` の `{ pickKind, pickId }` を付け、当たった物から親をたどって判別する。`Renderer.pick(pageX, pageY): PickHit | null`（`{ kind, id, point, proxyOnly? }`。`proxyOnly` は S4-02）は `Renderer.pickRoot`（`Group`）の下だけを `activeCamera()` で調べ、`src/input/pick-priority.ts` の `choosePick`（ハンドル ＞ 候補 ＞ 歯車 ＞ モーター ＞ シャフト、同じ種類なら手前）で 1 つ選ぶ。ハンドル（S1-17・S1-19）と候補（S1-18）は、自分の Object3D を `pickRoot` に足して `setPickTarget` する。シャフトには見えない太めの当たり判定（半径 `SHAFT_PICK_RADIUS` = 3 mm、`render/sync.ts`）を子に付けている。`pickPoint` も同じピッキングを使う（当たらなければ床）。S3-03 で `'carrier'`（キャリアの板。歯車の次、モーターの前）を足した。キャリアは選べ（選択の ID はキャリアの ID。`selectionForPick`・`pruneSelection`）、プロパティパネル（遊星の数の表示・モーター・固定具。固定とモーターはキャリアのシャフトに付ける）とコンテキストメニュー（`targetShaftId` はキャリアのシャフト）が使う。遊星のシャフト（とその歯車）では、プロパティパネルのモーター・固定具の欄とメニューの「モーター」「固定する」を出さない。S3-04 で `'rack'`（ラック。キャリアの次、モーターの前）を足した。ラックは選べ（選択の ID はラックの ID。`selectionForPick`・`pruneSelection`）、選ぶと 2 つ目のピニオンの候補（`candidatesFor` → `listRackCandidates`）が出る。プロパティパネルは見出し「ラック」（`prop-heading`）・大きさ（`prop-size`）・歯数の表示（`prop-rack-teeth`。編集の UI は S3-05）と固定具の欄（`addAnchor { rackId }`）。モーターの欄は出さない。コンテキストメニューは「削除」「固定する／固定を外す」（`targetAnchorId` がラックなら `anchorOfRack`）「ここに寄る」。`main.ts` の `BODY_KINDS` にも足し、ラックの上の左ドラッグは手でラックを動かす（§6）。
  - `main.ts` の `pickAt` は、描く前（`loadScene` や編集の直後）でも今のシーンで当たるように、`sync` してから `pick` する。`CameraInput.setHitTest` には「`pickAt` が null なら `'none'`、候補なら `'click-only'`、それ以外は `'app'`」を渡す。
  - クリックは `src/input/selection-input.ts` の `createSelectionInput` が canvas で受ける（カメラの経路とは別。左ボタンを `DRAG_THRESHOLD_PX` 未満の移動で離したら `onClick`。何もない所も知らせる）。`main.ts` が `selectionForPick(pickAt(x, y), scene)`（`src/app/selection.ts`。モーターはそのシャフト、ハンドル・候補は null）をストアの `select { id }` に渡す（ハンドルのクリックは選択を変えず、候補のクリックは生やす。S1-17・S1-18）。S1-21 の手で回すは、`'app'` の経路のドラッグ（しきい値以上動いたもの）だけを扱えばよい（動かさずに離したクリックは、このまま選択になる）。
  - ストアのアクション `select { id }`（シーンに無い ID は null として扱う）。シーンが変わるアクション（編集・Undo・Redo・`loadScene`）のあとは `pruneSelection` で、無くなった部品の選択を外す。
  - ハイライトは `Renderer.setHighlight({ selected, hovered })`（`render/sync.ts`）。材質を水色の発光（選択は強く、マウスを乗せた部品は弱く）の複製に差し替える。シャフトのときはモーターも光らせる。マウスを乗せた部品は `main.ts` が描く前に毎フレーム求め直す。
  - ロックと干渉の表示（S1-22）: `runFrame` が毎フレーム `warningParts(scene, layout, motion)`（`src/render/warning-effects.ts`。three に依存しない純粋関数）で求めた部品を `SceneView.setWarnings` に渡し、`SceneView.update(motion, layout, timeSec)` の時刻で光と震えを動かす。材質は `render/sync.ts` の `levelOf` が「仮の部品の見た目 → ロック → 干渉 → 選択 → マウス」の順で選ぶ。ロックは赤の発光の強さを 2Hz で脈打たせ（`lockGlowIntensity`）、軸まわりに振幅 0.01 rad で震わせる（`lockShakeAngle`。描画だけで `MotionState` は変えない。部品の ID から位相をずらす）。干渉は一定の強さの赤の発光。ロック・干渉と選択（マウス）が重なったら、発光は赤のまま色（albedo）を水色に寄せて見分ける。仮の部品の invalid（S1-17）は色そのものを赤くするので、発光だけ赤いロック・干渉と見分けられる。ロック中の成分のシャフトに付いたモーターも locked に入る。干渉中のシャフトのモーターは、シャフトと同じ見た目にする（材質の `levelOf(motorId, shaftId)`）。
  - キー（`keyboard.ts` に登録）: Esc → 選択を外す、Delete・Backspace → `deleteParts { ids: [選択] }`、Ctrl+Z → Undo、Ctrl+Shift+Z → Redo（Ctrl は Mac の Cmd も含む）。
- **カメラ（応用）**（S1-14）: ホイールも camera-controls に渡さず（`mouseButtons.wheel = NONE`）、`camera.ts` が canvas の `wheel`（`passive: false`）で受ける。`src/input/wheel.ts` の `createWheelClassifier` でマウスとトラックパッドを判別し（`AppState.settings.inputDevice` が `'auto'` のときだけ）、`decideWheelAction` で zoom / pan / rotate に分ける。ズームはカーソルの下の点（注視点を通り視線に垂直な平面上）を中心に、注視点と位置を同じ倍率で縮める（マウスのホイールだけなめらかに移る）。Safari のピンチは `gesturestart` / `gesturechange` の `scale` でズームする。
  - 方位角の正規化（S4-01）: ドラッグと眺めるモードの `rotate(..., false)` は方位角を正規化せずに足し込む（回し続けると 3π などになる）。アニメーション付きの `setLookAt`（`setPose(pose, true)`。`zoomAt` のマウスのホイール、`lookFrom` の `fitAll`・`fitTo`・`dollyToPoint`）は移り先の方位角を [−π, π] で作り直すので、`setPose` が `setLookAt` の直後に `normalizeRotations()` を呼び、今の方位角を移り先に近い周へそろえる（前に呼ぶと ±π ちょうどの向きで 1 周回ることがある）。回すたびには正規化しない。`setView` は `rotateTo` の前に正規化する
  - 視点の切り替え（`src/input/views.ts`）は camera-controls の `rotateTo(方位角, 極角)` で行う（方位角は +Z が 0、+X が π/2。上・下は極角 0・π で方位角 0）。テンキーは `keyboard.ts` に `code`（`Numpad1/3/7/5`）で登録する。NumLock が切れているとテンキー 7 の `key` が `'Home'` になるので、Home の全体表示は `code` が `Numpad` で始まるときは無視する。
  - 平行投影: `createRenderer` が `PerspectiveCamera`（`camera`）と `OrthographicCamera`（`orthoCamera`。視錐台の縦の幅 `ORTHO_FRUSTUM_HEIGHT` = 100、near は負の値）を持ち、`setProjection(p)` / `activeCamera()` で描く・写す（`projectToScreen`）・ピッキングに使うカメラを切り替える。camera-controls の `camera` を差し替え、zoom を「見える高さ = 透視投影でその距離から見える高さ」（`orthoHeightForDistance`）に合わせる。平行投影でもカメラと注視点の距離は透視投影と同じ値を保つ（ズームでは距離と zoom を両方変える）ので、戻すときは zoom を 1 にするだけ。
  - 眺めるモード: `CameraInputDeps.isWatching`（`AppState.view.watchMode`）が真の間、`update()` で毎フレーム `watchAzimuthDelta`（`src/input/watch.ts`）だけ方位角を回す。ユーザーのカメラ操作（ドラッグ中・ホイール・gesture・ダブルクリック・F・Home・テンキー・軸の目印）の時刻を覚え、そこから 2 秒は止める。`setCamera`（`__gearSim`）は操作に数えない。
  - 軸の目印（`src/render/axis-gizmo.ts`）: `UiShell.gizmoSlot` に、球をボタン（`data-testid="gizmo-<ViewName>"`、`data-view`）、軸の線を SVG で置く。`main.ts` が毎フレーム描く前に `update(activeCamera)` を呼ぶ。球の位置は純粋関数 `layoutGizmo`（`axis-gizmo-layout.ts`）で求める。

- **起点を置く・ハンドル**（S1-17）:
  - ストア: `AppState.palette.size`（初期値 `'M'`。`DEFAULT_PALETTE`）とアクション `setPaletteSize { size }`。`command` アクションに `selectCreated?: boolean` を足した（成功して部品を作ったら、最後に作った部品を選ぶ。S4-04 から起点では歯車の無いそのシャフトが選ばれ、続けてシャフトをクリックすると S4-03 のシャフトの上の配置で歯車を置ける）。
  - 部品パレットの中身は `src/ui/palette.ts`（`createPalette`）。大きさのボタン `data-testid="palette-size-<S|M|L>"`（`role="radio"`、選んでいるものは `aria-checked="true"`）と、起点のシャフトの項目 `palette-root-shaft`。項目のドラッグは項目に `setPointerCapture` して受ける。
  - 生やす歯車の種類（S2-05）: `AppState.palette.kind`（S4-02 から `PaletteKind`（`GearKind | 'rack' | 'planetary'`。§5）、初期値 `'spur'`）とアクション `setPaletteKind { kind }`（同じ値なら知らせない。シーン・履歴は変えない、`loadScene`・Undo でも保つ）。パレットのボタンは `palette-kind-<種類>`（`role="radio"`・`aria-checked`、並びは `PALETTE_KIND_LIST`（`src/core/layout/candidates.ts`。歯車の種類 → ラック → 遊星）、表示名は `paletteKindLabel(kind)`（`src/ui/palette.ts`。歯車の種類は辞書の `gearKind.<種類>`、ラック・遊星は `paletteKind.<rack|planetary>`））と注記 `palette-kind-hint`。`Interactions.candidates()` が `candidatesFor(..., palette.kind)` で、この種類の歯車ができる候補だけを出す（S4-02。パレットの種類が変わったら列挙し直す）。起点のシャフトは歯車なしで置く（S4-04。`rootPlacementCommand` は `gear` を送らない。高さは今までどおり `rootHeight(size, DEFAULT_TEETH[size])` で、パレットの大きさの歯車をあとで置いても床にめり込まない）。その上の歯車は、シャフトを選んだまま S4-03 のシャフトの上の配置で、パレットの種類・大きさのものを置く。
  - かみ合えない種類の注記（S4-02）: パレットの依存 `getMeshable()` が、選んでいる歯車・ラックとかみ合う向きに生やせる種類（`main.ts` が `meshableKinds` から `{ subject: 'gear' | 'rack', kinds }`。選択が無い・それ以外は `null`）を返す。パレットの種類がその中に無ければ、`palette-kind-note`（`role="status"`）に「この歯車とかみ合えるのは{kinds}です」（`palette.kind.note`。ラックは `palette.kind.note.rack`、種類が無い（遊星のシャフトの歯車）ときは `palette.kind.note.none`。名前は `palette.kind.note.separator` でつなぐ）を出す。ストアの変更ごとと言語の切り替えで書き直す。
  - 編集の操作は `src/app/interactions.ts` の `createInteractions` にまとめる（起点を置くドラッグ、ハンドルのドラッグ、R、Esc）。ドラッグ中の仮のシーンは `displayScene()` で、`startLoop` の `displayScene`（`LoopDeps`。運動はストアのシーンで進め、描くのだけ仮のシーン）と `main.ts` の `pickAt` がこれを描く。置く前の仮の部品の ID は `__ghost_shaft`（S4-04 から起点を置くドラッグの仮の部品はシャフトだけ。`__ghost_gear` はシャフトの上に置く仮の歯車が使う）。描画領域の上かどうかは `document.elementFromPoint` が canvas か（パネル・軸の目印の上は外）。
  - 仮の部品の見た目は `Renderer.setPreviewStyle({ ids, ghost, invalid } | null)`（`render/sync.ts` の `PreviewStyle`）。`ghost` は半透明、`invalid` は赤（色そのものを赤にする。選択の水色より優先）。ハンドルのドラッグで新たな干渉を生む位置では、動く部品（`movedParts`: そのシャフトとその先のシャフト・歯車・モーター）を赤くする。
  - ハンドル: 一覧は `src/input/handle-drag.ts` の `listHandles(scene, layout, selection)`（`HandleSpec { kind, targetId, position, frame? }`）、描画は `src/render/handles.ts`（`Renderer.setHandles(handles, activeId)`。奥行きを無視して最後に重ねて描く）。ピッキングの ID は `handlePickId` = `'<kind>:<targetId>'`。種類ごとの「レイ → 編集コマンド」は `HANDLE_DRAGS`、形は `HANDLE_BUILDERS` に登録する（S1-19 が `'arc'`・`'axial'` を足す）。ドラッグの共通の振る舞いは `startHandleDrag(scene, handle, startRay)` のセッション（`update(ray)` / `state()` = `{ scene, invalid }` / `finish()` = 確定するコマンドか null）。新たな干渉の判定は `src/core/layout/interference-diff.ts` の `newInterferences(before, after)`。
  - 位置のハンドルは原点の真下の床（`[x, 0, z]`）、高さのハンドルは同じ縦の線の上で、シャフトの部品の最も低い所の 6 mm 下（10 mm より下にはしない）。どちらもドラッグ開始時からの移動量を原点に足して `GRID_SNAP` に吸着する（高さは 0 以上）。レイの計算は `src/input/placement.ts`（`intersectRayPlane`・`closestHeightOnVerticalLine`・`snap`・`rootHeight`・`nextAxis`・`rootPlacementCommand`）。`Renderer.rayAt(pageX, pageY)` が `activeCamera()` のレイを返す。
  - `CameraInput.onAppPointerDown(listener)`: 経路が `'app'` の pointerdown を知らせる（Alt・Space の付いた左ボタンはカメラの経路なので来ない）。`main.ts` はハンドルに当たればハンドルのドラッグを始め、そうでなければ `pressBody`（付け直し）、それが `false` なら `pressHand`（手で回す。S1-21）を呼ぶ。ハンドルのクリックでは選択を変えない。
  - キー: R → 起点を置くドラッグ中は仮の部品の向き、それ以外は選んでいる `root`・`detached` のシャフト（またはその上の歯車）の `setShaftAxis`（`mesh` のシャフトでは何もしない）。Esc → ドラッグ中ならやめて元に戻す（選択は外さない）。そうでなければ選択を外す。ドラッグ中に Undo などでシーンが変わったら、ハンドルのドラッグはやめる。
- **シャフトの伸縮とシャフトの上に置く**（S4-03）:
  - 伸縮のつまみ: `listHandles` は、シャフトそのものを選んでいるとき（歯車の選択では出さない。遊星のシャフトは公転して描く位置と合わないので出さない）に `'spanStart'`・`'spanEnd'`（`targetId` はシャフト、`position` はレイアウトの範囲の端のワールド座標、`frame` は `{ center: 端, axis, radius: 0, angle: 0 }`）を足す（並びは move → height → arc → axial → spanStart → spanEnd）。描画は `src/render/handles.ts` の `buildSpan`（軸に沿った短い円柱と、見えない球の当たり判定）。ドラッグは `HANDLE_DRAGS.spanStart/spanEnd`: レイに最も近い軸上の点の、押したときからの移動量を端に足し、`stretchShaftSpan`（§5）で 4 mm 刻み・部品より短くしない・ぶつかる手前で止めた範囲の `setShaftSpan`。離したら 1 つのコマンドで確定する（Undo 1 回）。`handleMovedParts` はそのシャフトだけ。
  - シャフトの上の仮の歯車: `Interactions.setHover(point, hit)` を描く前に毎フレーム呼ぶ（`main.ts` の `render`。ドラッグ中は `null`）。シャフトそのものを選んでいて（歯車の選択では出さない。クリックがシャフトの選択と食い違わないように）、パレットが歯車の種類で、マウスの下がそのシャフト（か仮の歯車）なら、レイに最も近い軸上の点で `shaftGhostAt`（§5）を求める（シーン・シャフト・`offset`・パレットが同じ間は作り直さない）。見た目は生やす候補と同じ `Renderer.setCandidates` に、候補の一覧の最後（番号 = 候補の数）として足す（`blocked` なら赤）。クリック（`selectAt`）は、ハンドルの次に `Interactions.placeOnShaft(point, hit)` を試し、選んでいるシャフトか仮の歯車の上なら置く（`command { growGear coaxial }`。シャフトの選択は保つので続けて置ける）。重なる位置なら置かず、トースト `shaftPlace.blocked`（error）で知らせる。`grow(index)` も仮の歯車の番号なら置く。`Interactions.shaftGhost()` が今の仮の歯車。
  - パレット: ラック・遊星を選んでいる間は `palette-kind-around-note`（`role="status"`）に「ラック／遊星は歯車の周りの候補から置きます」（`palette.kind.note.aroundGear`）。注記 `palette.kind.hint` はシャフトの上に置く説明に、`palette.kind.note.none` は「この歯車の周りには足せません。シャフトを選ぶと、シャフトの上に置けます」に書き換えた。
  - プロパティパネル: シャフトの節に長さ（`prop-shaft-length`。`properties.shaft.length.value`、範囲の終わり − 始まり）と、つまみ・シャフトの上に置く操作の説明（`properties.shaft.length.hint`）。
- **円弧・軸方向のハンドルと付け直し**（S1-19）:
  - `listHandles` の並びは move → height → arc → axial。`'arc'`（`targetId` は `mesh` のシャフト）は `mesh` のシャフトかその上の歯車を選んでいるとき、`'axial'`（`targetId` は歯車）は歯車を選んでいて、それが `mesh` のシャフトの `childGearId` でないとき（`root`・`detached` のシャフトの歯車にも出る）。`HandleSpec.frame`（`{ center, axis, radius, angle }`。`position = center + radialDirection(axis, angle) × radius`）が描画の形を決める。円弧は親の中心・半径 = 中心距離 + 子の歯先円半径 + `ARC_HANDLE_GAP`（8 mm）・今の角度、矢印は歯車の中心・歯先円半径 + `AXIAL_HANDLE_GAP`（6 mm）・その歯車に生やした子の向きから最も離れた外周の 8 方向の 1 つ。
  - ドラッグの計算の純粋関数は `src/input/handle-math.ts`（`angleAroundAxis`・`unwrapDelta`・`snapAngle`・`closestParamOnLine`・`axialOffsetFromDrag`・`meshSnapAngles`・`nearestSnapAngle`・`crossedSnapAngles`、`ARC_MESH_SNAP` = 5°）。かみ合いへの吸着の相手は `src/core/layout/mesh-snap.ts` の `meshSnapTargets`。
  - `HANDLE_DRAGS` の関数は `(ray, input: DragInput) => Command | Command[] | null`。`DragInput` は `{ shift?, screen?: { pointer, project } }`（Shift の 15° 単位と、面を真横から見ているときの画面上の角度に使う）。配列は「通ってきた途中の値 → 今の値」で、セッションは順に評価して最後の干渉の無い値を覚える（円弧は 1 回の移動で吸着の範囲を飛び越えても、通ってきたかみ合いの角度で止まる）。`startHandleDrag(scene, handle, startRay, startInput?)`、`session.update(ray, input?)`。動いて見える部品は `handleMovedParts`（axial はその歯車と、その歯車に生やしたシャフトとその先）。
  - 付け直し: 候補は `src/app/reattach.ts` の `reattachCandidates`（`reattachCommand`・`applyReattach`）。`Interactions.pressBody(e, body)` が選択中の detached シャフトの本体（シャフト・その上の歯車・モーター）の pointerdown で待ち始め、`DRAG_THRESHOLD_PX` 以上動いたら候補を列挙する。子の中心を画面に写した点から `REATTACH_PICK_PX`（24px）以内で最も近い候補を強調し、付け直した仮のシーンを `displayScene()` にして動く部品を半透明（`PreviewStyle.ghost`）にする。離すと `reattachShaft`、候補の無い所・Esc では何もしない。ドラッグ中は候補（S1-18）を隠し、`isDragging()` が真。
  - 描画: `Renderer.setReattachRings(rings, highlighted)`（`src/render/handles.ts` の `createReattachView`。ピッキングしない半透明の輪）。`Renderer.pick(x, y, kinds?)` は `kinds` を渡すとその種類だけを調べる（`main.ts` の `bodyAt` が、候補の陰の部品の本体を調べるのに使う）。`createInteractions` の依存に `setReattachRings` と `projectToScreen` を足した。
- **段階 3 の部品の UI**（S3-05）:
  - プロパティパネル: 内歯車はウェブの向き（`prop-web-side`（`data-web-side`）と反転ボタン `prop-web-flip`。`setWebSide` を −webSide で呼ぶ）。遊星歯車機構の中の歯車は役割 `prop-planetary-role`（太陽・遊星・リング）を出し、太陽・遊星の歯数は条件を満たす値だけの選択肢 `prop-teeth-select`（`<select>`。`planetaryTeethChoices(scene, gearId)`（`core/edit/commands.ts`）が `setGearTeeth` の受け付ける歯数を返す）と注記 `prop-planetary-note`、リングは表示だけ `prop-ring-teeth` と注記 `prop-ring-note`（`prop-teeth` の入力欄を出さない）。キャリアは遊星の数のボタン `prop-planet-count-<1〜6>`（`role="radio"`・`aria-checked`。条件を満たさない数は `disabled`。`allowedPlanetCounts(scene, carrierId)`）と固定する。ラックは歯数の入力 `prop-rack-teeth`（`RACK_TEETH` の 10〜60、`prop-rack-teeth-dec`・`-inc`。`setRackTeeth`）と固定する。遊星のシャフトにはモーター・固定の欄を出さない（S3-03 から）。
  - パレット: 生やす種類に内歯車（S3-02 で済）。注記 `palette.kind.hint` に「平歯車を選ぶと、親を囲む内歯車の候補も出る」を足した（S4-02 で「選んだ種類の歯車ができる候補だけを出す」に書き換えた）。
  - 情報表示: キャリアの rpm とギア比（`computeCarrierInfo`）、ラックの速度（mm/s、`computeRackInfo`・`formatSpeed`、辞書 `info.speed`）と動く向きの矢印（`info-label-arrow`。動く向きを画面に投影した角度に毎フレーム回す。`InfoLabels.setArrowAngle`）。遊星は自転の rpm（遊星のシャフトの ω）。出す部品は `visibleInfoPartIds`（ON なら全部、OFF なら選択中のもの）。ラベルは歯車が `data-gear-id`、どの部品も `data-part-id`・`data-part-kind`（`'gear' | 'carrier' | 'rack'`）。位置はキャリアの板の中心、ラックの今の基準位置。
  - コンテキストメニュー: キャリア・ラックの上の「固定する／固定を外す」「ここに寄る」「削除」は S3-03・S3-04 で済。
- **プロパティパネル**（S1-20。`src/ui/properties.ts` の `createProperties({ setContent, getState, getLayout, dispatch })`。S2-05 で種類ごとの表示を足した: 種類の名前 `prop-kind`（`data-kind`、辞書 `gearKind.<種類>`）、ハスバ歯車のねじれの向き `prop-hand`（表示だけ）、かさ歯車の注記 `prop-bevel-note` と「向きを反転」`prop-bevel-flip`（`flipBevelApex`。`bevel` のシャフトの子では `disabled`）、ウォームの「1 条」`prop-worm-threads`（歯数の欄を出さない）。ホイール・ねじ歯車は歯数を編集できる）: `main.ts` がストアの購読で `refresh()` を呼び、選択かシーン（Undo を含む）の参照が前回と変わったときと、言語が変わったときに中身を作り直して `UiShell.properties.setContent` に渡す（選択が無ければ `null` で案内文）。作り直す前にフォーカスのあった要素は、作り直した後の同じ `data-testid` の要素に戻す。
  - 歯車を選んでいるとき: 見出し（`prop-heading`）・種類（平歯車）・大きさ（`prop-size`）・歯数（`prop-teeth`、`prop-teeth-dec`、`prop-teeth-inc`。範囲は `GEAR_SIZES[size]`）と、そのシャフトのモーターの欄。シャフトを選んでいるとき: 見出し・向き（`prop-shaft-axis`、`getLayout().shafts[id].axis`）とモーターの欄。
  - モーターの欄（`prop-motor`、見出し `prop-motor-heading`）: 無ければ `prop-motor-add-<S|M|L>`（`addMotor`）。あれば大きさ `prop-motor-size-<S|M|L>`（`role="radio"`・`aria-checked`）、rpm のスライダー `prop-motor-rpm-slider`（`input` は表示だけ、`change` で確定）と入力欄 `prop-motor-rpm`、向き `prop-motor-direction`（`data-direction` が `1`／`-1`）、ON/OFF `prop-motor-on`（`aria-pressed`）、外す `prop-motor-remove`。
  - 固定具の欄（S3-01。`prop-anchor`、見出し「固定具」）: 「固定する」のチェック `prop-anchor-check`（`addAnchor`／`removeAnchor`）。歯車を選んでいるときは、そのシャフトを固定する旨の注記 `prop-anchor-note` を出す。歯車・シャフトのどちらでもモーターの欄の後に置く。
  - 数値の入力欄は `type="text"`（`inputmode="numeric"`）。Enter でフォーカスを外し、`blur` で `parseClampedInt`（`src/ui/number-input.ts`。四捨五入・範囲の端に丸め・数でなければ null）で確定する。Esc は元の値に戻してフォーカスを外す。値が変わらない確定ではコマンドを出さない。どの変更も 1 回の確定が 1 回のコマンド（Undo 1 回）で、`coalesceKey` は使っていない（スライダーは離したときにだけ確定するため）。
  - 情報表示のウォームの組（S2-05）: `computeGearInfo` の `GearInfo.wormRatio`（ウォームの組（`Layout.meshes` の kind `'worm'`）に入っている歯車に `{ wheelTeeth, threads }`、それ以外は null）と `formatWormRatio`（`"30:1"`）。ラベル（`src/ui/info-labels.ts`）の 3 行目 `info-label-worm` に「ウォーム比 30:1」（辞書 `info.wormRatio`）を、ウォームとホイールの両方に出す。
  - モーターの見た目（`render/sync.ts`）: シャフトの `span[0]` のさらに外（すき間 1 mm）に、一辺 `MOTOR_BOX[size]`（S 6・M 8・L 11 mm）の箱。質感はテーマで変わる（S1-24。形は箱のまま）。
  - 固定具の見た目（S3-01。配置は `src/render/anchor.ts` の `anchorFrame`、描画は `render/sync.ts`）: 固定したシャフトの負の端（`span[0]`。モーターがあればその箱のさらに外、すき間 1 mm）に、軸に垂直な一辺 12 mm・厚み 3 mm の四角い台座。台座の下の端（縦のシャフトでは厚みの半分、横のシャフトでは一辺の半分だけ下）が床（y = 0）より上なら、台座の下から床まで半径 1.2 mm の支柱と、床に一辺 8 mm・厚み 1 mm の足を置く（見た目だけ。重力はない）。材質は固定具の表（S3-05。`PART_KIND_MATERIALS.anchor`。黒い鉄／濃い木）で、固定したシャフトの選択・ロックの赤の発光が付く。震えない（地面に固定されているため）。当たり判定は付けない（選べない）。
- **テーマと質感**（S1-24。値は `src/core/theme.ts`、見た目は `src/render/themes.ts`）:
  - `core/theme.ts`: `ThemeId`（`'brass' | 'wood'`）・`Quality`（`'high' | 'low'`）・`AudioMaterialId`（`'metal' | 'wood'`）、`THEME_IDS`・`DEFAULT_THEME`・`DEFAULT_QUALITY`・`THEME_AUDIO_MATERIAL`（brass → metal、wood → wood。S1-25・S1-30 が使う）・`QUALITY_PROFILES`（影・影マップの大きさ・解像度の上限・PMREM の大きさ・木目の大きさ・異方性フィルタ）・`nextTheme`。
  - `render/themes.ts` の `THEME_LOOKS`（シャフト・モーターの色・metalness・roughness、床・グリッド・背景の色、環境マップの強さ、照明）と `createThemeController`。歯車の材質は種類ごと（S2-05）: `GEAR_KIND_MATERIALS`（`Record<GearKind, Record<ThemeId, GearMaterialId>>`。種類の追加漏れを型で検出する。平歯車・ハスバ・かさ・ねじ歯車は真鍮／明るい木、ウォームは鋼（銀色）／濃い木、ホイールは青銅（真鍮より赤み）／明るい木）と `GEAR_MATERIAL_LOOKS`（`'brass' | 'steel' | 'bronze' | 'lightWood' | 'darkWood'` の見た目）、`gearLook(theme, kind)`。`SceneSync.setBaseMaterials` の `gear` は `Record<GearKind, MeshStandardMaterial>`（同じ材質の種類は同じ材質を共有し、選択・ロックなどの材質の組も共有する）。 **歯車以外の部品の材質**（S3-05）: `PART_KIND_MATERIALS`（`Record<PartKind, Record<ThemeId, MaterialId>>`、`PartKind = 'carrier' | 'rack' | 'anchor'`（`PART_KINDS`）。種類の追加漏れを型で検出する）と `partLook(theme, kind)`。材質の ID は `MaterialId`（`GearMaterialId` と同じ。S3-05 で黒い鉄 `'blackIron'` を足した）、見た目は `GEAR_MATERIAL_LOOKS`（別名 `MATERIAL_LOOKS`）。

    | 部品 | 真鍮 | 木製 |
    |---|---|---|
    | 内歯車（`GEAR_KIND_MATERIALS.internal`） | 真鍮 | 明るい木 |
    | キャリア | 鋼（銀色） | 濃い木 |
    | ラック | 真鍮 | 明るい木 |
    | 固定具（台座・支柱・足） | 黒い鉄 | 濃い木 |

    シャフト・モーターは `ThemeLook.shaft`・`motor` のまま。`SceneSync.setBaseMaterials` は `{ gear, part, shaft, motor }` を受け取り（`part` は `Record<PartKind, MeshStandardMaterial>`。歯車と同じ材質は同じものを共有し、材質の組も歯車と部品の間で共有する）、キャリア・ラック・固定具はそれぞれの組の材質で選択・ロック・干渉に光る。音の材質（`THEME_AUDIO_MATERIAL`）はテーマで決まるままで、歯車の種類では変えない。`createRenderer(canvas, { theme, quality })` が作り、`Renderer.applyTheme(theme, quality)`（同じ値なら何もしない）で切り替える。`main.ts` はストアの購読で設定が変わるたびに呼ぶ。
  - 床（照明を計算しない色の板、y = −0.2 mm）と影を受ける面（`ShadowMaterial`。部品の範囲 `boundsOf` に合わせて、平行光源の影のカメラと一緒にレイアウトが変わるたびに置き直す。`ThemeController.fitShadows`）・グリッド・背景・環境マップ（`RoomEnvironment` を `PMREMGenerator` で変換し `scene.environment`・`scene.environmentIntensity`）・平行光源の影（`PCFShadowMap`。three r186 で `PCFSoftShadowMap` が無くなったため。`shadow.radius` でぼかす）はテーマのコントローラが持つ。トーンマッピングは ACESFilmic、アンチエイリアスは常に ON。
  - 切り替えでは歯車の形状データは変えず、部品の基の材質を `SceneSync.setBaseMaterials({ gear, part, shaft, motor })`（`gear` は種類ごと。S2-05。`part` はキャリア・ラック・固定具。S3-05）で差し替える。選択・仮の部品・ロック・干渉の材質も基から作り直し、古い材質を `dispose` する。木目（`CanvasTexture`、画像ファイルは使わない）・影マップ・環境マップ・グリッドも差し替えるときに古いものを `dispose` する。軽量では `renderer.shadowMap.enabled` と光源の `castShadow` を両方切り、影マップを捨てる。
  - 歯車・シャフト・モーターは影を落とし、歯車と床は影を受ける。情報表示の矢印・候補・ハンドルの材質はテーマで変えない。
  - 高品質の環境マップは 128（資料の表の 256 から下げた。implementation-log の S1-24）。
  - 描画を軽くする仕組み（S1-24。SwiftShader でも通しテストが動く速さにするため）: `Renderer.render` は見た目が前のフレームと同じなら描かない（`src/render/redraw.ts` の `createRedrawDetector`。描くオブジェクトの並び・見えるか・ワールド行列・材質、カメラ、描画バッファの大きさ、`SceneSync.version()`（部品の回転・震え・材質の選び直しで増える）を比べる。材質の色などを直接書き換えたら `invalidate` する）。影マップは `SceneSync.version()` が変わったときだけ描き直す。最初のフレームは 1 画素を読み戻して描き終わるまで待ち、`isReady` の前にシェーダーの準備を済ませる。新しく描くものを足すタスクは、行列・見えるか・材質の差し替え以外で見た目を変えるなら（材質の値を毎フレーム書き換えるなど）、`SceneSync.version()` を増やすか `invalidate` を呼ぶこと。カメラの `update` の経過時間の上限は 0.25 秒（`src/input/camera.ts` の `CAMERA_MAX_DT`。フレームが遅くても移り変わりが実時間で終わるように）。
- **音**（S1-25。計算は `src/core/audio-model/index.ts`、再生は `src/audio/`）:
  - `core/audio-model`: `meshKey`（2 つの歯車の ID を文字列順に `|` でつなぐ）・`toothPassFrequency`・`clickToneMix`・`toneParams`・`toothPassTimes`（境目 k を「小さいほう < k ≤ 大きいほう」で数えるので、続くフレームで同じ境目を 2 回数えない）・`clickParams`（部分音とノイズのフィルタを同じ割合で ±3%）・`MATERIALS`・`computeMeshVoices(scene, layout, motion)`（`Layout.meshes` の順に全組。`MeshVoice { key, gearId, shaftId, teeth, frequency, click, tone }`。`gearId` はクリックの時刻を求める歯車で key の先頭の歯車、`frequency` はクランプしない歯の通過頻度）・`activeVoices(voices, max = MAX_AUDIO_VOICES)`（f > 0 の組を並びの順に最初の max 組。S1-26 がカメラに近い順の選び方に置き換える）・`shouldScheduleClicks`・定数 `MASTER_GAIN`（0.5）・`MUTE_RAMP_SEC`（0.05）・`CLICK_LATENCY`（0.03）。core は Web Audio に触れない（`import-rules.test.ts` は core に `AudioContext` という語があるだけで失敗するので、コメントにも書かない）。
  - `src/audio/engine.ts` の `createAudioEngine({ muted?, material?, random?, createContext? })`: `start()`（AudioContext を作って `resume`。2 回目以降は止まっていれば `resume` だけ）・`setMuted`（主音量を 50 ms の直線で変える）・`setMaterial(id)`（初期値 `'metal'`。S1-30 がテーマに結び付ける）・`update(frame: AudioFrame)`（毎フレーム。S1-26 で引数を 1 つのオブジェクト `{ voices, angles, dt, listener, motors, locks }` にした）・`state()`（`__gearSim.getAudio` の中身）。AudioContext を作る前も `update` で鳴らす組・背景・モーター・ロックの音の回数は求める。主音量の後にリミッター（`DynamicsCompressorNode`）を挟む。
  - **かみ合いの種類ごとの音色**（S2-05。音の高さ = 歯の通過頻度は変えない）: `MESH_TIMBRES`（`Record<MeshKind, MeshTimbre>`、平歯車を 1 とした倍率 `{ click, hum, slideNoise }`。`'spur'`・`'bevel'` は `{1, 1, 0}`、`'helical'` は `{0.4, 1.5, 0}`、`'crossedHelical'` は `{0.4, 1.5, 0.3}`、`'worm'` は `{0.2, 1.5, 1}`）・`meshTimbre(kind)`・`slideNoiseLevel(kind, pitchLineSpeed)`（周速 mm/s に比例し `SLIDE_NOISE_FULL_SPEED`（200 mm/s）で `slideNoise` に頭打ち。0〜1）・`slideNoiseParams(level, material)`（材質ごとの帯域の中心・Q・音量。`MATERIALS[material].slide`）。`MeshVoice` に `kind`（`Layout.meshes[].kind`）と `slide`（2 枚のピッチ円の周速の大きいほうの `slideNoiseLevel`）を足した。`engine.ts` は連続音の音量に `hum`、クリックの音量に `click` を掛け、`createMeshVoiceSynth` の `setSlide(level)` がすべりの雑音（ループするノイズ → 帯域通過フィルタ）を鳴らす。ウォームの組の歯の通過頻度は `条数 × ウォームの回転数` = `ホイールの歯数 × ホイールの回転数` で、`computeMeshVoices` の式（key の先頭の歯車の `teeth × |ω| / 2π`）のままで同じ値になる。
  - **段階 3 の部品の音**（S3-05。`src/core/audio-model/index.ts`）: 音源の種類 `VoiceKind = MeshKind | 'rack'`（`VOICE_KINDS`。`MESH_KINDS` は `MeshKind` だけ）、`MESH_TIMBRES` は `Record<VoiceKind, MeshTimbre>` で、`MeshTimbre` に `lowpass`（連続音のローパスに掛ける倍率。1 で材質のまま）を足した。内歯車の組 `'internal'` は平歯車と同じ `{1, 1, 0}` で `lowpass` 0.45（うなりをこもらせる。`createMeshVoiceSynth` の `setLowpassScale`）、ラックの組 `'rack'` は平歯車と同じ。
    - 遊星のかみ合い（`Mesh.carrierShaftId` がある組）: 歯の通過頻度はキャリアに対する相対の回転 `planetToothPassFrequency(z, ω, ω_c)` = `z·|ω − ω_c| / 2π`（太陽と遊星・遊星とリングのどちらの組も同じ値）。`MeshVoice.carrierShaftId` を持ち、`engine.ts` はクリックの時刻を相対の角度（シャフトの角度 − キャリアのシャフトの角度）で数える。すべりの周速も相対。位置は公転した今の接点（`meshContactPoint(layout, mesh, motion)`）。
    - ラックの組: `computeMeshVoices` は `Layout.meshes` の組に続けて `Layout.rackMeshes` の順にラックの組を返す（key は `meshKey(ピニオン, ラック)`、`gearId`・`shaftId`・`teeth` はピニオン、`kind: 'rack'`、`slide` 0）。歯の通過頻度は `rackToothPassFrequency(v, m)` = `|v| / (π·m)`（ピニオンの `z·|ω|/2π` と同じ値）。位置はピニオンのピッチ円とピッチ線の接点（ピニオンの中心 − r·normalSign·normal。ラックが動いても動かない）。鳴らす音源の選び方（カメラに近い 16 組）は同じ規則で数える。
    - ラックの端に当たる音: `rackEndHits(prev, next)`（前のフレームの `locks` に無く今のフレームにある `'rackEnd'` のロック。続くフレームでは返さない）。`engine.ts` は端のロックに入った瞬間、ロックの衝撃音の代わりに当たる音（`playRackHit`。`RACK_HIT[material]`: 金属 520 Hz・0.12 秒、木 260 Hz・0.05 秒の減衰の速い 2 つの部分音（2.7 倍）＋ 材質のクリック）を 1 回鳴らし、`lockSounds.rackHits` を数える（`impacts` には数えない）。その後のロック中は段階 1 のガタガタ。
    - 固定具そのものは音を出さない。
  - かみ合い 1 組分の合成は `src/audio/mesh-voice.ts` の `createMeshVoiceSynth`（連続音: `PeriodicWave` の発振器 → ローパス、ざらつき: ループするノイズ → 基本周波数の 2 倍の帯域フィルタ。値は時定数 20 ms で追いかける。クリック: 部分音の正弦波とフィルタを通したノイズを、1 ms の立ち上がりと時定数 = 表の減衰時間の指数の減衰で予約する。消すときは 100 ms でフェードアウト）。ノイズは実行時に 1 秒の白色雑音の `AudioBuffer` を作って共有する。
  - `main.ts`: `window` の `pointerdown`・`keydown`（capture）で `audio.start()` を呼ぶ（描画領域に限らず最初のユーザー操作で始めるため）。`startLoop` の `onFrame(dt)`（S1-25 で経過時間を渡すようにした）で、運動を進めた後のストアの状態から `computeMeshVoices`・`computeMotorHums`・ロックの位置（`lockPosition`）を求め、今描いたカメラ（`cameraInput.activeCamera()` の位置・前方向・上方向）をリスナーにして `audio.update` に渡す。
- **音の空間配置と専用音**（S1-26。計算は `src/core/audio-model/spatial.ts`、`index.ts` から再輸出）:
  - `MeshVoice` に `position`（`meshContactPoint(layout, mesh)`: a の中心から b の中心へ向かう線分上で a のピッチ円半径の点）を足した。`activeVoices` は無くし、`selectVoices(candidates, listener, previous, max)`（f > 0 の候補をリスナーに近い順に max 個。前のフレームで鳴っていた候補は距離を `VOICE_HYSTERESIS`（0.9）倍して比べる。同じ距離なら key の文字列順）に置き換えた。候補の `level` は `backgroundToneLevel(f, material)`（クロスフェードの重みを掛けない連続音の level。クリックの範囲の組も連続音とみなす）。
  - 背景のうなり: `summarizeBackground(rest, listener)`（`g_i = level × distanceGain(距離)`、音量 `min(0.5, √Σg²)`、周波数は g で重み付けした log2(f) の平均を 30〜2000 Hz にクランプ。rest が空なら null）。`src/audio/background.ts` がパンなしで主音量に直接つなぐ（材質の倍音の連続音＋同じ周波数の帯域ノイズ Q 1・0.5 倍）。
  - `PANNER`（`HRTF`・`inverse`・`refDistance` 150・`rolloffFactor` 1・`maxDistance` 10000。長さは mm のまま）と `distanceGain`（同じ式。refDistance 未満は refDistance）。PannerNode とリスナーは `src/audio/panner.ts`（`createPanner`・`applyListener`。位置は時定数 20 ms で追いかける）。かみ合い・モーター・ロックの音源は PannerNode を通して主音量につなぐ。入れ替わる音源は 100 ms（`VOICE_FADE_SEC`）でフェードイン・アウトする。
  - モーター: `motorHumParams(size, rpm, direction, ω)`（`strain = 1 − d·ω/ω0`、周波数 = 小 220・中 140・大 90 Hz × (0.6 + 0.4 × clamp(|ω|/ω0, 0, 1.5))、音量 0.08 + 0.07 × clamp(strain, 0, 1)、`grind = clamp(strain − 1, 0, 1)`）と `computeMotorHums(scene, motion, paused, positionOf)`（ON のモーター、ID の昇順。一時停止中は空。`grind` は `backDriven` に入っているモーターだけ）。位置は `src/render/sync.ts` の `motorCenter(shaftLayout, size)`（モーターの箱の中心）。鳴らすのはリスナーに近い `MAX_MOTOR_VOICES`（4）個（`selectVoices` で選ぶ）。合成は `src/audio/motor-hum.ts`。
  - ロック: `lockKey(lock)`（`` `${reason}:${shaftIds.join(',')}` ``）・`diffLocks(prev, next)`・`lockPosition(layout, lock)`（ロックしている歯車の中心の平均）・`canPlayImpact(history, now)`（直近 1 秒に 4 回まで）。衝撃音とガタガタは `src/audio/lock-sound.ts`。衝撃音の回数の制限は `update` の dt を積算した時計で数える。

- **生やす候補**（S1-18）:
  - 生やす歯車の大きさと歯数は `src/app/grow.ts` の `growSpec(parent)`（親と同じ大きさ、歯数は `DEFAULT_TEETH[大きさ]`。S4-03 で同じ軸を廃止して引数を減らした）。`candidatesFor(scene, selection, paletteKind)` が選択中の歯車の `listGrowCandidates` を返し（S4-02 からパレットの種類で絞る）（選択が無い・シャフトなら `[]`）、`growCommand(candidate)` が `growGear` にそのまま変換する。`candidateSpec(scene, candidate)` は表示用の `CandidateSpec`。
  - 候補の一覧は `Interactions.candidates()`（`src/app/interactions.ts`）。シーン・選択・パレットの大きさが変わったときだけ列挙し直し、同じ間は同じ参照を返す。ドラッグ中（起点を置く・ハンドル）は `[]`（S1-21 は手で回している間もここで `[]` にする）。`grow(index)` は `command { growGear, selectCreated: true }` を投げる（生やした歯車が選ばれ、続けて次の候補が出る）。
  - 表示は `src/render/candidates.ts`（`Renderer.setCandidates(specs, hovered)`）。形状データは本物の歯車と同じ `GeometryCache` を共有し（`createRenderer` が 1 つ作って `createSceneSync` にも渡す）、材質だけ半透明の水色（マウスを乗せた候補は濃く）。外周の候補には仮のシャフトも描く。仮の歯車は親のシャフトの回転に合わせて回す（外周は `basePhase − (親の歯数/子の歯数)·θ_親`、シャフトの上の仮の歯車は `θ`）。`CandidateSpec.blocked`（S4-03）が真なら赤く描く。ピッキングは `setPickTarget(group, 'candidate', String(番号))`（`candidatePickId`）。
  - 候補の上の左ボタンは `'click-only'`（ドラッグはカメラの回転）。`main.ts` の `selectAt` は `kind: 'candidate'` なら `interactions.grow(Number(id))` を呼ぶ。マウスを乗せた候補は描く前に毎フレーム `setHoveredCandidate` で渡す。
  - **ハンドルに重なった候補**（S4-02）: ピッキングはハンドルを候補より優先し、ハンドルには見た目より太い見えない当たり判定（材質 `visible: false`）があるので、ハンドルの近くの候補をクリックしても何も起きなかった（「置けない候補がある」の原因。コマンド側の拒否・`resolveAddition` と `resolveLayout` の食い違いは、showcase などの全歯車 × 全種類の全候補を置いて確かめたが無かった）。`PickHit.proxyOnly`（`render/picking.ts`。選んだ部品のうち見えない当たり判定にだけ当たったとき `true`）を足し、`main.ts` の `clickTargetAt` が「ハンドルの見えない当たり判定にだけ当たり、その陰に候補があれば候補」を返す。クリック（`selectAt`）とマウスを乗せた候補の強調はこれを使う。見えているハンドルの形の上のクリックは、これまでどおり何もしない。押したとき（`onAppPointerDown`）は、ハンドルの陰に候補があれば `beginHandleDrag(e, id, deferred = true)` にし、`DRAG_THRESHOLD_PX` 以上動くまでハンドルを動かさず、候補も隠さない（動かさずに離せば何も確定せず、クリックが候補に届く）。
- **画面の骨組み**（S1-15。`src/ui/shell.ts` の `createUiShell(root)`）: `index.html` の `#root` を CSS グリッドで分け、上にツールバー（44px）、左に部品パレット（200px）、右にプロパティパネル（260px）、中央に描画領域を置く。`main.ts` が canvas を作って `UiShell.canvasHost` に入れる。描画領域の右下に軸の目印の置き場 `UiShell.gizmoSlot`（96×96px。S1-14）。
  - ツールバーのボタンは `UiShell.toolbar.button(id)`（`ToolbarButtonId`）で受け取る。最初は `disabled` なので、各担当タスク（S1-23・S1-24・S1-25・S1-27・S1-28・S1-30）が動作を付けて `disabled = false` にする。`data-testid` は `toolbar-<id>`。文字は `toolbar.<id>`（文字と `aria-label`）・`toolbar.<id>.tooltip`（`title`）。有効にしたタスクは `e2e/ui-shell.spec.ts` の `ENABLED_IDS` にその ID を足す（S1-23 で `info`、S1-24 で `theme`、S1-25 で `mute`、S1-27 で `works`・`save`、S1-28 で `export`・`import` を足した）。ON/OFF のボタンは `aria-pressed` で状態を示し、`shell.css` の `[aria-pressed="true"]` の見た目（S1-23）を共有する。
  - パレットの中身は `UiShell.palette.body` に入れる（S1-17・S1-18）。プロパティパネルの中身は `UiShell.properties.setContent(el)`、`null` で案内文（`properties.empty`）に戻す（S1-20）。
  - 文字列を言語の切り替えに追従させるには `src/ui/dom.ts` の `bindText(el, key, attr?, params?)`（解除関数を返す）を使う。
  - パネル・ツールバー・トーストは canvas の兄弟の要素なので、その上のポインターとホイールは canvas に届かない。カメラなど描画領域の入力は canvas に付け、`window` や `document` には付けない（ドラッグ中の `pointermove` は `setPointerCapture` で受ける）。パネルのホイールはパネルのスクロールになる。
  - canvas の大きさの変化は `createRenderer` の中の `ResizeObserver` で受け、描画バッファとカメラの縦横比を合わせる。`projectToScreen` は呼んだ時点のカメラで写す（`setCamera` の直後でも、次のフレームを待たなくてよい）。
- **トースト**（S1-15。`src/ui/toast.ts` の `showToast(key, kind, params?)`。閉じる関数を返す）: 描画領域の下寄りに重ね、新しいものを下に積む。`kind` は `'info'`（`role="status"`、3 秒）と `'error'`（`role="alert"`、6 秒）。閉じるボタンでも消せる。文字は `t(key, params)` で出し、言語が変わったら書き換える。要素は `data-testid="toast"`・`data-kind`、文字は `toast-message`、閉じるボタンは `toast-close`。シェルが無いとき（単体で import したとき）は `body` の下に出す。

## 8. 国際化

- 辞書は `core/i18n/ja.ts` と `core/i18n/en.ts`。`ja` のキーを正とし、`en` は同じキーを持つことを型で強制する。
- 言語は設定から切り替える。初期値はブラウザの言語（`ja` で始まれば日本語、それ以外は英語）。S1-30 から `AppState.settings.language` に入り、localStorage に保存される（§7 の「設定画面と設定の保存」）。
- 純粋な部分は `core/i18n/index.ts`（`Lang`・`MessageKey`・`MessageParams`・`detectLanguage`・`translate`・`interpolate`・`placeholdersOf`）。差し込みは `{name}` の形で、`params` に無い差し込みはそのまま残す。`ja` と `en` の差し込みの集合は同じにする（Vitest で確かめる）。
- 実行時の言語は `app/i18n.ts` が持つ（`t`・`getLanguage`・`setLanguage`・`onLanguageChange`。DOM には触れない）。画面の文字列はすべて `t()` で出し、言語が変わったら `onLanguageChange` で書き換える。`setLanguage` は言語が変わったときだけ購読者に知らせる。
- `main.ts` が、言語が変わるたびに `document.title = t('app.title')` と `<html lang>` を合わせる。
- 辞書のキーは各 UI タスクが、そのタスクで `ja.ts` と `en.ts` の両方に足す。

## 9. 保存形式

```ts
interface SaveFile {
  format: 'gear-simulator';
  version: number; // 1 から始める。最新は 4（S4-03）
  scene: Scene;
}
```

- JSON のエクスポート、IndexedDB の作品と自動保存は、すべてこの形式を使う。
- 読み込むときは `migrate(file)` で最新のバージョンまで順に変換し、`core/scene` のシーン検証関数（S1-03）で検証する。検証はこの 1 か所にまとめる。不正な形式は例外にせず、エラーの結果を返す。
- **読み込みの流れ（S1-28）**: `parseSaveFile(text)`（インポート）→ `parseSaveFileObject(raw)`（IndexedDB の自動保存・作品もここから入る）の 1 か所で、次の順に確かめる。どの段階の失敗も例外にせず `{ ok: false, error: { code, path? } }` を返す。
  1. 文字列が UTF-8 で **5 MB**（`MAX_SAVE_FILE_BYTES` = 5 × 1024 × 1024 バイト。`core/constants.ts`）を超えたら解析せずに `'too-large'`。インポートではファイルの `size` で先に判定し、読みもしない。
  2. `JSON.parse` に失敗 → `'invalid-json'`（ファイルを読めなかったときも同じ文言）。
  3. 通常のオブジェクトでない・`format !== 'gear-simulator'` → `'not-gear-simulator'`。
  4. `migrate(raw, MIGRATIONS, CURRENT_SAVE_VERSION)`: `version` が 1 以上の整数でない → `'invalid-version'`、最新より新しい・途中の移行が無い → `'unsupported-version'`。`MIGRATIONS[n]` は「n の生データ → n+1 の生データ」（`version` は `migrate` が n+1 に書き換える）。S2-05 で `MIGRATIONS[1]`（1 → 2）、S3-05 で `MIGRATIONS[2]`（2 → 3）を登録した。
  5. `core/scene/parse.ts` の `parseScene(raw: unknown)`: 生の値の形（コレクションが通常のオブジェクト、ID の接頭辞、placement の種類ごとのフィールド、数・文字列・真偽値・`S|M|L`・`x|y|z`）を確かめて `Scene` を作り、続けて `validateScene` を呼ぶ。失敗 → `'invalid-scene'` で、`path` は最初のエラーの場所（`'gears.gear_1.teeth'` の形。コレクションが無いときは `'shafts'` など）。
- 結果の型: `ParseResult = { ok: true; file: SaveFile; migratedFrom: number | null } | { ok: false; error: SaveFileError }`。`migratedFrom` は移行したときの元の version（最新のままなら `null`）。`SaveFileErrorCode` は `'too-large' | 'invalid-json' | 'not-gear-simulator' | 'invalid-version' | 'unsupported-version' | 'invalid-scene'`。
- **知らないフィールドは捨てる**: `parseScene` は型にあるフィールドだけで新しいオブジェクトを作る（ルートの余分なフィールド、部品の余分なフィールド、`mesh` の placement の `axis` も消える）。`file` も `toSaveFile(scene)` で作り直す。検証の規則は core/scene に集め、`save-file.ts` には重ねて書かない。部品の種類やフィールドを足すタスクは、`parseScene`（形）と `validateScene`（意味）の両方に足す。
- 書き出しは `serializeSaveFile(file)`（2 スペースの字下げ、末尾に改行）。ファイル名は `exportFileName(now, workName)`: いま開いている作品があれば `<作品名>.json`（`\ / : * ? " < > |` と制御文字を `_` に、前後の空白と末尾の `.` を取る）、なければ・空になれば `gear-simulator-YYYYMMDD-HHmmss.json`（ローカル時刻）。
- IndexedDB は `gear-simulator` データベースの `works` ストア（作品：id、名前、更新日時、サムネイルの Blob、SaveFile）と `autosave` ストア（キー `'current'` に `{ updatedAt, file: SaveFile }` の 1 件のみ）。
- 作品を開くこととインポートは、`replaceScene` コマンドでシーン全体を差し替える（Undo で前のシーンに戻れる）。
- 設定は localStorage の `gear-simulator:settings` に JSON で保存する。読み書きは try/catch で囲み、失敗したら初期値で動かす。
  - 形（S1-30）: `{ "version": 1, "quality", "inputDevice", "trackpadScroll", "language", "theme", "muted" }`（`serializeSettings`）。
  - 読むとき（`parseSettings`）: オブジェクトでない・`version !== 1` → 全項目を初期値。項目ごとに検証し、不正な値・欠けた項目はその項目だけ初期値、知らない項目は捨てる。形式を変えるタスクは `SETTINGS_VERSION` を上げ、移行をそのタスクで書く。
  - `localStorage` にアクセスできない・`getItem` が投げる・JSON が壊れている → 初期値（`console.warn`）。`setItem` が投げる → 書かずに続け、トースト `settings.saveFailed` を起動中に 1 回だけ（`console.warn`）。どれも `console.error` は出さない。
  - 保存するのは `AppState.settings` だけ（ミュートを含む。情報表示の ON/OFF・眺めるモードは保存しない）。
- **S1-27 で作ったもの**:
  - `src/core/io/save-file.ts`: `SaveFile` の型・`CURRENT_SAVE_VERSION`（1）・`toSaveFile(scene)`・`parseSaveFileObject(raw: unknown)`（読み込みの 1 か所。`{ ok: true, file } | { ok: false, error: { code } }`。今の `code` は `'not-gear-simulator'`（オブジェクトでない・format が違う）・`'invalid-version'`（1 以上の整数でない）・`'unsupported-version'`（最新より新しい）・`'invalid-scene'`（`scene` に `shafts`・`gears`・`motors` のオブジェクトが無い、`validateScene` が通らない・例外を投げた）。S1-28 で移行と形の確認を足し、結果の型を上の `ParseResult` に広げた）。`src/core/io/thumbnail.ts`: `centerSquareCrop`・`nextDefaultWorkName`。
  - `src/storage/db.ts`: `openDb`（開けたら使い回す。失敗は覚えず次に開き直す）・`listWorks`（`updatedAt` の降順、`file` を含めない）・`getWork`・`putWork`・`renameWork`（更新日時は変えない）・`deleteWork`・`loadAutosave`・`saveAutosave`。書き込みはトランザクションの完了で resolve する。
  - 自動保存（`src/storage/autosave.ts` の `createAutosaver(write, delayMs, { timers?, onError? })`）: `main.ts` がストアを購読し、シーンの参照が変わったら `notify`。`pending()` は待っている間と書き込みが終わるまで true。`pagehide` と `visibilitychange`（hidden）で `flush`。
  - 起動（`src/app/restore.ts` の `restoreScene(loadAutosave)`）: `main.ts` は最初の描画の前に（トップレベルの `await`）自動保存を読み、そのシーンで `createStore` する（履歴は空）。自動保存が無ければ空のシーン（S1-04 の `demoScene` は起動に使わなくなり、単体テストの共通のシーンとしてだけ残る）。壊れていれば空のシーンとトースト `storage.restoreFailed`。IndexedDB を開けなければ空のシーンで、自動保存を止め、「保存」「作品一覧」でトースト `storage.unavailable` を出す。
  - 作品（`src/app/works.ts` の `createWorks`）: ストアのアクション `setCurrentWork { work }` で `AppState.currentWork` を変える（シーンと履歴は変えない。`loadScene` と Undo は `currentWork` を変えない）。開くは `replaceScene` のコマンド。作品の ID は `work_<UUID>`。ダイアログは `src/ui/save-dialog.ts`（`save-dialog`・`save-name`・`save-submit`、作品を開いているときは `save-overwrite`・`save-as-new`、`save-cancel`）と `src/ui/works-dialog.ts`（`works-dialog`・`work-card`（`data-work-id`・`data-updated-at`）・`work-thumbnail`・`work-name`・`work-date`・`work-open`・`work-rename` → `work-rename-input`（Enter で確定、Esc でやめる）・`work-delete` → `work-delete-yes`／`work-delete-no`・`works-empty`・`works-close`）。どちらも `<dialog>` の `showModal` で、中のキー入力はアプリのショートカットに届けない（`src/ui/dom.ts` の `stopAppKeys`）。
  - サムネイル: `Renderer.captureThumbnail(size)` が、選択とマウスの強調・候補・ハンドル・付け直しの輪・情報表示の矢印を隠して描き、描画バッファの中央の正方形を縮めた 2D の canvas を返す（描いた直後に写すので `preserveDrawingBuffer` は要らない）。`main.ts` が `toBlob('image/png')` にする。
- **version 2**（S2-05）: `CURRENT_SAVE_VERSION = 2`。段階 2 の歯車（`'helical'`・`'bevel'`・`'worm'`・`'wormWheel'`・`'crossedHelical'`）と配置（`'bevel'`・`'skew'`）を含むシーンを、段階 1 だけのアプリ（version 1 までしか読めない）に読ませると `unsupported-version` になるように上げた。
  - `MIGRATIONS[1]`（1 → 2）は中身を変えない（version 1 のシーンは平歯車と `root`・`mesh`・`detached` だけで、version 2 の形にそのまま含まれる）。S2-01〜S2-04 の間に version 1 として保存された段階 2 の部品を含むシーンも、移行して version 2 の検証を通れば読める（version 1 だからといって段階 2 の種類を拒否しない）。
  - version 2 の検証は `parseScene`（形）と `validateScene`（意味）のまま（S2-01〜S2-04 で足した `invalidHand`・`invalidApex`・`invalidAxisStep`・`invalidSide`・`bevelApexMismatch`・`meshKindMismatch`・ウォームの `teethOutOfRange`）。
  - テストのフィクスチャ: `src/core/io/save-file-v1.json`（version 1 の `SaveFile`。平歯車 3 枚・モーター 1 つ。シーンは `e2e/fixtures/scene-a.json`）と `e2e/fixtures/stage2-showcase.json`（`Scene` の形。平歯車・ハスバ・かさ・ウォーム・ホイール・ねじ歯車を含み、起点のモーター 1 つで全部が回る。干渉・ロックなし）。
- **version 3**（S3-05）: `CURRENT_SAVE_VERSION = 3`。段階 3 の部品（固定具 `anchors`・キャリア `carriers`・ラック `racks` のコレクション、内歯車、`concentric`・`planet`・`rack` の配置）を含むシーンを、段階 2 までのアプリに読ませると `unsupported-version` になるように上げた。
  - `MIGRATIONS[2]`（2 → 3）は `scene` に `anchors: {}`・`carriers: {}`・`racks: {}` を足す。S3-01〜S3-04 の間に version 2 のまま保存されたファイル（すでにこれらを持つ）は、持っているものをそのまま残す（`scene.anchors ?? {}`）。`scene` がオブジェクトでなければそのまま渡し、`parseScene` が弾く。version 1 → 2 → 3 と順に移行する。
  - S3-01・S3-03・S3-04 の暫定処理（`parseScene` が無いコレクションを `{}` で補う）は取り除いた。version 3 では 6 つのコレクションがすべて必須（無い・オブジェクトでない → `invalid-scene`、path はそのコレクション名）。
  - version 3 の検証（`validateScene` に足したもの）: 遊星のシャフトにモーター・固定具がある（`planetShaftAttachment`。path はモーターの `shaftId`・固定具の `target.id`）、遊星歯車機構の条件を満たさない（`planetaryMismatch`。path `carriers.<id>`。遊星はすべて同じ親・同じ歯数で、太陽 z_s・リング z_r（キャリアと同じ線上の、遊星と同じ大きさ・同じ面（親の `offset` から歯幅未満）の外歯車・内歯車）と遊星の数 n が `planetaryConditions` の同心・等配・隣の遊星を満たす。太陽が無ければ z_s = z_r − 2·z_p。ほかの誤りが無いときだけ見る）。線の根が循環しているとき（`lineRootOf` が null）は `planetLineMismatch` を出さず `meshCycle` で報告する。そのほかの段階 3 の検証（固定具の対象と 1 対象 1 つ、`concentric` の親と循環、`planet` の親が同じ線上、ラックの `axisStep`・`rackAxesNotDistinct`、内歯車の歯数と歯数差）は S3-01〜S3-04 で足したもの。
  - テストのフィクスチャ: `src/core/io/save-file-v2.json`（S2-05 の時点の version 2 の `SaveFile`。シーンは `stage2-showcase` から `anchors`・`carriers`・`racks` を除いたもの）と `e2e/fixtures/stage3-showcase.json`（`Scene` の形。`planetary-ring-fixed` と同じ遊星歯車機構（リングを固定、太陽 60 rpm）に、横 Z の起点 `shaft_d`（原点 `[300, 60, 0]`）の中・20 歯 `gear_d` とモーター 中（3 rpm）、`gear_d` を囲む中・40 歯の内歯車 `gear_i`（`shaft_i`、angle π/2）、同じシャフトの中・20 歯のピニオン `gear_q`（`offset` 16）とラック `rack_r`（中・40 歯、direction x・normal y、基準位置 `[300, 40, 20]`、v = 2π mm/s で端まで約 19 秒）。干渉・ロックなし）。
- **version 4**（S4-03）: `CURRENT_SAVE_VERSION = 4`。シャフトの範囲 `span: [始まり, 終わり]`（必須）と、歯車の省略できる厚さ `width`（S4-05 のため。無ければ大きさごとの値 `gearWidth`。S4-05 では version を上げない）を足した。
  - `MIGRATIONS[3]`（3 → 4）: version 3 の `parseScene`（`span` を省いたシャフトを受け付ける）で読み、`withShaftSpans` で各シャフトに version 3 までの長さ（部品の範囲。部品が無ければ ±`EMPTY_SHAFT_HALF_LENGTH`）を入れる（生の値のシャフトに `span` を足す）。読めなければそのまま渡し、version 4 の検証で弾く。1 → 2 → 3 → 4 と順に移行できる。
  - version 4 の検証: `parseSaveFileObject` は、移行のあとにシャフトが `span` を持たなければ `invalid-scene`（path `shafts.<ID>.span`）。`parseScene` は `span`（2 つの数）・`width`（数）の形を、`validateScene` は `invalidSpan`・`spanTooShort`・`invalidWidth`（§4）を確かめる。
  - 書き出し: `toSaveFile(scene)` は `withShaftSpans` を通す（範囲を省いたシャフトがあれば部品から入れる）。
  - テストのフィクスチャ: `src/core/io/save-file-v3.json`（S3-05 の時点の version 3 の `SaveFile`。シーンは `stage3-showcase` から `span` を除いたもの）。
- **S1-28 で作ったもの**:
  - `src/core/io/save-file.ts` に `SaveFileErrorCode`・`SaveFileError`・`ParseResult`・`serializeSaveFile`・`parseSaveFile`・`Migration`・`MIGRATIONS`・`migrate`・`exportFileName` を足した。`src/core/scene/parse.ts` の `parseScene`。
  - `src/app/json-io.ts` の `createJsonIo({ store, download, fitAll, showToast, now? })`: `exportScene()`（いまのシーンを書き出す）と `importFile(file)`（読めたら `replaceScene` のコマンド → `setCurrentWork { work: null }` → 全体表示。読めなければ理由ごとのトーストを出し、`console.warn` だけでシーンは変えない）。`importErrorMessage(error)` が文言のキーを選ぶ（`import.error.tooLarge`・`invalidJson`・`notGearSimulator`・`invalidVersion`・`unsupportedVersion`・`invalidScene`。`invalid-scene` は `path` の最後が `teeth` なら `import.error.invalidScene.teeth`、`rpm` なら `import.error.invalidScene.rpm`。どれも `{path}` を差し込む）。
  - `src/ui/file-io.ts`: `downloadText(name, text)`（Blob の URL を `<a download>` でクリック）と `createFilePicker(host, accept, onFile)`（隠した `<input type="file" accept=".json,application/json">`、`data-testid="import-file"`）。ツールバーの「インポート」はこの入力の `click()` でファイル選択を開く（Playwright では `filechooser` のイベントで渡す）。
  - 自動保存の復元と作品を開くは、呼ぶ関数（`parseSaveFileObject`）が同じなので、そのまま同じ検証を通る（失敗の文言は S1-27 の `storage.restoreFailed`・`storage.openFailed` のまま）。

## 10. テストの取り決め

- `pnpm verify`（`scripts/verify.ts`）= `biome check .` → `tsc --noEmit` → `vitest run` → Playwright（範囲を絞る）。コミット前に必ず通す。どれかが落ちたらそこで止まる。
  - Playwright は、spec を引数で渡したらそれだけ（`pnpm verify e2e/rack.spec.ts e2e/visual/stage3.spec.ts`）、渡さなければ main から変わった spec（と、変わった `e2e/fixtures/` を import している spec）だけを流す（`playwright test --only-changed=<main との分岐点>`。コミットしていない変更も含む）。src を変えて既存の通しテストに影響しそうなときは、関係する spec を引数で渡す。
  - `pnpm verify:all` は Playwright を全部流す。段階の節目やまとめてマージする前に流す。
  - `pnpm e2e [playwright test の引数]`（`scripts/e2e.ts`）は、git の共通ディレクトリのロック（`<git-common-dir>/gear-simulator-e2e.lock`、`flock`）を取ってから Playwright を流す。他のチェックアウト（ワークツリー）の e2e が流れていれば、終わるまで待つ（同時に流すと CPU・GPU を奪い合って時間切れが出るため）。待たずに流すなら `E2E_NO_LOCK=1`。`pnpm verify` もこれを通す。
- **Vitest**: `src/**/*.test.ts` と `e2e/**/*.test.ts`（e2e の補助関数の単体テスト。例: `e2e/fixtures/blank.test.ts`）。`core` は厚くテストする。浮動小数の比較は `toBeCloseTo` を使う。`isolate: false`（テストファイルごとにモジュールを読み直さない。CPU 時間が半分以下になる）なので、テストはモジュールの状態・差し替えた関数・グローバルを終わりに元に戻す。画面の操作が要らない確認（`__gearSim` で `loadScene` して `getLayout`・`getMotion` を読むだけ、など）は Playwright ではなく Vitest に書く（`src/app/scene-fixtures.test.ts` の `createSim` が `__gearSim` と同じ組み立てを描画なしで作る。時間は `runFrame` を dt = 1/60 で進める）。
- **型検査**: `tsconfig.json` は `strict: true` と `noUncheckedIndexedAccess: true`（配列や Record の添字アクセスは `T | undefined` になる）を採る。`noEmit` で、`src/`・`e2e/`・設定ファイルを対象にする。
- **Biome**: `docs/`・`.claude/`・Markdown は検査しない（資料の書式を崩さないため）。`src/core/**` には `noRestrictedImports` で three・camera-controls と外の層への import を禁止し、表しきれない規則は `src/core/import-rules.test.ts` で補う。
- **Playwright**: Chromium のみ。`webServer` で `vite --mode e2e --port <PORT> --strictPort` を起動する。ポートはメインのチェックアウトが 5174、ワークツリー（`.git` がファイル）はパスのハッシュから 5200〜5999 の中で決める（チェックアウトどうしが他方の vite に相乗りして別のコードを検証しないように。`E2E_PORT` で上書きできる）。WebGL は、GPU のレンダーノード（`/dev/dri/renderD128`）を読み書きできれば GPU（起動引数 `--use-angle=vulkan` `--enable-features=Vulkan` `--ignore-gpu-blocklist`）、できなければ SwiftShader（`--use-angle=swiftshader` と `--enable-unsafe-swiftshader`。GPU の無い環境でも動く）で描く。`E2E_RENDER=gpu|swiftshader` で強制できる。GPU を使うには、ユーザーが `render` グループに入っていること（`sudo usermod -aG render,video $USER` のあとログインし直す。常駐しているプロセスはそれまで古いグループのまま）。並列数は GPU で `workers: 6`、SwiftShader で `workers: 3`（S1-24。SwiftShader は描画が重く、既定の並列数ではページどうしが CPU を奪い合って時間に依るテストが不安定になるため）。`E2E_WORKERS` で上書きできる。全件の時間は、12 コアの機械で GPU 約 2 分、SwiftShader 約 12 分（2026-11-01）。CPU を長く使い続けるテストは `e2e/*.heavy.spec.ts` に置き、別のプロジェクト `chromium-heavy`（`dependencies: ['chromium']`）として他のテストが終わってから流す（S1-24 のテーマと品質の 20 回の切り替え、S1-31 の歯車 200 枚のシーンを 3 秒回す `perf-scene.heavy.spec.ts`）。ブラウザが無い環境では `pnpm e2e:install`（`playwright install chromium`）を先に実行する。
  - 共通フィクスチャ（`e2e/fixtures/test.ts`）で、コンソールエラーと pageerror を集め、テストの終わりに 0 件であることを確かめる。すべての spec はこの `test` を import する。
  - Playwright は `__gearSim.isReady()` が `true` になる（最初のフレームを描いた）のを待ってから操作する。
  - 準備に時間のかかるシーンは `e2e/fixtures/*.json` を `__gearSim.loadScene()` で読み込んで作る。
  - 起動時のシーンは自動保存から復元する（S1-27）。テストごとにブラウザのコンテキストが新しく IndexedDB は空なので、起動直後は空のシーン。部品が要るテストは必ず `loadScene` する（S1-27 で `vertical-slice.spec.ts` と `visual/two-spur.spec.ts` を `two-spur.json` の読み込みに変えた）。`loadScene` も自動保存の対象になる（同じテストの中で再読み込みすると、そのシーンで始まる）。
- `core` の部品（S1-05〜S1-11）を作ったタスクは、そのタスクの中でアプリ（`app/`）にも組み込み、画面で使われる状態にする。ただし S1-10（候補の列挙）は選択の仕組み（S1-16）が必要なので、組み込みは S1-18 で行う。
- **見た目の確認**（`e2e/visual/`）: スクリーンショットを `screenshots/<場面名>.png` に保存する（git では無視する）。自動で判定するのは「真っ黒・真っ白でない」（画素の分散がしきい値以上）ことだけ。`e2e/fixtures/visual.ts` の `captureScene(page, name)` を使う（しきい値は `e2e/fixtures/blank.ts` の `BLANK_VARIANCE_THRESHOLD` = 輝度の分散 4）。
  - **エージェントが画像を見て確かめる**: 見た目に関わる変更（描画・材質・テーマ・UI の配置・文言など）をしたタスクは、関係する `e2e/visual/` の spec を `pnpm verify e2e/visual/xxx.spec.ts` で流し、撮れた `screenshots/<場面名>.png` を画像として開いて（Claude Code の Read）、タスク資料の受け入れ条件と見比べる。おかしければ直してから撮り直す。見て確かめた場面と結果は、コミットのメッセージかタスクの記録に残す。人が最終的に確かめる項目（manual-checks.md）は、これまでどおり残す。
  - `screenshots/` はチェックアウトごとに 1 つなので、同じチェックアウトで visual を同時に流すと上書きし合う。
  - S1-31 から: 画面の大きさは `test.use({ viewport: VISUAL_VIEWPORT })`（1280×800）にそろえ、撮る前に `prepareCapture(page)` を呼ぶ（Space で一時停止して回転を止め、カメラの動きが終わる（3 フレーム続けて動かない）のを待つ）。一時停止で見るものが消える場面（ロックの赤 `lock-red`、回転の矢印と rpm の `info-overlay-on`）は `prepareCapture(page, { pause: false })`。
  - 段階 1 の場面: `theme-brass`・`theme-wood`（showcase、Home）、`theme-brass-mesh-closeup`・`theme-wood-mesh-closeup`（接点から 60 mm）、`theme-brass-low`、`lock-red`、`interference-warning`、`info-overlay-on`、`ui-ja`・`ui-ja-settings`・`ui-en`・`ui-en-settings`（シーン A で g2 を選んだ状態と設定画面）、`works-list`、`context-menu`。各タスクで撮った `empty-scene`・`two-spur`・`axis-gizmo-*`・`candidates`・`selection-highlight` も残す。
  - 段階 2 の場面: `helical-closeup`（S2-01。`helical-pair` のかみ合いを接点から 60 mm）、`bevel-closeup`（S2-02。`bevel-pair` のかみ合いの歯の中ほどを 60 mm から）、`worm-closeup`（S2-03。`worm-basic` の接点 `[16, 70, 0]` を斜め前から）、`worm-locked`（S2-03。`worm-backdrive` のロック中。`pause: false`）、`crossed-helical-closeup`（S2-04。`crossed-pair` の接点 `[4, 100, 0]` を、接点での歯すじ `(1, 0, 1)` と中心を結ぶ線のどちらとも直交する向きの少し上から）。S2-05（`e2e/visual/stage2.spec.ts`）: `stage2-showcase-brass`・`stage2-showcase-wood`（`stage2-showcase` の全体。Home）、`stage2-<helical|bevel|worm|crossed-helical>-<brass|wood>`（`stage2-showcase` の各かみ合いの接点から 70 mm）、`stage2-info-worm`（`worm-basic` の情報表示 ON。ラベルの 3 行目にウォーム比 `30:1`。`pause: false`）、`stage2-ui-ja`・`stage2-ui-en`（パレットでウォームを選び、かさ歯車を選んだ状態）。
  - 段階 3 の場面: `anchor-locked`（S3-01。`anchor-pair` の B を固定してロックしている場面。台座・支柱と赤い震え。`pause: false`）、`internal-closeup`（S3-02。`internal-pair` の接点 `[0, 39, −20]` を、開いている側（上）から斜めに見下ろす拡大）、`planetary`（S3-03。`planetary-ring-fixed` を斜め上から）、`rack-closeup`（S3-04。`rack-basic` の接点 `[0, 40, 4]` を正面の少し上から）、`rack-end-locked`（S3-04。`rack-basic` で端に達してロックした場面。`pause: false`）。 S3-05（`e2e/visual/stage3.spec.ts`）: `stage3-showcase-brass`・`stage3-showcase-wood`（`stage3-showcase` の全体。Home）、`stage3-<planetary|rack|anchor>-<brass|wood>`（遊星歯車機構を開いている側（上）から、ラックを正面の少し上から、リングの固定具を斜め横から）、`stage3-info`（情報表示 ON。キャリアの rpm、ラックの速度と向きの矢印。`pause: false`）、`stage3-ui-ja`・`stage3-ui-en`（キャリアを選んだプロパティパネル）と `stage3-ui-rack-ja`・`stage3-ui-rack-en`（ラックを選んだプロパティパネル）。
- **通しテスト**（`e2e/flows/`。S1-31）: 主要な操作の流れを、操作は画面（パレット・候補・プロパティパネル・ツールバー・キー・メニュー）から行い、状態は `__gearSim` で確かめる。`loadScene` は準備にだけ使う。共通の操作は `e2e/fixtures/sim.ts`（`fixtureScene`・`openApp`・`getScene` などの読み出し・`gearPoint`（pick がその歯車を返す画面の点）・`clickGear`・`clickPerimeterCandidate`（中心が近い外周の候補）・`deselect`・`setPaused`・`settleCamera`・`nextFrames`・`waitAutosaved`）。新しい spec はこれを使う（S1-30 までの spec は各自の補助関数のまま）。
- **性能の計測**（S1-31。`pnpm perf`、`scripts/perf.ts`。`pnpm verify` には入れない）: `vite build --mode e2e` → `vite preview --mode e2e --port 4175` を起動し、Playwright の Chromium を画面ありで開く（`--ignore-gpu-blocklist --disable-gpu-vsync --disable-frame-rate-limit`。SwiftShader は使わない）。画面は 1280×800、`devicePixelRatio` は実機の値。`generatePerfScene(count)`（`src/debug/perf-scene.ts`）を読み込み、条件（高品質／軽量・情報表示 ON／OFF・音あり／ミュート、テーマは真鍮）ごとに、キャンバスをクリック（音を開始）→ Home → 眺めるモード → 3 秒待つ → 指定の秒数だけページ内の `requestAnimationFrame` の間隔を記録する。平均 fps・フレーム時間の中央値・p95・p99・最大、実際に描いた回数（`renderer.info.render.frame` の増え方）、`calls`・`triangles`、描き直しの判定 1 回の時間を表で出し、`perf-results/<YYYYMMDD-HHmmss>.json`（git で無視）にも書く。平均 60fps 以上かつ p95 ≤ 16.7 ms で `OK`、それ以外は `BELOW TARGET`。終了コードは結果によらない。引数は `--count <n>`（初期値 200）・`--seconds <n>`（初期値 10）・`--headless`（動くかの確かめ用。数値は参考にならない）。TypeScript は `tsx` で動かす（`page.evaluate` に関数を渡すと tsx が差し込む `__name` がページに無いので、ページで動かす長い処理は文字列で渡す）。
  - `generatePerfScene(count, seed = 1)`: 歯車 count 枚の、干渉もロックもない、すべて回る 1 本の木（根のシャフト 1 本）。10 枚ずつの列（大きさは S・M・L の順、歯数は 20〜40 を seed で決める、±30° の折れ線）を、前の列の先頭のシャフトに重ねた歯車（列ごとに上の層へ。同じシャフトに 2 枚）と間の 1 枚でつなぎ、各列の先頭のシャフトに列の大きさのモーター（初期値の rpm、+1、ON）を付ける。200 枚でかみ合い 180 組、重ねた歯車 19 枚。
- **`window.__gearSim`**: `import.meta.env.MODE !== 'production'` のときだけ公開する（`src/debug/gear-sim.ts` の `installGearSim`。型は `GearSimDebug` で、API を足すタスクがこの型を広げる）。

```ts
interface GearSimDebug {
  isReady(): boolean; // 最初のフレームを描いたら true（S1-01）
  getScene(): Scene;
  getLayout(): Layout;
  getMotion(): MotionState;
  getShaftWorldOrigin(shaftId: ShaftId): Vec3; // シャフトの原点の実際の位置（遊星のシャフトは公転した位置。S3-03）
  getSelection(): string[];          // 選択が無ければ []、あれば [id]（S1-16。AppState.selection は string | null）
  loadScene(scene: Scene): void;     // 履歴を空にする（Undo の対象にしない）
  dispatch(command: Command): void;  // 編集コマンドを実行して履歴に積む。失敗したら何も変えない
  undo(): void;                      // 戻せなければ何もしない
  redo(): void;
  // 画面上の位置を求める。Playwright でクリックやドラッグの座標に使う
  projectToScreen(world: Vec3): { x: number; y: number };
  getLanguage(): Lang;               // 現在の画面の言語（S1-12）
  setLanguage(lang: Lang): void;     // タブの題名と <html lang> も変わる（S1-12）。S1-30 から updateSettings { language } と同じ経路
  getCamera(): CameraPose;           // 今の視点（移っている途中ならその時点の値。S1-13）
  setCamera(pose: Pick<CameraPose, 'position' | 'target'>): void; // transition なしで即座に（S1-13）
  getLastContextRequest(): { x: number; y: number } | null; // 最後の右クリック（ドラッグなし）のページ座標（S1-13）
  getInputDevice(): InputDevice;     // 'mouse' | 'trackpad'。今使っている（判別した、または固定した）デバイス（S1-14）
  updateSettings(patch: Partial<Settings>): void; // 設定の一部を変える。S1-30 の設定画面も同じ経路（S1-14）
  getSettings(): Settings;           // 今の設定（AppState.settings。localStorage に保存している値。S1-30）
  setWatchMode(on: boolean): void;   // 眺めるモードの ON/OFF（S1-14）
  getView(): { infoOverlay: boolean; watchMode: boolean }; // 表示の状態（AppState.view。S1-29）
  getGizmoTargets(): Array<{ view: ViewName; x: number; y: number }>; // 軸の目印の球の中心のページ座標（S1-14）
  pick(x: number, y: number, kinds?: PickKind[]): PickHit | null; // ページ座標の下の部品（優先順位つき。S1-16）。kinds を渡すとその種類だけ、proxyOnly は見えない当たり判定にだけ当たったとき true（S4-02）
  select(id: string | null): void;   // 選択を置き換える。null で外す。シーンに無い ID は null と同じ（S1-16）
  // 今出ているハンドル。position はドラッグを始めるのに適した点（projectToScreen して押す）。
  // move・height・arc・spanStart・spanEnd の targetId はシャフト、axial の targetId は歯車（S1-17・S1-19・S4-03）
  getHandles(): Array<{ kind: 'move' | 'height' | 'arc' | 'axial' | 'spanStart' | 'spanEnd'; targetId: string; position: Vec3 }>;
  // 今表示している候補（S1-18）。center は仮の歯車の中心のワールド座標。
  // index は一覧の番号で、pick の結果（kind: 'candidate'）の id は String(index)
  // 'bevel' は S2-02、'skew' は S2-03、'enclose' は S3-02、'planetary' は S3-03、'rack'・'rackPinion' は S3-04
  // （'rack' の center はラックの基準位置、'rackPinion' は新しいピニオンの中心）
  // 'coaxial'（同じ軸）は S4-03 で廃止した
  getCandidates(): Array<{ index: number; kind: 'perimeter' | 'bevel' | 'skew' | 'enclose' | 'planetary' | 'rack' | 'rackPinion'; center: Vec3 }>;
  // シャフトの上の仮の歯車（S4-03）。シャフトそのものを選んでいて、パレットが歯車の種類で、そのシャフトにマウスを乗せている間だけ。
  // offset は置く位置、center は仮の歯車の中心のワールド座標、blocked は重なって置けない（赤）
  getShaftGhost(): { shaftId: ShaftId; kind: GearKind; size: SizeKey; offset: number; center: Vec3; blocked: boolean } | null;
  getHand(): HandConstraint | null;  // 手で回しているシャフトと目標の角度。回していなければ null（S1-21）
  isPaused(): boolean;               // 全モーターの一時停止中か（S1-22）
  // ロック中・干渉中として表示している部品の ID（どちらも昇順。interfering はロック中を除く。S1-22）
  getWarningParts(): { locked: string[]; interfering: string[] };
  // 情報表示（S1-23）。enabled はツールバーの ON/OFF（view.infoOverlay。OFF でも選択中の歯車には出る）。
  // arrows は今描いている回転方向の矢印（gearId の昇順。止まっている歯車は含まない。10 Hz で書き換える）
  getInfoOverlay(): { enabled: boolean; arrows: Array<{ gearId: GearId; direction: 1 | -1 }> };
  getRenderInfo(): { theme: ThemeId; quality: Quality; shadowMapEnabled: boolean; pixelRatio: number; textures: number }; // S1-24
  // 描画の負荷（S1-31。scripts/perf.ts が使う。型は src/render/renderer.ts の RenderStats）。frame は実際に描いた回数
  // （renderer.info.render.frame）、calls・triangles は最後に描いたフレームの値、redrawChecks・redrawCheckMs は
  // 描き直しの判定（render/redraw.ts）を呼んだ回数とその時間の合計（ms）
  getRenderStats(): { frame: number; calls: number; triangles: number; redrawChecks: number; redrawCheckMs: number };
  // 音（S1-25・S1-26。型は src/audio/engine.ts の AudioState）。contextState は AudioContext を作る前は 'none'。
  // voices は今鳴らしているかみ合い（f > 0 の組のうちカメラに近い 16 組。S1-26）。key は meshKey、
  // frequency は歯の通過頻度（Hz。連続音のクランプ前の値）、click・tone はクロスフェードの重み、position は接点、
  // kind はかみ合いの種類（音色を決める）、slide はすべりの雑音の強さ（0〜1。ウォーム・ねじ歯車だけ 0 より大きい。S2-05）。
  // S3-05 からラックの組（key は 'ピニオン|ラック' の meshKey、kind 'rack'、f = |v|/(π·m)）と遊星の組（f はキャリアに
  // 対する相対の回転、position は公転した今の接点）も入る
  getAudio(): {
    contextState: 'none' | AudioContextState;
    muted: boolean;
    material: AudioMaterialId;
    voices: Array<{ key: string; frequency: number; click: number; tone: number; position: Vec3; kind: VoiceKind; slide: number }>; // VoiceKind = MeshKind | 'rack'（S3-05）
    background: { level: number; frequency: number } | null; // 選ばれなかった組の背景のうなり（S1-26）
    // 鳴らしているモーターのうなり（カメラに近い 4 個まで、motorId の昇順。一時停止中・OFF は入らない。S1-26）
    motors: Array<{ motorId: MotorId; frequency: number; strain: number; grind: number }>;
    // 起動からの衝撃音の回数と、ガタガタ中のロックのキー（lockKey、昇順。S1-26）。rackHits はラックが端に当たった音の
    // 回数（S3-05。端のロックは衝撃音の代わりにこれを鳴らすので impacts には数えない）
    lockSounds: { impacts: number; rattling: string[]; rackHits: number };
  };
  // 保存（S1-27）。lastAutosaveAt は最後に自動保存を書き終えた時刻（Date.now()。まだなら null）、
  // pendingAutosave は書いていない変更がある（デバウンスで待っている間と書き込みが終わるまで）、
  // currentWorkId はいま開いている作品の ID（無ければ null）
  getStorageStatus(): { lastAutosaveAt: number | null; pendingAutosave: boolean; currentWorkId: string | null };
}

// src/render/picking.ts（S1-16）
type PickKind = 'handle' | 'candidate' | 'gear' | 'carrier' | 'rack' | 'motor' | 'shaft'; // 'carrier' は S3-03、'rack' は S3-04
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
| S1-17 | `getHandles`（済。`'arc'`・`'axial'` は S1-19 で済） |
| S1-19 | `getHandles` が `'arc'`（`targetId` はシャフト）と `'axial'`（`targetId` は歯車）も返す（済。新しい関数は足していない） |
| S1-18 | `getCandidates`（済） |
| S1-20 | なし（パネルは `data-testid` で操作し、状態は既存の `getScene` / `getMotion` で確かめる） |
| S1-21 | `getHand`（済） |
| S1-22 | `isPaused` / `getWarningParts`（済） |
| S1-23 | `getInfoOverlay`（済） |
| S1-24 | `getRenderInfo`（済。`{ theme, quality, shadowMapEnabled, pixelRatio, textures }`。theme・quality は描画に適用済みの値、textures は `renderer.info.memory.textures`。S1-30 で品質の切り替えを確かめるのにも使う） |
| S1-25 | `getAudio`（済。`{ contextState, muted, material, voices }`。S1-26、S2-05、S3-05（済）で中身を広げた） |
| S1-26 | `getAudio` を広げた（済。`voices[].position`・`background`・`motors`・`lockSounds`。新しい関数は足していない） |
| S1-27 | `getStorageStatus`（済。`{ lastAutosaveAt, pendingAutosave, currentWorkId }`） |
| S1-29 | `getView`（済。`{ infoOverlay, watchMode }`） |
| S1-30 | `getSettings`（済。`setLanguage` は `updateSettings { language }` を通すようにした） |
| S1-31 | `getRenderStats`（済。`{ frame, calls, triangles, redrawChecks, redrawCheckMs }`。通しテストに要る API は既存のもので足りた） |
| S2-01 | なし（`getLayout().meshes[].kind` と `getScene().gears[].hand` が増えただけ） |
| S2-02 | なし（`getCandidates()` の `kind` に `'bevel'`、`getScene()` に `apex` と `'bevel'` の配置、`getLayout().meshes[].kind` に `'bevel'` が増えただけ） |
| S2-03 | なし（`getCandidates()` の `kind` に `'skew'`、`getScene()` に `'worm'`・`'wormWheel'` と `'skew'` の配置、`getLayout().meshes[].kind` に `'worm'`、`getMotion().locks[].reason` に `'wormBackDrive'` が増えただけ） |
| S2-04 | なし（`getScene()` に `'crossedHelical'`、`getLayout().meshes[].kind` に `'crossedHelical'` が増えただけ） |
| S2-05 | `getAudio` を広げた（済。`voices[].kind`（`MeshKind`）と `voices[].slide`。新しい関数は足していない） |
| S3-03 | `getShaftWorldOrigin(shaftId)`（済。`core/layout/world.ts` の `shaftWorldOrigin(layout, motion, shaftId)`。`getCandidates()` の `kind` に `'planetary'`、`getScene()` に `carriers` と `concentric`・`planet` の配置、`getLayout()` に `carriers`・`orbit`・`meshes[].carrierShaftId`、`pick` の `kind` に `'carrier'` が増えた） |
| S3-04 | なし（`getMotion()` に `rackPositions`・`rackVelocities`、`locks[].reason` に `'rackEnd'`・`locks[].rackIds`、`getScene()` に `racks` と `'rack'` の配置・固定具の対象 `'rack'`、`getLayout()` に `racks`・`rackMeshes`、`getCandidates()` の `kind` に `'rack'`・`'rackPinion'`、`pick` の `kind` に `'rack'`、`getHand()` の `shaftId` にラックの ID、`getWarningParts().locked` にラックが増えた。ラックの今の位置は `getLayout().racks[id].origin + rackPositions[id]·direction`） |
| S3-05 | `getAudio` を広げた（済。`voices` にラックの組（`kind: 'rack'`）と遊星の組（相対の回転の f、公転した位置）、`voices[].kind` は `VoiceKind`、`lockSounds.rackHits`）。新しい関数は足していない。情報表示のラベルに `data-part-id`・`data-part-kind` を足した（キャリア・ラック） |
| S4-03 | `getShaftGhost()`（済。シャフトの上の仮の歯車）。`getHandles()` の `kind` に `'spanStart'`・`'spanEnd'`、`getScene()` のシャフトに `span`（歯車に省略できる `width`）が増え、`getCandidates()` の `kind` から `'coaxial'` が無くなった |

- トーストは `__gearSim` を通さず、Playwright から `page.evaluate` で `/src/ui/toast.ts` を動的 import して呼ぶ（S1-15）。`tsconfig.json` の `paths`（`/src/*` → `./src/*`）で、この形の import にも型が付く。時間で消えることは `page.clock.install()` で開いたあと `pauseAt` で時計を止め、`runFor` で進めて確かめる。
- 描画領域は S1-15 からページより小さい（ツールバーとパネルの分）。ページ座標で「画面の内側」を確かめるときは、`page.viewportSize()` ではなく `page.locator('canvas').boundingBox()` を使う。

- テスト用のシーンは `e2e/fixtures/<名前>.json` に置く（サブフォルダは作らない）。先に作られたものがあれば使い回す。S1-31 で見直した時点で、同じ中身で名前の違うものは無かった（`future-version.json` はシーン A を新しすぎる版の SaveFile で包んだもので、目的が違うので残した）。

## 11. コミットの取り決め

- `main` に直接コミットする。1 タスク＝1 コミットを基本とする（大きいときは数コミットに分けてよい）。
- メッセージは `feat(S1-05): 力のつり合いを一次方程式で解く` の形。種類は `feat` / `fix` / `refactor` / `test` / `docs` / `chore`。
- タスク資料の `status` の更新（`doing` → `done`）は、そのタスクの最後のコミットに含める。
