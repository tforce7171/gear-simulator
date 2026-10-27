import { GEAR_SIZES, MESH_PHASE_EPS } from '../constants';
import type { SizeKey } from '../scene/types';

// かみ合いの幾何（design.md §5）

export function pitchRadius(size: SizeKey, teeth: number): number {
  return (GEAR_SIZES[size].module * teeth) / 2;
}

// 歯先円半径
export function outsideRadius(size: SizeKey, teeth: number): number {
  return pitchRadius(size, teeth) + GEAR_SIZES[size].module;
}

export function centerDistance(size: SizeKey, teethA: number, teethB: number): number {
  return pitchRadius(size, teethA) + pitchRadius(size, teethB);
}

// 2π / z
export function toothPitchAngle(teeth: number): number {
  return (2 * Math.PI) / teeth;
}

// x を [0, period) に正規化する
function wrap(x: number, period: number): number {
  const r = x - Math.floor(x / period) * period;
  return r >= period ? r - period : r;
}

// 親の位相・歯数、子の歯数、親の軸まわりの角度から、子の basePhase を [0, 2π/z_B) で返す。
// f_A = frac((α − φ_A)·z_A / 2π)、φ_B = α + π − (2π/z_B)·(1/2 − f_A)
export function meshPhase(
  parentPhase: number,
  parentTeeth: number,
  childTeeth: number,
  angle: number,
): number {
  const raw = ((angle - parentPhase) * parentTeeth) / (2 * Math.PI);
  const fA = raw - Math.floor(raw);
  const pitchB = toothPitchAngle(childTeeth);
  return wrap(angle + Math.PI - pitchB * (0.5 - fA), pitchB);
}

// 2 つの位相が 2π/teeth を法として MESH_PHASE_EPS 以内で一致するか
export function samePhase(a: number, b: number, teeth: number): boolean {
  const pitch = toothPitchAngle(teeth);
  const d = wrap(a - b, pitch);
  return Math.min(d, pitch - d) <= MESH_PHASE_EPS;
}
