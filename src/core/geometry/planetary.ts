import {
  GEAR_SIZES,
  INTERNAL_MIN_TOOTH_DIFF,
  PLANET_COUNT_RANGE,
  PLANET_MIN_TEETH,
} from '../constants';
import type { Gear } from '../scene/types';
import { teethInRange } from './dimensions';

// 遊星歯車の配置の条件（S3-03。design.md §4）。z_s = 太陽、z_p = 遊星、z_r = リング（内歯車）、n = 遊星の数

export interface PlanetaryConditions {
  // 等配: (z_s + z_r) / n が整数（リングなしなら真）。満たさないと 1 番以降の遊星とリングの位相が合わない
  readonly equalSpacing: boolean;
  // 同心: z_r = z_s + 2·z_p（リングなしなら真）
  readonly concentric: boolean;
  // 隣どうしの遊星が当たらない: (z_s + z_p)·sin(π/n) > z_p + 2（n = 1 は隣が無いので真）
  readonly clearance: boolean;
}

export function planetaryConditions(
  zs: number,
  zp: number,
  zr: number | null,
  n: number,
): PlanetaryConditions {
  return {
    equalSpacing: zr === null || Number.isInteger((zs + zr) / n),
    concentric: zr === null || zr === zs + 2 * zp,
    clearance: n <= 1 || (zs + zp) * Math.sin(Math.PI / n) > zp + 2,
  };
}

// すべての条件を満たすか
export function planetaryOk(zs: number, zp: number, zr: number | null, n: number): boolean {
  const c = planetaryConditions(zs, zp, zr, n);
  return c.equalSpacing && c.concentric && c.clearance;
}

// 遊星の数が範囲（PLANET_COUNT_RANGE）の整数か
export function planetCountInRange(n: number): boolean {
  return Number.isInteger(n) && n >= PLANET_COUNT_RANGE.min && n <= PLANET_COUNT_RANGE.max;
}

// 太陽 sun の n 個の遊星歯車機構の、遊星とリングの歯数（候補から作るとき）。遊星の歯数は PLANET_MIN_TEETH 以上で、
// 3 条件・遊星（平歯車）とリング（内歯車）の歯数の範囲・内歯車の歯数差をすべて満たす最小の値。無ければ null
export function defaultPlanetTeeth(sun: Gear, n: number): { zp: number; zr: number } | null {
  if (!planetCountInRange(n)) return null;
  const max = GEAR_SIZES[sun.size].maxTeeth;
  for (let zp = PLANET_MIN_TEETH; zp <= max; zp++) {
    const zr = sun.teeth + 2 * zp;
    if (!teethInRange('spur', sun.size, zp) || !teethInRange('internal', sun.size, zr)) continue;
    if (zr - zp < INTERNAL_MIN_TOOTH_DIFF) continue;
    if (planetaryOk(sun.teeth, zp, zr, n)) return { zp, zr };
  }
  return null;
}
