import { describe, expect, it } from 'vitest';
import { GEAR_SIZES, HELIX_ANGLE } from '../constants';
import {
  HELICAL_SLICE_ANGLE,
  helicalSection,
  helicalSliceCount,
  helicalTotalTwist,
  helicalTwistAt,
} from './helical';
import { spurOutline } from './involute';

// 0 番目の歯の中心線（輪郭の点 0 は 0 番目の歯の手前の歯底。歯ごとに同じ並びなので、
// 点 0 の角度の変化は歯の角度の変化と同じ）
function pointAngle(points: ReadonlyArray<readonly [number, number]>, i = 0): number {
  const p = points[i];
  if (p === undefined) throw new Error('点が無い');
  return Math.atan2(p[1], p[0]);
}

function wrapPi(x: number): number {
  return Math.atan2(Math.sin(x), Math.cos(x));
}

describe('ハスバ歯車の形（S2-01）', () => {
  const b = GEAR_SIZES.M.faceWidth; // 8

  it("中・20 歯 'right': −b/2 と +b/2 の断面の歯の角度の差が 8·tan20°/20 ≈ 0.1456 rad", () => {
    const expected = (8 * Math.tan((20 * Math.PI) / 180)) / 20;
    expect(expected).toBeCloseTo(0.1456, 4);
    const lower = helicalSection('M', 20, 'right', -b / 2);
    const upper = helicalSection('M', 20, 'right', b / 2);
    // どの点も同じだけ回っている
    for (const i of [0, 7, 30, 100]) {
      expect(wrapPi(pointAngle(upper, i) - pointAngle(lower, i))).toBeCloseTo(expected, 9);
    }
    expect(helicalTotalTwist('M', 20, 'right')).toBeCloseTo(expected, 12);
  });

  it("'left' では符号が逆", () => {
    const expected = -(8 * Math.tan(HELIX_ANGLE)) / 20;
    const lower = helicalSection('M', 20, 'left', -b / 2);
    const upper = helicalSection('M', 20, 'left', b / 2);
    expect(wrapPi(pointAngle(upper) - pointAngle(lower))).toBeCloseTo(expected, 9);
    expect(helicalTotalTwist('M', 20, 'left')).toBeCloseTo(expected, 12);
  });

  it('歯幅の中央（z = 0）の断面は平歯車の歯形と同じ', () => {
    const spur = spurOutline(GEAR_SIZES.M.module, 20);
    const mid = helicalSection('M', 20, 'right', 0);
    expect(mid).toHaveLength(spur.length);
    mid.forEach(([x, y], i) => {
      const [sx, sy] = spur[i] as [number, number];
      expect(x).toBeCloseTo(sx, 12);
      expect(y).toBeCloseTo(sy, 12);
    });
  });

  it('両端の断面は平歯車と同じ歯形（回しただけ）。ピッチ円の上で z·tan β ずれる', () => {
    const r = 20;
    const twist = helicalTwistAt('M', 20, 'right', b / 2);
    expect(twist * r).toBeCloseTo((b / 2) * Math.tan(HELIX_ANGLE), 12);
    const spur = spurOutline(GEAR_SIZES.M.module, 20);
    helicalSection('M', 20, 'right', b / 2).forEach(([x, y], i) => {
      const [sx, sy] = spur[i] as [number, number];
      expect(Math.hypot(x, y)).toBeCloseTo(Math.hypot(sx, sy), 9);
    });
  });

  it('分割数: 断面の間の回転が HELICAL_SLICE_ANGLE 以下', () => {
    for (const [size, teeth] of [
      ['S', 12],
      ['M', 20],
      ['L', 40],
      ['S', 80],
    ] as const) {
      const n = helicalSliceCount(size, teeth);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(Math.abs(helicalTotalTwist(size, teeth, 'right')) / n).toBeLessThanOrEqual(
        HELICAL_SLICE_ANGLE,
      );
    }
  });
});
