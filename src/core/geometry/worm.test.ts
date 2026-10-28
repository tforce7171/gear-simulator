import { describe, expect, it } from 'vitest';
import { GEAR_SIZES } from '../constants';
import {
  WORM_LEAD_ANGLE,
  wormAxialPitch,
  wormLength,
  wormOutsideRadius,
  wormPitchRadius,
  wormRootRadius,
  wormSectionWidth,
  wormThreadOffset,
  wormThreadRadius,
} from './worm';

// ウォームの寸法と形（S2-03）

describe('ウォームの寸法', () => {
  it('中: ピッチ円半径 10、歯先 12、歯底 7.5、長さ 10π、区画の幅 32、進み角 atan(1/10)', () => {
    expect(wormPitchRadius('M')).toBe(10);
    expect(wormOutsideRadius('M')).toBe(12);
    expect(wormRootRadius('M')).toBe(7.5);
    expect(wormLength('M')).toBeCloseTo(10 * Math.PI, 12);
    expect(wormSectionWidth('M')).toBe(32);
    expect(WORM_LEAD_ANGLE).toBeCloseTo(Math.atan(0.1), 15);
    // 進み角 = atan(軸方向ピッチ / ピッチ円の周長)
    expect(Math.tan(WORM_LEAD_ANGLE)).toBeCloseTo(wormAxialPitch('M') / (2 * Math.PI * 10), 15);
  });

  it('形状: ねじ山が 1 回転で軸方向に π·m 進む（中で 2π mm）', () => {
    expect(wormThreadOffset('M', 2 * Math.PI) - wormThreadOffset('M', 0)).toBeCloseTo(
      2 * Math.PI,
      12,
    );
    for (const size of ['S', 'M', 'L'] as const) {
      const m = GEAR_SIZES[size].module;
      expect(wormThreadOffset(size, 2 * Math.PI)).toBeCloseTo(Math.PI * m, 12);
      // 角度 θ の方向のねじ山の中心（z = offset(θ)）の半径は歯先、そこから半ピッチずれると歯底
      for (const theta of [0, 1, 2.5, 4]) {
        const z = wormThreadOffset(size, theta);
        expect(wormThreadRadius(size, z - wormThreadOffset(size, theta))).toBe(
          wormOutsideRadius(size),
        );
        expect(
          wormThreadRadius(size, z + wormAxialPitch(size) / 2 - wormThreadOffset(size, theta)),
        ).toBe(wormRootRadius(size));
      }
    }
  });

  it('ねじ山の軸方向断面: ピッチ線（半径 5m）での歯厚は π·m/2', () => {
    const p = wormAxialPitch('M');
    expect(wormThreadRadius('M', p / 4)).toBeCloseTo(wormPitchRadius('M'), 12);
    expect(wormThreadRadius('M', -p / 4)).toBeCloseTo(wormPitchRadius('M'), 12);
    expect(wormThreadRadius('M', p / 4 + p)).toBeCloseTo(wormPitchRadius('M'), 12);
  });
});
