import {
  AXIAL_SNAP,
  COLLISION_EPS,
  GEAR_SIZES,
  GEAR_WIDTH_RANGE,
  INTERNAL_MIN_TEETH,
  WORM_THREADS,
} from '../constants';
import { assertNever } from '../scene/gear-shape';
import type { Gear, GearKind, SizeKey } from '../scene/types';
import { internalExtent, internalRimRadius } from './internal';
import { outsideRadius, pitchRadius } from './mesh';
import { wormLength, wormOutsideRadius, wormPitchRadius, wormSectionWidth } from './worm';

// 歯車の種類ごとの寸法（S2-03。design.md §4・§5）

// 厚さ（width）を測る歯車の形。省けば大きさごとの歯幅（S4-05）
interface Sized {
  readonly kind: GearKind;
  readonly size: SizeKey;
  readonly width?: number;
}

// 厚さを変えられる種類か（S4-05）。平歯車・ハスバ歯車・内歯車・ねじ歯車。かさ歯車・ウォーム・ホイールは大きさごとの歯幅で固定
export function isWidthAdjustable(kind: GearKind): boolean {
  switch (kind) {
    case 'spur':
    case 'helical':
    case 'internal':
    case 'crossedHelical':
      return true;
    case 'bevel':
    case 'worm':
    case 'wormWheel':
      return false;
    default:
      return assertNever(kind);
  }
}

// 厚さが範囲（GEAR_WIDTH_RANGE、AXIAL_SNAP 刻み）に入るか（S4-05。歯車とラックで共通）
export function widthInRange(width: number): boolean {
  return (
    Number.isFinite(width) &&
    width >= GEAR_WIDTH_RANGE.min &&
    width <= GEAR_WIDTH_RANGE.max &&
    width % AXIAL_SNAP === 0
  );
}

// 歯車の厚さ（歯幅。S4-05）。厚さを変えられる種類は width、省けば大きさごとの歯幅（GEAR_SIZES の faceWidth）。
// 変えられない種類（かさ歯車・ウォーム・ホイール）は常に大きさごとの歯幅（ウォームの区画は sectionWidth）
export function gearWidth(gear: Sized): number {
  const face = GEAR_SIZES[gear.size].faceWidth;
  return isWidthAdjustable(gear.kind) ? (gear.width ?? face) : face;
}

// 軸方向に占める区画の幅。offset は区画の負側の面、中心は区画の中央。
// 平歯車・ハスバ歯車・かさ歯車・ホイール・ねじ歯車（S2-04）・内歯車は歯幅（gearWidth。S4-05 から歯車ごと）、
// ウォームは長さを AXIAL_SNAP の倍数に切り上げた値
export function sectionWidth(gear: Sized): number {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'wormWheel':
    case 'crossedHelical':
    case 'internal':
      return gearWidth(gear);
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
// 歯先円 × 歯幅（gearWidth。S4-05 から歯車ごと）。ウォームは半径 5m + m、長さ 5πm（歯のある部分。区画の幅ではない）。
// 内歯車（S3-02）はリムの外側の半径 R + 3.25m × 歯幅（リングだけ。ウェブとつなぎの筒は含めない）
export function gearEnvelope(gear: Sized & { readonly teeth: number }): {
  radius: number;
  halfWidth: number;
} {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'wormWheel':
    case 'crossedHelical':
      return {
        radius: outsideRadius(gear.size, gear.teeth),
        halfWidth: gearWidth(gear) / 2,
      };
    case 'worm':
      return { radius: wormOutsideRadius(gear.size), halfWidth: wormLength(gear.size) / 2 };
    case 'internal':
      return {
        radius: internalRimRadius(gear.size, gear.teeth),
        halfWidth: gearWidth(gear) / 2,
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

// 2 枚の歯車の歯幅の区間（中心の軸方向の差 axial、厚さ wa・wb）が COLLISION_EPS より深く重なるか（S4-05。
// かみ合いの判定に使う。厚さの違う 2 枚も、少しでも重なっていればかみ合う）
export function faceOverlaps(axial: number, wa: number, wb: number): boolean {
  return (wa + wb) / 2 - Math.abs(axial) > COLLISION_EPS;
}
