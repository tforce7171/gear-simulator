import { GEAR_SIZES } from '../constants';
import { assertNever } from '../scene/gear-shape';
import type { GearKind, SizeKey } from '../scene/types';
import { outsideRadius, pitchRadius } from './mesh';
import { wormLength, wormOutsideRadius, wormPitchRadius, wormSectionWidth } from './worm';

// 歯車の種類ごとの寸法（S2-03。design.md §4・§5）

// 軸方向に占める区画の幅。offset は区画の負側の面、中心は区画の中央。
// 平歯車・ハスバ歯車・かさ歯車・ホイールは大きさの歯幅、ウォームは長さを AXIAL_SNAP の倍数に切り上げた値
export function sectionWidth(gear: { readonly kind: GearKind; readonly size: SizeKey }): number {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
    case 'bevel':
    case 'wormWheel':
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
      return pitchRadius(gear.size, gear.teeth);
    case 'worm':
      return wormPitchRadius(gear.size);
    default:
      return assertNever(gear.kind);
  }
}

// 歯車を囲む円柱（中心は歯車の中心、軸は歯車の軸）の半径と半分の長さ。干渉判定と表示の範囲に使う。
// 歯先円 × 歯幅。ウォームは半径 5m + m、長さ 5πm（歯のある部分。区画の幅ではない）
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
      return {
        radius: outsideRadius(gear.size, gear.teeth),
        halfWidth: GEAR_SIZES[gear.size].faceWidth / 2,
      };
    case 'worm':
      return { radius: wormOutsideRadius(gear.size), halfWidth: wormLength(gear.size) / 2 };
    default:
      return assertNever(gear.kind);
  }
}
