import {
  GEAR_SIZES,
  RACK_ADDENDUM,
  RACK_BACK,
  RACK_DEDENDUM,
  RACK_END_MARGIN_PITCHES,
  RACK_TEETH,
} from '../constants';
import type { SizeKey } from '../scene/types';

// ラックの寸法（S3-04。design.md §4）。長さ L = 歯数 × π·m、端の余白 = π·m（1 ピッチ）。
// 断面は歯幅 × 高さ（歯先はピッチ線から m、歯底はピッチ線から 1.25m、背は歯底から 2m）

export function rackPitch(size: SizeKey): number {
  return Math.PI * GEAR_SIZES[size].module;
}

export function rackLength(size: SizeKey, teeth: number): number {
  return teeth * rackPitch(size);
}

export function rackEndMargin(size: SizeKey): number {
  return RACK_END_MARGIN_PITCHES * rackPitch(size);
}

// 歯数が範囲（RACK_TEETH）の整数か
export function rackTeethInRange(teeth: number): boolean {
  return Number.isInteger(teeth) && teeth >= RACK_TEETH.min && teeth <= RACK_TEETH.max;
}

// ピッチ線から見た断面の高さの範囲（歯の向きを正とした mm）。[背, 歯先]
export function rackHeightRange(size: SizeKey): readonly [number, number] {
  const m = GEAR_SIZES[size].module;
  return [-(RACK_DEDENDUM + RACK_BACK) * m, RACK_ADDENDUM * m];
}

// 断面（歯幅 × 高さ）の外接円の半径と、その中心のピッチ線からの高さ（歯の向きを正）。干渉の円柱に使う
export function rackSectionCircle(size: SizeKey): { radius: number; height: number } {
  const [lo, hi] = rackHeightRange(size);
  const halfHeight = (hi - lo) / 2;
  const halfWidth = GEAR_SIZES[size].faceWidth / 2;
  return { radius: Math.hypot(halfHeight, halfWidth), height: (lo + hi) / 2 };
}

// ラックの変位 s の範囲。かみ合うピニオンのラック上の位置 positions（無ければ [0]）から、
// [max(p) − (L/2 − 余白), min(p) + (L/2 − 余白)]。ピニオンどうしが離れすぎて範囲が空なら、真ん中の 1 点
export function rackTravel(
  size: SizeKey,
  teeth: number,
  positions: readonly number[],
): [number, number] {
  const ps = positions.length === 0 ? [0] : positions;
  const reach = rackLength(size, teeth) / 2 - rackEndMargin(size);
  const lo = Math.max(...ps) - reach;
  const hi = Math.min(...ps) + reach;
  if (lo <= hi) return [lo, hi];
  const mid = (lo + hi) / 2;
  return [mid, mid];
}

// 位置をピッチ π·m の整数倍に吸着させる（2 つ目以降のピニオンの position）
export function snapRackPosition(size: SizeKey, position: number): number {
  const pitch = rackPitch(size);
  return Math.round(position / pitch) * pitch + 0;
}

// x を [−period/2, period/2) に正規化する
export function wrapCentered(x: number, period: number): number {
  const r = x - Math.floor(x / period + 0.5) * period;
  return r >= period / 2 ? r - period : r;
}
