import { GEAR_SIZES, INTERNAL_MIN_TEETH, WORM_THREADS } from '../constants';
import { assertNever } from '../scene/gear-shape';
import type { Gear, GearKind, SizeKey } from '../scene/types';
import { internalExtent, internalRimRadius } from './internal';
import { outsideRadius, pitchRadius } from './mesh';
import { wormLength, wormOutsideRadius, wormPitchRadius, wormSectionWidth } from './worm';

// 歯車の種類ごとの寸法（S2-03。design.md §4・§5）

// 軸方向に占める区画の幅。offset は区画の負側の面、中心は区画の中央。
// 平歯車・ハスバ歯車・かさ歯車・ホイール・ねじ歯車（S2-04）は大きさの歯幅、ウォームは長さを AXIAL_SNAP の倍数に切り上げた値
export function sectionWidth(gear: { readonly kind: GearKind; readonly size: SizeKey }): number {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'wormWheel':
    case 'crossedHelical':
    case 'internal':
      return GEAR_SIZES[gear.size].faceWidth;
    case 'worm':
      return wormSectionWidth(gear.size);
    default:
      return assertNever(gear.kind);
  }
}

// ピッチ円半径。ウォームは 5m（条数によらない）、それ以外は m·z/2（かさ歯車は大端）
export function gearPitchRadius(gear: {
  readonly kind: GearKind;
  readonly size: SizeKey;
  readonly teeth: number;
}): number {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'wormWheel':
    case 'crossedHelical':
    case 'internal':
      return pitchRadius(gear.size, gear.teeth);
    case 'worm':
      return wormPitchRadius(gear.size);
    default:
      return assertNever(gear.kind);
  }
}

// 歯車を囲む円柱（中心は歯車の中心、軸は歯車の軸）の半径と半分の長さ。干渉判定と表示の範囲に使う。
// 歯先円 × 歯幅。ウォームは半径 5m + m、長さ 5πm（歯のある部分。区画の幅ではない）。
// 内歯車（S3-02）はリムの外側の半径 R + 3.25m × 歯幅（リングだけ。ウェブとつなぎの筒は含めない）
export function gearEnvelope(gear: {
  readonly kind: GearKind;
  readonly size: SizeKey;
  readonly teeth: number;
}): { radius: number; halfWidth: number } {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'wormWheel':
    case 'crossedHelical':
      return {
        radius: outsideRadius(gear.size, gear.teeth),
        halfWidth: GEAR_SIZES[gear.size].faceWidth / 2,
      };
    case 'worm':
      return { radius: wormOutsideRadius(gear.size), halfWidth: wormLength(gear.size) / 2 };
    case 'internal':
      return {
        radius: internalRimRadius(gear.size, gear.teeth),
        halfWidth: GEAR_SIZES[gear.size].faceWidth / 2,
      };
    default:
      return assertNever(gear.kind);
  }
}

// 平行軸でかみ合う組（mesh の配置・contact）の中心距離（S3-02）。外歯車同士は r_a + r_b、
// 内歯車と外歯車は R − r（R は内歯車、r は外歯車のピッチ円半径）
export function centerDistance(a: Gear, b: Gear): number {
  const ra = gearPitchRadius(a);
  const rb = gearPitchRadius(b);
  if (a.kind === 'internal') return ra - rb;
  if (b.kind === 'internal') return rb - ra;
  return ra + rb;
}

// 種類ごとの歯数の範囲（S3-02）。内歯車は INTERNAL_MIN_TEETH 〜 大きさの最大、ウォームは条数 WORM_THREADS だけ、
// それ以外は大きさの範囲（GEAR_SIZES）
export function teethRange(kind: GearKind, size: SizeKey): { min: number; max: number } {
  const { minTeeth, maxTeeth } = GEAR_SIZES[size];
  switch (kind) {
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'wormWheel':
    case 'crossedHelical':
      return { min: minTeeth, max: maxTeeth };
    case 'internal':
      return { min: INTERNAL_MIN_TEETH, max: maxTeeth };
    case 'worm':
      return { min: WORM_THREADS, max: WORM_THREADS };
    default:
      return assertNever(kind);
  }
}

// 歯数が種類と大きさの範囲に入る整数か
export function teethInRange(kind: GearKind, size: SizeKey, teeth: number): boolean {
  const { min, max } = teethRange(kind, size);
  return Number.isInteger(teeth) && teeth >= min && teeth <= max;
}

// 部品がシャフトの上で軸方向に占める範囲 [lo, hi]（シャフトの原点から。offset と同じ座標）。
// 内歯車（S3-02）はリング・つなぎの筒・ウェブの全体、それ以外は区画 [offset, offset + 区画の幅]
export function axialExtent(gear: Gear): readonly [number, number] {
  if (gear.kind === 'internal') return internalExtent(gear);
  return [gear.offset, gear.offset + sectionWidth(gear)];
}

// 歯車の厚さ（S4-03 で保存形式に入れた、省略できる width）。省けば大きさごとの歯幅（GEAR_SIZES の faceWidth）。
// S4-03 の時点では読み書きするだけで、形・干渉・かみ合いは大きさごとの歯幅のまま（使う所の切り替えは S4-05）
export function gearWidth(gear: { readonly size: SizeKey; readonly width?: number }): number {
  return gear.width ?? GEAR_SIZES[gear.size].faceWidth;
}
