import type { Vec3 } from '../math/vec3';

// シーンのデータ形式（design.md §4）。ユーザーが決めたこと（意図）だけを持つ不変データ

export type ShaftId = string; // "shaft_xxx"
export type GearId = string; // "gear_xxx"
export type MotorId = string; // "motor_xxx"
export type AnchorId = string; // "anchor_xxx"（S3-01）
export type Axis = 'x' | 'y' | 'z';
export type SizeKey = 'S' | 'M' | 'L';

export interface Scene {
  readonly shafts: Readonly<Record<ShaftId, Shaft>>;
  readonly gears: Readonly<Record<GearId, Gear>>;
  readonly motors: Readonly<Record<MotorId, Motor>>;
  readonly anchors: Readonly<Record<AnchorId, Anchor>>; // 固定具（S3-01）
}

export interface Shaft {
  readonly id: ShaftId;
  readonly placement: ShaftPlacement;
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
  | { readonly kind: 'detached'; readonly origin: Vec3; readonly axis: Axis };

// 親の歯車から位置と向きを導く配置（mesh・bevel・skew）。root・detached は自分で位置と向きを持つ
export type ChildPlacement = Extract<ShaftPlacement, { readonly parentGearId: GearId }>;
export type FreePlacement = Exclude<ShaftPlacement, ChildPlacement>;

export function isChildPlacement(p: ShaftPlacement): p is ChildPlacement {
  return p.kind === 'mesh' || p.kind === 'bevel' || p.kind === 'skew';
}

export type Hand = 'left' | 'right'; // ハスバ歯車のねじれの向き（S2-01）

// 歯車の種類によらないフィールド
export interface GearBase {
  readonly id: GearId;
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly teeth: number;
  readonly offset: number; // シャフトの原点から、歯幅の負側の面までの軸方向の位置（mm）。AXIAL_SNAP の倍数
}

export interface SpurGear extends GearBase {
  readonly kind: 'spur';
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
// 歯車を固定するときは、その歯車のシャフトを固定する（剛体の単位がシャフトのため）。S3-04 で対象にラックを足す
export interface AnchorTarget {
  readonly kind: 'shaft';
  readonly id: ShaftId;
}

export interface Anchor {
  readonly id: AnchorId;
  readonly target: AnchorTarget;
}
