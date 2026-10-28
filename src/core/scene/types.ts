import type { Vec3 } from '../math/vec3';

// シーンのデータ形式（design.md §4）。ユーザーが決めたこと（意図）だけを持つ不変データ

export type ShaftId = string; // "shaft_xxx"
export type GearId = string; // "gear_xxx"
export type MotorId = string; // "motor_xxx"
export type Axis = 'x' | 'y' | 'z';
export type SizeKey = 'S' | 'M' | 'L';

export interface Scene {
  readonly shafts: Readonly<Record<ShaftId, Shaft>>;
  readonly gears: Readonly<Record<GearId, Gear>>;
  readonly motors: Readonly<Record<MotorId, Motor>>;
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
  // 親が削除されてその場に残ったシャフト。削除時点のワールド座標と向きを持つ
  | { readonly kind: 'detached'; readonly origin: Vec3; readonly axis: Axis };

// 親の歯車から位置と向きを導く配置（mesh・bevel）。root・detached は自分で位置と向きを持つ
export type ChildPlacement = Extract<ShaftPlacement, { readonly parentGearId: GearId }>;
export type FreePlacement = Exclude<ShaftPlacement, ChildPlacement>;

export function isChildPlacement(p: ShaftPlacement): p is ChildPlacement {
  return p.kind === 'mesh' || p.kind === 'bevel';
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

// 種類ごとの判別共用体。種類ごとに分ける箇所は switch (gear.kind) で網羅性を型で確かめる（assertNever）
export type Gear = SpurGear | HelicalGear | BevelGear; // S2-03 以降で種類を足す
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
