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
  // 親が削除されてその場に残ったシャフト。削除時点のワールド座標と向きを持つ
  | { readonly kind: 'detached'; readonly origin: Vec3; readonly axis: Axis };

export interface Gear {
  readonly id: GearId;
  readonly kind: 'spur'; // 段階 2・3 で 'helical' | 'bevel' | ... を足し、kind で分ける判別共用体にする
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly teeth: number;
  readonly offset: number; // シャフトの原点から、歯幅の負側の面までの軸方向の位置（mm）。AXIAL_SNAP の倍数
}

export interface Motor {
  readonly id: MotorId;
  readonly shaftId: ShaftId;
  readonly size: SizeKey;
  readonly rpm: number; // 無負荷回転数（1〜120）
  readonly direction: 1 | -1; // 回転の正の向きに対する向き
  readonly on: boolean;
}
