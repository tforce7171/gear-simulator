import {
  AXIAL_SNAP,
  GEAR_SIZES,
  PRESSURE_ANGLE,
  WORM_DIAMETER_FACTOR,
  WORM_LENGTH_PITCHES,
} from '../constants';
import type { SizeKey } from '../scene/types';

// ウォームの寸法と形（S2-03。design.md §4・§5）。1 条・右ねじ。m はその大きさのモジュール
// （ホイールの軸直角モジュールと同じ）。軸方向ピッチ = π·m（1 条なので進み = ピッチ）、
// ピッチ円半径 = WORM_DIAMETER_FACTOR·m / 2 = 5m、進み角 γ = atan(π·m / (2π·5m)) = atan(1/10)

// 軸方向ピッチ π·m（ウォームが 1 回転するとねじ山が軸方向に進む量）
export function wormAxialPitch(size: SizeKey): number {
  return Math.PI * GEAR_SIZES[size].module;
}

// ピッチ円半径 5m
export function wormPitchRadius(size: SizeKey): number {
  return (WORM_DIAMETER_FACTOR * GEAR_SIZES[size].module) / 2;
}

// 歯先円半径 5m + m（干渉判定の円柱の半径）
export function wormOutsideRadius(size: SizeKey): number {
  return wormPitchRadius(size) + GEAR_SIZES[size].module;
}

// 歯底円半径 5m − 1.25m
export function wormRootRadius(size: SizeKey): number {
  return wormPitchRadius(size) - 1.25 * GEAR_SIZES[size].module;
}

// 歯のある部分の長さ 5·π·m
export function wormLength(size: SizeKey): number {
  return WORM_LENGTH_PITCHES * wormAxialPitch(size);
}

// 区画の幅: 長さを AXIAL_SNAP の倍数に切り上げた値（小 16、中 32、大 48）。offset は区画の負側の面、
// ねじ山は区画の中央に置く。シャフトの長さ・同じ軸に並べたときの重なりもこの幅で求める
export function wormSectionWidth(size: SizeKey): number {
  return Math.ceil(wormLength(size) / AXIAL_SNAP) * AXIAL_SNAP;
}

// 進み角 γ = atan(軸方向ピッチ / ピッチ円の周長) = atan(2 / WORM_DIAMETER_FACTOR·π/π) = atan(1/10)。
// ホイールのねじれ角もこれと同じ（右ねじれ）
export const WORM_LEAD_ANGLE = Math.atan(1 / WORM_DIAMETER_FACTOR);

// 回転角 angle（ウォームの軸まわり、軸の正の向きに右ねじ）の分だけ、ねじ山が軸方向に進む量 π·m·angle/2π。
// 位相 0 のとき、軸まわりの角度 θ の方向でねじ山の中心は z = wormThreadOffset(θ)（π·m を法として。ウォームの中心から）
// にある（右ねじ）。ウォームが φ だけ回ると、同じ方向のねじ山は z = wormThreadOffset(θ − φ) に移る
export function wormThreadOffset(size: SizeKey, angle: number): number {
  return (wormAxialPitch(size) * angle) / (2 * Math.PI);
}

// 軸方向断面のねじ山の形（ラックの歯形。圧力角 PRESSURE_ANGLE の台形）。ねじ山の中心からの軸方向の距離 zeta での半径。
// ピッチ線（半径 5m）での歯厚は π·m/2、歯先は 5m + m、歯底は 5m − 1.25m。zeta は π·m を法として扱う
export function wormThreadRadius(size: SizeKey, zeta: number): number {
  const p = wormAxialPitch(size);
  const local = zeta - Math.round(zeta / p) * p; // [−p/2, p/2]
  const radius = wormPitchRadius(size) + (p / 4 - Math.abs(local)) / Math.tan(PRESSURE_ANGLE);
  return Math.min(wormOutsideRadius(size), Math.max(wormRootRadius(size), radius));
}
