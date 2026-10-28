import { describe, expect, it } from 'vitest';
import {
  bevelApex,
  bevelBigEndCenter,
  bevelChildFrame,
  bevelChildOrigin,
  bevelCollisionCylinder,
  bevelToothWidth,
} from './bevel';

// かさ歯車の幾何（S2-02）

describe('大端の中心と頂点', () => {
  it('区画の中心 [0, 39, 0]（縦、歯幅 8）: apex 1 → 大端 [0, 35, 0]、頂点 [0, 55, 0]（R = 20）', () => {
    const big = bevelBigEndCenter([0, 39, 0], 'y', 1, 8);
    expect(big).toEqual([0, 35, 0]);
    expect(bevelApex(big, 'y', 1, 20)).toEqual([0, 55, 0]);
  });

  it('apex −1 → 大端は区画の反対の面 [0, 43, 0]、頂点 [0, 23, 0]', () => {
    const big = bevelBigEndCenter([0, 39, 0], 'y', -1, 8);
    expect(big).toEqual([0, 43, 0]);
    expect(bevelApex(big, 'y', -1, 20)).toEqual([0, 23, 0]);
  });
});

describe('bevel の配置の子', () => {
  it("親 [0, 35, 0]（'y'、apex 1、R 20）、axisStep 2、side −1 → 軸 'x'、大端 [-20, 55, 0]、apex 1、原点 [-20, 55, 0]", () => {
    const frame = bevelChildFrame([0, 35, 0], 'y', 1, 20, 2, -1);
    expect(frame).toEqual({ axis: 'x', bigEnd: [-20, 55, 0], apex: 1 });
    expect(bevelChildOrigin(frame.bigEnd, frame.axis, -1, 8)).toEqual([-20, 55, 0]);
  });

  it('side 1 → 大端 [20, 55, 0]、apex −1、原点 [12, 55, 0]', () => {
    const frame = bevelChildFrame([0, 35, 0], 'y', 1, 20, 2, 1);
    expect(frame).toEqual({ axis: 'x', bigEnd: [20, 55, 0], apex: -1 });
    expect(bevelChildOrigin(frame.bigEnd, frame.axis, 1, 8)).toEqual([12, 55, 0]);
  });

  it("axisStep 1 → 軸 'z'", () => {
    expect(bevelChildFrame([0, 35, 0], 'y', 1, 20, 1, -1).axis).toBe('z');
  });
});

describe('歯の幅と干渉の円柱', () => {
  it('b = min(歯幅, R√2/3)', () => {
    expect(bevelToothWidth('M', 12)).toBeCloseTo((12 * Math.SQRT2) / 3, 12);
    expect(bevelToothWidth('M', 20)).toBe(8);
    expect(bevelToothWidth('S', 12)).toBeCloseTo((6 * Math.SQRT2) / 3, 12);
  });

  it('円柱は大端から頂点の側へ b·cos45°、半径は R + m·cos45°', () => {
    const c = bevelCollisionCylinder([0, 39, 0], 'y', { size: 'M', teeth: 20, apex: 1 });
    const length = 8 * Math.SQRT1_2;
    expect(c.halfWidth).toBeCloseTo(length / 2, 12);
    expect(c.center[1]).toBeCloseTo(35 + length / 2, 12);
    expect(c.radius).toBeCloseTo(20 + 2 * Math.SQRT1_2, 12);
    const down = bevelCollisionCylinder([0, 39, 0], 'y', { size: 'M', teeth: 20, apex: -1 });
    expect(down.center[1]).toBeCloseTo(43 - length / 2, 12);
  });
});
