import { describe, expect, it } from 'vitest';
import {
  closestHeightOnVerticalLine,
  intersectRayPlane,
  nextAxis,
  ROOT_CLEARANCE,
  rootHeight,
  rootPlacementCommand,
  snap,
} from './placement';

describe('snap', () => {
  it('step の倍数に丸める', () => {
    expect(snap(12.4, 5)).toBe(10);
    expect(snap(12.5, 5)).toBe(15);
    expect(snap(-7, 5)).toBe(-5);
  });

  it('-0 を返さない', () => {
    expect(Object.is(snap(-1, 5), 0)).toBe(true);
  });
});

describe('rootHeight', () => {
  it('歯先円半径 + ROOT_CLEARANCE を 5 の倍数に切り上げる', () => {
    expect(ROOT_CLEARANCE).toBe(10);
    expect(rootHeight('M', 20)).toBe(35); // 22 + 10 = 32
    expect(rootHeight('L', 16)).toBe(40); // 27 + 10 = 37
  });

  it('ちょうど倍数ならそのまま', () => {
    expect(rootHeight('S', 30)).toBe(30); // 16 + 10 = 26 → 30
    expect(rootHeight('M', 26)).toBe(40); // 28 + 10 = 38 → 40
    expect(rootHeight('M', 28)).toBe(40); // 30 + 10 = 40
  });
});

describe('nextAxis', () => {
  it('y → x → z → y', () => {
    expect(nextAxis('y')).toBe('x');
    expect(nextAxis('x')).toBe('z');
    expect(nextAxis('z')).toBe('y');
  });
});

describe('intersectRayPlane', () => {
  const floorPoint = [0, 0, 0] as const;
  const up = [0, 1, 0] as const;

  it('真下へのレイと床 → 原点', () => {
    const hit = intersectRayPlane([0, 100, 0], [0, -1, 0], floorPoint, up);
    expect(hit).not.toBeNull();
    expect(hit?.[0]).toBeCloseTo(0, 12);
    expect(hit?.[1]).toBeCloseTo(0, 12);
    expect(hit?.[2]).toBeCloseTo(0, 12);
  });

  it('斜めのレイ', () => {
    const hit = intersectRayPlane([10, 10, 0], [1, -1, 2], floorPoint, up);
    expect(hit?.[0]).toBeCloseTo(20, 12);
    expect(hit?.[1]).toBeCloseTo(0, 12);
    expect(hit?.[2]).toBeCloseTo(20, 12);
  });

  it('床と平行なレイ → null', () => {
    expect(intersectRayPlane([0, 100, 0], [1, 0, 0], floorPoint, up)).toBeNull();
  });

  it('床から離れる向き → null', () => {
    expect(intersectRayPlane([0, 100, 0], [0, 1, 0], floorPoint, up)).toBeNull();
  });
});

describe('closestHeightOnVerticalLine', () => {
  it('水平なレイが直線を通るなら、そのレイの高さ', () => {
    expect(closestHeightOnVerticalLine([-100, 37, 5], [1, 0, 0], 0, 5)).toBeCloseTo(37, 12);
    expect(closestHeightOnVerticalLine([3, 12, 50], [0, 0, -2], 3, 0)).toBeCloseTo(12, 12);
  });

  it('斜めに見下ろすレイは、直線に最も近い点の高さ', () => {
    // [0, 100, 100] から [0, 0, 0] へ向かうレイは直線 x = z = 0 と y = 0 で交わる
    expect(closestHeightOnVerticalLine([0, 100, 100], [0, -1, -1], 0, 0)).toBeCloseTo(0, 9);
  });

  it('縦のレイ（直線と平行）→ null', () => {
    expect(closestHeightOnVerticalLine([10, 100, 0], [0, -1, 0], 0, 0)).toBeNull();
  });
});

describe('rootPlacementCommand', () => {
  it('床の交点を 5mm に吸着し、高さは rootHeight（大きさと DEFAULT_TEETH から）。歯車は付けない（S4-04）', () => {
    expect(rootPlacementCommand([12.4, 0, -7], 'y', 'M')).toEqual({
      type: 'addRootShaft',
      axis: 'y',
      origin: [10, 35, -5],
    });
    expect(rootPlacementCommand([0, 0, 0], 'x', 'S')).toEqual({
      type: 'addRootShaft',
      axis: 'x',
      origin: [0, 30, 0],
    });
  });
});
