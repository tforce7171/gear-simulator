import { GEAR_SIZES, HELIX_ANGLE } from '../constants';
import type { Hand, SizeKey } from '../scene/types';
import { spurOutline, type Vec2 } from './involute';
import { pitchRadius } from './mesh';

// ハスバ歯車の形（S2-01。design.md §5）。軸直角断面は平歯車と同じインボリュート歯形（モジュールは軸直角モジュール）で、
// 歯幅の方向（ローカルの z。−歯幅/2 〜 +歯幅/2、中心が原点）に進むほど、ピッチ円の上で tan(HELIX_ANGLE) の割合で
// ずれるようにねじる。歯幅の中央（z = 0）の断面が平歯車の歯形と一致する（位相は中央の断面で合わせる）

export function handSign(hand: Hand): 1 | -1 {
  return hand === 'right' ? 1 : -1;
}

// 軸方向の位置 z（歯幅の中央が 0）での断面の回転角。'right' は z が増えるほど正の向きに回る。
// θ(z) = ±z·tan β / r（r はピッチ円半径）。β は省くと HELIX_ANGLE（ウォームホイールは進み角。S2-03）
export function helicalTwistAt(
  size: SizeKey,
  teeth: number,
  hand: Hand,
  z: number,
  helixAngle: number = HELIX_ANGLE,
): number {
  return (handSign(hand) * z * Math.tan(helixAngle)) / pitchRadius(size, teeth);
}

// 歯幅全体でのねじれの角度（−歯幅/2 の断面から +歯幅/2 の断面までの回転角）。Δφ = ±b·tan β / r。
// faceWidth は歯幅 b（S4-05。省けば大きさごとの歯幅）
export function helicalTotalTwist(
  size: SizeKey,
  teeth: number,
  hand: Hand,
  helixAngle: number = HELIX_ANGLE,
  faceWidth: number = GEAR_SIZES[size].faceWidth,
): number {
  return (
    helicalTwistAt(size, teeth, hand, faceWidth / 2, helixAngle) -
    helicalTwistAt(size, teeth, hand, -faceWidth / 2, helixAngle)
  );
}

// 軸方向の位置 z の断面の 2D 輪郭（平歯車の輪郭 spurOutline を helicalTwistAt だけ回したもの。点の並びは同じ）
export function helicalSection(size: SizeKey, teeth: number, hand: Hand, z: number): Vec2[] {
  return rotateOutline(
    spurOutline(GEAR_SIZES[size].module, teeth),
    helicalTwistAt(size, teeth, hand, z),
  );
}

export function rotateOutline(outline: readonly Vec2[], angle: number): Vec2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return outline.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// ねじれを描くための歯幅の方向の分割数。断面の間の回転が HELICAL_SLICE_ANGLE 以下になるようにする
export const HELICAL_SLICE_ANGLE = 0.02; // rad

export function helicalSliceCount(
  size: SizeKey,
  teeth: number,
  helixAngle: number = HELIX_ANGLE,
  faceWidth: number = GEAR_SIZES[size].faceWidth,
): number {
  const twist = Math.abs(helicalTotalTwist(size, teeth, 'right', helixAngle, faceWidth));
  return Math.max(2, Math.ceil(twist / HELICAL_SLICE_ANGLE));
}
