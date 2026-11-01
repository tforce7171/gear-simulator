import type { Vec3 } from '../math/vec3';

// シーンのデータ形式（design.md §4）。ユーザーが決めたこと（意図）だけを持つ不変データ

export type ShaftId = string; // "shaft_xxx"
export type GearId = string; // "gear_xxx"
export type MotorId = string; // "motor_xxx"
export type AnchorId = string; // "anchor_xxx"（S3-01）
export type CarrierId = string; // "carrier_xxx"（S3-03）
export type RackId = string; // "rack_xxx"（S3-04）
export type Axis = 'x' | 'y' | 'z';
export type SizeKey = 'S' | 'M' | 'L';
// 部品ごとの色（S5-04）。歯車・ラック・キャリア・固定具が省略できる color に持つ。省略（「自動」）はテーマと種類で決まる質感。
// 選べる色はテーマの系統で変わる（core/theme.ts の THEME_PART_COLORS）。今のテーマの系統にない色は「自動」の質感で描く
export type PartColor = 'brass' | 'silver' | 'metallicBlue' | 'wood' | 'darkOak';

export interface Scene {
  readonly shafts: Readonly<Record<ShaftId, Shaft>>;
  readonly gears: Readonly<Record<GearId, Gear>>;
  readonly motors: Readonly<Record<MotorId, Motor>>;
  readonly anchors: Readonly<Record<AnchorId, Anchor>>; // 固定具（S3-01）
  readonly carriers: Readonly<Record<CarrierId, Carrier>>; // 遊星歯車のキャリア（S3-03）
  readonly racks: Readonly<Record<RackId, Rack>>; // ラック（S3-04）
}

export interface Shaft {
  readonly id: ShaftId;
  readonly placement: ShaftPlacement;
  // シャフトの軸方向の範囲（S4-03）。シャフトの原点からの [始まり, 終わり]（mm）。編集コマンドで変えた端は AXIAL_SNAP の倍数。
  // 載っている部品の範囲（余白込み。requiredShaftSpans）を含まなければならない（検証の spanTooShort）。
  // 保存形式 version 4 では必ず持つ。省いたシャフト（テストで組んだシーンなど）は、載っている部品から求めた範囲を使う
  readonly span?: readonly [number, number];
}

export type ShaftPlacement =
  // 起点のシャフト。origin はワールド座標
  | { readonly kind: 'root'; readonly origin: Vec3; readonly axis: Axis }
  // 親の歯車の外周に生やしたシャフト。軸の向きは保存せず、親から導く（平歯車なら親と同じ）
  | {
      readonly kind: 'mesh';
      readonly parentGearId: GearId; // かみ合う相手（親）
      readonly childGearId: GearId; // このシャフト上の、親とかみ合う歯車
      readonly angle: number; // 親の軸まわりの角度（rad）
    }
  // 親のかさ歯車とかみ合うかさ歯車を載せたシャフト（S2-02）。軸の向きは親の軸を axisStep 回進めたもの。
  // 子の大端の中心 = 親の大端の中心 + R·side·(このシャフトの軸) + R·親の apex·(親の軸)。子の apex は −side
  | {
      readonly kind: 'bevel';
      readonly parentGearId: GearId; // 親のかさ歯車
      readonly childGearId: GearId; // このシャフト上の、親とかみ合うかさ歯車
      readonly axisStep: 1 | 2; // このシャフトの軸 = 親の軸を x → y → z → x の順に axisStep 回進めた軸
      readonly side: 1 | -1; // 子が、親の大端の中心から見てこのシャフトの軸の正・負どちら側にあるか
    }
  // ねじれた位置の 90° でかみ合う歯車（ウォームとホイール。S2-03。S2-04 のねじ歯車も使う）を載せたシャフト。
  // 軸の向きは親の軸を axisStep 回進めたもの。u を 2 本の軸のどちらとも直交する座標軸として、
  // 子の中心 = 親の中心 + (r_親 + r_子)·side·u（r はピッチ円半径）
  | {
      readonly kind: 'skew';
      readonly parentGearId: GearId;
      readonly childGearId: GearId;
      readonly axisStep: 1 | 2; // このシャフトの軸 = 親の軸を x → y → z → x の順に axisStep 回進めた軸
      readonly side: 1 | -1;
    }
  // 親が削除されてその場に残ったシャフト。削除時点のワールド座標と向きを持つ
  | { readonly kind: 'detached'; readonly origin: Vec3; readonly axis: Axis }
  // 親のシャフトと同じ線上の別のシャフト（S3-03）。原点・軸は親と同じ。キャリアやリングのシャフトに使う
  | { readonly kind: 'concentric'; readonly parentShaftId: ShaftId }
  // キャリアに載った遊星のシャフト（S3-03）。位置の求め方は mesh と同じ（キャリアの角度が 0 のときの基準配置）。
  // 実際の位置は、キャリアのシャフトの回転角だけキャリアの軸まわりに回したもの。軸はキャリアのシャフトの軸
  | {
      readonly kind: 'planet';
      readonly carrierId: CarrierId;
      readonly parentGearId: GearId; // かみ合う相手。キャリアのシャフトと同じ線上の歯車（太陽歯車かリング）
      readonly childGearId: GearId; // このシャフト上の、親とかみ合う歯車
      readonly angle: number; // キャリアの角度が 0 のときの、キャリアの軸まわりの角度（rad）
    }
  // ラックに載せた 2 つ目以降のピニオンのシャフト（S3-04）。軸はラックの歯幅の方向（持たない）。
  // 子の中心 = ラックの基準位置 + position·direction + r_子·normalSign·normal、子の offset は 0 として原点を逆算する
  | {
      readonly kind: 'rack';
      readonly rackId: RackId;
      readonly childGearId: GearId; // このシャフト上の、ラックとかみ合う平歯車
      readonly position: number; // ラックの基準位置からの direction の向きの位置（mm）。π·m の整数倍
    };

// 親の歯車から位置と向きを導く配置（mesh・bevel・skew・planet）。root・detached は自分で位置と向きを持ち、
// concentric（S3-03）は親のシャフトと同じ位置と向き
export type ChildPlacement = Extract<ShaftPlacement, { readonly parentGearId: GearId }>;
export type FreePlacement = Extract<ShaftPlacement, { readonly origin: Vec3 }>;
export type ConcentricPlacement = Extract<ShaftPlacement, { readonly kind: 'concentric' }>;
export type PlanetPlacement = Extract<ShaftPlacement, { readonly kind: 'planet' }>;
export type RackShaftPlacement = Extract<ShaftPlacement, { readonly kind: 'rack' }>;

export function isChildPlacement(p: ShaftPlacement): p is ChildPlacement {
  return p.kind === 'mesh' || p.kind === 'bevel' || p.kind === 'skew' || p.kind === 'planet';
}

export function isFreePlacement(p: ShaftPlacement): p is FreePlacement {
  return p.kind === 'root' || p.kind === 'detached';
}

export type Hand = 'left' | 'right'; // ハスバ歯車のねじれの向き（S2-01）

// 歯車の種類によらないフィールド
export interface GearBase {
  readonly id: GearId;
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly teeth: number;
  readonly offset: number; // シャフトの原点から、歯幅の負側の面までの軸方向の位置（mm）。AXIAL_SNAP の倍数
  // 歯車の厚さ（歯幅。mm。S4-03 で保存形式に入れた省略できる欄、S4-05 から形・干渉・かみ合い・シャフトの範囲に使う）。
  // GEAR_WIDTH_RANGE の GEAR_WIDTH_STEP（0.5 mm）の倍数（S5-01）。省くと大きさごとの歯幅（gearWidth）。かさ歯車・ウォーム・ホイールは
  // 大きさごとの歯幅で固定（持つなら同じ値。S4-05）。音・運動には使わない
  readonly width?: number;
  readonly color?: PartColor; // 色（S5-04）。省くと「自動」（テーマと種類で決まる質感）
}

export interface SpurGear extends GearBase {
  readonly kind: 'spur';
  // 欠け歯車（S5-05）。残す歯数（1〜teeth の整数）。省略または teeth のときは普通の平歯車
  readonly toothCount?: number;
  // 歯のある弧の始まりの歯の番号（0〜teeth − 1 の整数）。省略は 0。歯 toothStart から toothCount 個を残す（S5-05）
  readonly toothStart?: number;
}

// ハスバ歯車（S2-01）。ねじれ角は HELIX_ANGLE で固定。'right' は軸の正の向きに進むほど歯が正の向きに回る
export interface HelicalGear extends GearBase {
  readonly kind: 'helical';
  readonly hand: Hand;
}

// かさ歯車（S2-02）。交わる角度は 90°、歯数比 1:1（ピッチ円すい角 45°）のみ。
// apex はピッチ円すいの頂点が、大端のピッチ円の中心から見てシャフトの軸の正・負のどちらにあるか
export interface BevelGear extends GearBase {
  readonly kind: 'bevel';
  readonly apex: 1 | -1;
}

// ウォーム（S2-03）。1 条・右ねじ。teeth は条数で常に WORM_THREADS（1）。ピッチ円半径は 5m、
// 歯のある部分の長さは 5πm で、軸方向には長さを AXIAL_SNAP の倍数に切り上げた区画を占める（offset は区画の負側の面）
export interface WormGear extends GearBase {
  readonly kind: 'worm';
}

// ウォームホイール（S2-03）。進み角と同じねじれ角の右ねじれ。歯数の範囲と歯幅は平歯車と同じ
export interface WormWheel extends GearBase {
  readonly kind: 'wormWheel';
}

// ねじ歯車（S2-04）。ねじれ角 CROSSED_HELIX_ANGLE（45°）の右ねじれ（固定）。同じ大きさのねじ歯車とだけ、
// ねじれた位置の 90°（skew の配置）でかみ合う。歯数の範囲と歯幅は平歯車と同じ、ピッチ円半径は m·z/2
export interface CrossedHelicalGear extends GearBase {
  readonly kind: 'crossedHelical';
}

// 内歯車（S3-02）。内側に歯のあるリングで、同じ大きさの平歯車と内側でかみ合う（同じ向きに回る）。
// ピッチ円半径 R = m·z/2、歯先（内側）R − m、歯底 R + 1.25m、リムの外側 R + 3.25m、歯幅は大きさの歯幅。
// offset はリング（歯幅の区画）の負側の面。webSide はカップの底（ウェブ）がリングから見て軸の正・負どちら側にあるか
export interface InternalGear extends GearBase {
  readonly kind: 'internal';
  readonly webSide: 1 | -1;
}

// 種類ごとの判別共用体。種類ごとに分ける箇所は switch (gear.kind) で網羅性を型で確かめる（assertNever）
export type Gear =
  | SpurGear
  | HelicalGear
  | BevelGear
  | WormGear
  | WormWheel
  | CrossedHelicalGear
  | InternalGear; // S3-02 で内歯車を足した
export type GearKind = Gear['kind'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// 歯車の種類と、形を変える属性（Gear から GearBase のフィールドを除いたもの。ハスバ歯車では hand）
export type GearShape = DistributiveOmit<Gear, keyof GearBase>;

export interface Motor {
  readonly id: MotorId;
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly rpm: number; // 無負荷回転数（1〜120）
  readonly direction: 1 | -1; // 回転の正の向きに対する向き
  readonly on: boolean;
}

// 固定具（S3-01）。対象のシャフトを地面に固定して回らなくする（拘束 ω = 0）。1 つの対象に最大 1 つ。
// 歯車を固定するときは、その歯車のシャフトを固定する（剛体の単位がシャフトのため）。
// ラック（S3-04）を固定すると、ラックの速度 v = 0 の拘束になる
export type AnchorTarget =
  | { readonly kind: 'shaft'; readonly id: ShaftId }
  | { readonly kind: 'rack'; readonly id: RackId };

export interface Anchor {
  readonly id: AnchorId;
  readonly target: AnchorTarget;
  readonly color?: PartColor; // 色（S5-04）。省くと「自動」
}

// 遊星歯車のキャリア（S3-03）。シャフト shaftId と一緒に回る剛体で、遊星のシャフト（planet の配置）を支える。
// 遊星の数は、このキャリアを参照する遊星のシャフトの数（別に持たない）
export interface Carrier {
  readonly id: CarrierId;
  readonly shaftId: ShaftId; // このシャフトと一緒に回る
  readonly offset: number; // 板の負側の面の位置（mm。シャフトの原点から）。AXIAL_SNAP の倍数（Gear.offset と同じ考え方）
  readonly size: SizeKey; // 板の厚み・シャフトの太さに使う
  readonly color?: PartColor; // 色（S5-04）。省くと「自動」
}

// ラック（S3-04）。直線に動く剛体。長さ L = 歯数 × π·m、歯形は圧力角 20° の直線歯（台形）。
// 向きは 3 本の軸で決まる: 動く向き direction、歯が向く軸 normal（とその向き normalSign）、残りの軸が歯幅の方向（＝ピニオンの軸）。
// pinion: 向きはピニオンの軸から導く（direction = ピニオンの軸を axisStep 回進めた軸、normal = 残りの軸）。
// 基準位置（変位 s = 0 のときのピッチ線の中央）= ピニオンの中心 − r·normalSign·normal。
// detached: ピニオンが消されて浮いたラック。その時点の Layout の基準位置と向きを写す
export type RackPlacement =
  | {
      readonly kind: 'pinion';
      readonly gearId: GearId;
      readonly axisStep: 1 | 2; // direction = ピニオンの軸を axisStep 回進めた軸。normal は残りの軸
      readonly normalSign: 1 | -1; // 歯が normal の正・負どちらを向くか
    }
  | {
      readonly kind: 'detached';
      readonly origin: Vec3; // 基準位置のワールド座標
      readonly direction: Axis; // 動く向き
      readonly normal: Axis; // 歯が向く軸（direction と異なる）
      readonly normalSign: 1 | -1;
    };

export interface Rack {
  readonly id: RackId;
  readonly size: SizeKey;
  readonly teeth: number; // RACK_TEETH の範囲の整数
  readonly placement: RackPlacement;
  // 厚さ（歯幅の方向の幅。mm。S4-05 で足した省略できる欄）。GEAR_WIDTH_RANGE の GEAR_WIDTH_STEP（0.5 mm）の倍数（S5-01）。
  // 省くと大きさごとの歯幅（rackWidth）。歯幅の方向の中心はピニオンの中心（ピニオンの厚さが違っても中央をそろえる）
  readonly width?: number;
  readonly color?: PartColor; // 色（S5-04）。省くと「自動」
}
