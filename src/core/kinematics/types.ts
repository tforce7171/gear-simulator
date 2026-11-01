import type { GearId, MotorId, RackId, ShaftId } from '../scene/types';

// 運動の状態（design.md §6）。シーンとは別に持ち、Undo の対象にも保存の対象にもならない

// 'wormBackDrive' はウォームの逆駆動（S2-03）。'anchor' は固定具との矛盾（S3-01）。'rackEnd' はラックが端に達した（S3-04）。
// 'toothClash' は欠け歯車がかみ合い直す瞬間に相手の歯と位相が合わない（S5-05）
export type LockReason =
  | 'contradiction'
  | 'stalemate'
  | 'wormBackDrive'
  | 'anchor'
  | 'rackEnd'
  | 'toothClash';

export interface LockInfo {
  readonly reason: LockReason;
  readonly shaftIds: readonly ShaftId[];
  readonly gearIds: readonly GearId[];
  // ロックした成分のラック（S3-04。ID の昇順）。ラックの無い成分では省く
  readonly rackIds?: readonly RackId[];
}

export interface MotionState {
  readonly angles: Readonly<Record<ShaftId, number>>; // シャフトの回転角（rad）
  readonly omegas: Readonly<Record<ShaftId, number>>; // 角速度（rad/s）
  readonly locks: readonly LockInfo[]; // ロックしている部品の組と理由（S1-07）
  readonly backDriven: readonly MotorId[]; // 負けて逆に回されているモーター（S1-07）
  readonly rackPositions: Readonly<Record<RackId, number>>; // ラックの変位 s（mm。S3-04）
  readonly rackVelocities: Readonly<Record<RackId, number>>; // ラックの速度 v（direction の正の向き、mm/s。S3-04）
}

export function emptyMotion(): MotionState {
  return {
    angles: {},
    omegas: {},
    locks: [],
    backDriven: [],
    rackPositions: {},
    rackVelocities: {},
  };
}

// 手で回しているシャフトと、その目標の角度（rad）。無限に強い手として角度を拘束する（S1-07、S1-21）。
// ラック（S3-04）をつかんだときは shaftId にラックの ID、angle に目標の変位 s（mm）を入れる
export interface HandConstraint {
  readonly shaftId: ShaftId | RackId;
  readonly angle: number;
}
