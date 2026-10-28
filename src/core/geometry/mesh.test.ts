import { describe, expect, it } from 'vitest';
import { GEAR_SIZES } from '../constants';
import { spurOutline, type Vec2 } from './involute';
import {
  meshPhase,
  outsideRadius,
  pitchRadius,
  samePhase,
  spurCenterDistance,
  toothPitchAngle,
} from './mesh';

// 2π/teeth を法として、差が tol 以内か
function expectPhase(actual: number, expected: number, teeth: number, tol = 1e-9): void {
  const pitch = toothPitchAngle(teeth);
  const d = (((actual - expected) % pitch) + pitch) % pitch;
  expect(Math.min(d, pitch - d)).toBeLessThan(tol);
}

describe('半径と中心距離', () => {
  it('pitchRadius・outsideRadius', () => {
    expect(pitchRadius('S', 12)).toBe(6);
    expect(pitchRadius('M', 20)).toBe(20);
    expect(outsideRadius('L', 16)).toBe(27);
  });

  it('spurCenterDistance', () => {
    expect(spurCenterDistance('S', 12, 24)).toBe(18);
    expect(spurCenterDistance('M', 12, 12)).toBe(24);
    expect(spurCenterDistance('L', 40, 12)).toBe(78);
  });

  it('toothPitchAngle', () => {
    expect(toothPitchAngle(12)).toBeCloseTo(Math.PI / 6, 12);
  });
});

describe('meshPhase', () => {
  it('偶数の歯数の子は半ピッチずらす: meshPhase(0, 12, 24, 0) ≈ π/24', () => {
    expect(meshPhase(0, 12, 24, 0)).toBeCloseTo(Math.PI / 24, 9);
  });

  it('奇数の歯数の子は位相 0: meshPhase(0, 12, 13, 0) ≡ 0', () => {
    expectPhase(meshPhase(0, 12, 13, 0), 0, 13);
  });

  it('親が 1/4 ピッチ回っている: meshPhase(π/24, 12, 24, 0) ≈ π/48', () => {
    expectPhase(meshPhase(Math.PI / 24, 12, 24, 0), Math.PI / 48, 24);
  });

  it('meshPhase(0, 12, 24, π/2) ≈ π/24', () => {
    expectPhase(meshPhase(0, 12, 24, Math.PI / 2), Math.PI / 24, 24);
  });

  it('[0, 2π/z_B) に入る', () => {
    for (const phiA of [-3, -0.1, 0, 0.2, 5]) {
      for (const alpha of [-2, 0, 0.7, 4]) {
        const phi = meshPhase(phiA, 17, 23, alpha);
        expect(phi).toBeGreaterThanOrEqual(0);
        expect(phi).toBeLessThan(toothPitchAngle(23));
      }
    }
  });

  it('周期性: φ_A に 2π/z_A を足しても同じ', () => {
    const cases: [number, number, number, number][] = [
      [0, 12, 24, 0],
      [0.3, 12, 13, 1.1],
      [-1.7, 20, 30, 2.5],
      [2.2, 31, 17, -0.4],
    ];
    for (const [phiA, zA, zB, alpha] of cases) {
      expectPhase(
        meshPhase(phiA + toothPitchAngle(zA), zA, zB, alpha),
        meshPhase(phiA, zA, zB, alpha),
        zB,
      );
    }
  });

  it('転がり: φ_A を δ 進めると子は −(z_A/z_B)·δ ずれる', () => {
    const cases: [number, number, number, number][] = [
      [0, 12, 24, 0],
      [0.3, 12, 13, 1.1],
      [-1.7, 20, 30, 2.5],
      [2.2, 31, 17, -0.4],
    ];
    for (const [phiA, zA, zB, alpha] of cases) {
      for (const delta of [0.01, 0.1]) {
        expectPhase(
          meshPhase(phiA + delta, zA, zB, alpha),
          meshPhase(phiA, zA, zB, alpha) - (zA / zB) * delta,
          zB,
        );
      }
    }
  });
});

describe('samePhase', () => {
  it('資料の値', () => {
    expect(samePhase(0, (2 * Math.PI) / 13 - 1e-9, 13)).toBe(true);
    expect(samePhase(0, 0.01, 13)).toBe(false);
    expect(samePhase(Math.PI / 24, Math.PI / 24 + (2 * Math.PI) / 24, 24)).toBe(true);
  });
});

// ---- 2D の歯形が重ならないことの検査 ----

function transform(pts: readonly Vec2[], rotation: number, center: Vec2): Vec2[] {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return pts.map(([x, y]) => [c * x - s * y + center[0], s * x + c * y + center[1]] as const);
}

function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// 頂点 p が多角形の内側に入っている深さ（外側なら 0）
function penetration(p: Vec2, poly: readonly Vec2[]): number {
  if (!pointInPolygon(p, poly)) return 0;
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, distanceToSegment(p, poly[i] as Vec2, poly[(i + 1) % poly.length] as Vec2));
  }
  return d;
}

function maxPenetration(a: readonly Vec2[], b: readonly Vec2[]): number {
  let max = 0;
  for (const p of a) max = Math.max(max, penetration(p, b));
  for (const p of b) max = Math.max(max, penetration(p, a));
  return max;
}

describe('位相を合わせた 2 枚の歯形が重ならない', () => {
  const m = GEAR_SIZES.S.module;
  const zA = 20;
  const zB = 30;
  const outlineA = spurOutline(m, zA);
  const outlineB = spurOutline(m, zB);
  const distance = spurCenterDistance('S', zA, zB);

  function placed(alpha: number, thetaA: number, phaseShiftB = 0): [Vec2[], Vec2[]] {
    const phiB = meshPhase(0, zA, zB, alpha) + phaseShiftB;
    const thetaB = -(zA / zB) * thetaA;
    const a = transform(outlineA, 0 + thetaA, [0, 0]);
    const b = transform(outlineB, phiB + thetaB, [
      distance * Math.cos(alpha),
      distance * Math.sin(alpha),
    ]);
    return [a, b];
  }

  it('中心距離は 25', () => {
    expect(distance).toBe(25);
  });

  for (const alpha of [0, 0.7, 2.5]) {
    for (const thetaA of [0, 0.05, 0.13, 1.0]) {
      it(`α = ${alpha}、θ_A = ${thetaA}`, () => {
        const [a, b] = placed(alpha, thetaA);
        expect(maxPenetration(a, b)).toBeLessThanOrEqual(1e-3 * m);
      });
    }
  }

  it('B の位相を半ピッチずらすと、深く入る頂点がある（検査が効いている）', () => {
    const [a, b] = placed(0.7, 0, Math.PI / zB);
    expect(maxPenetration(a, b)).toBeGreaterThan(1e-3 * m);
  });
});
