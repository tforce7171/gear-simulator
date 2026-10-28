import type { GearId, MotorId, ShaftId } from '../scene/types';

// 運動の状態（design.md §6）。シーンとは別に持ち、Undo の対象にも保存の対象にもならない

// 'wormBackDrive' はウォームの逆駆動（S2-03）。'anchor' は固定具との矛盾（S3-01）。S3-04 で 'rackEnd' を足す
export type LockReason = 'contradiction' | 'stalemate' | 'wormBackDrive' | 'anchor';

export interface LockInfo {
  readonly reason: LockReason;
  readonly shaftIds: readonly ShaftId[];
  readonly gearIds: readonly GearId[];
}

export interface MotionState {
  readonly angles: Readonly<Record<ShaftId, number>>; // シャフトの回転角（rad）
  readonly omegas: Readonly<Record<ShaftId, number>>; // 角速度（rad/s）
  readonly locks: readonly LockInfo[]; // ロックしている部品の組と理由（S1-07）
  readonly backDriven: readonly MotorId[]; // 負けて逆に回されているモーター（S1-07）
}

export function emptyMotion(): MotionState {
  return { angles: {}, omegas: {}, locks: [], backDriven: [] };
}

// 手で回しているシャフトと、その目標の角度（rad）。無限に強い手として角度を拘束する（S1-07、S1-21）
export interface HandConstraint {
  readonly shaftId: ShaftId;
  readonly angle: number;
}
