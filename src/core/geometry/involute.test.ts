import { describe, expect, it } from 'vitest';
import { GEAR_SIZES, PRESSURE_ANGLE } from '../constants';
import { involuteFn, spurDimensions, spurOutline, toothHalfAngleAt, type Vec2 } from './involute';

const EPS = 1e-9;

function radius(p: Vec2): number {
  return Math.hypot(p[0], p[1]);
}

function at(pts: readonly Vec2[], i: number): Vec2 {
  const p = pts[((i % pts.length) + pts.length) % pts.length];
  if (p === undefined) throw new Error(`点 ${i} がない`);
  return p;
}

function signedArea(pts: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = at(pts, i);
    const b = at(pts, i + 1);
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a[0], b[0]) - 1e-12 <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    Math.min(a[1], b[1]) - 1e-12 <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12
  );
}

function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
}

// 隣り合わない全ての辺の組で交差を調べ、交差する組の数を返す
function countSelfIntersections(pts: readonly Vec2[]): number {
  const n = pts.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a1 = at(pts, i);
    const a2 = at(pts, i + 1);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // 最後の辺と最初の辺は隣り合う
      if (segmentsIntersect(a1, a2, at(pts, j), at(pts, j + 1))) count++;
    }
  }
  return count;
}

// 最寄りの歯の中心線からの極角の絶対値
function angleFromNearestTooth(p: Vec2, teeth: number): number {
  const pitch = (2 * Math.PI) / teeth;
  const a = Math.atan2(p[1], p[0]);
  const k = Math.round(a / pitch);
  return Math.abs(a - k * pitch);
}

describe('countSelfIntersections（検査の道具）', () => {
  it('8 の字の多角形は交差を見つける', () => {
    const bowtie: Vec2[] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ];
    expect(countSelfIntersections(bowtie)).toBeGreaterThan(0);
  });

  it('正方形は交差しない', () => {
    const square: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(countSelfIntersections(square)).toBe(0);
  });
});

describe('spurDimensions', () => {
  it('(1, 12) の寸法', () => {
    const d = spurDimensions(1, 12);
    expect(d.module).toBe(1);
    expect(d.teeth).toBe(12);
    expect(d.pitchRadius).toBeCloseTo(6, 9);
    expect(d.baseRadius).toBeCloseTo(5.638156, 6);
    expect(d.addendumRadius).toBeCloseTo(7, 9);
    expect(d.dedendumRadius).toBeCloseTo(4.75, 9);
  });

  it('(3, 40) の寸法', () => {
    const d = spurDimensions(3, 40);
    expect(d.pitchRadius).toBeCloseTo(60, 9);
    expect(d.baseRadius).toBeCloseTo(56.381557, 6);
    expect(d.addendumRadius).toBeCloseTo(63, 9);
    expect(d.dedendumRadius).toBeCloseTo(56.25, 9);
  });
});

describe('involuteFn', () => {
  it('inv(20°) ≈ 0.0149044', () => {
    expect(involuteFn(PRESSURE_ANGLE)).toBeCloseTo(0.0149044, 7);
  });
});

describe('toothHalfAngleAt', () => {
  it('ピッチ円上では π/(2z)（歯厚は半ピッチ）', () => {
    expect(toothHalfAngleAt(1, 12, 6)).toBeCloseTo(Math.PI / 24, 9);
  });

  it('歯先では正（尖っていない）', () => {
    expect(toothHalfAngleAt(1, 12, 7)).toBeCloseTo(0.0443499, 7);
    expect(toothHalfAngleAt(1, 80, 41)).toBeCloseTo(0.0097432, 7);
    expect(toothHalfAngleAt(2, 20, 22)).toBeCloseTo(0.0315855, 7);
  });
});

describe('spurOutline(1, 12)', () => {
  const teeth = 12;
  const pts = spurOutline(1, teeth);
  const d = spurDimensions(1, teeth);

  it('全点の半径が [4.75, 7] に入り、最大 7・最小 4.75', () => {
    const radii = pts.map(radius);
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(4.75 - EPS);
      expect(r).toBeLessThanOrEqual(7 + EPS);
    }
    expect(Math.max(...radii)).toBeCloseTo(7, 9);
    expect(Math.min(...radii)).toBeCloseTo(4.75, 9);
  });

  it('符号付き面積が正（反時計回り）', () => {
    expect(signedArea(pts)).toBeGreaterThan(0);
  });

  it('最後の点で最初の点を繰り返さない', () => {
    const first = at(pts, 0);
    const last = at(pts, -1);
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeGreaterThan(EPS);
  });

  it('点数が 12 の倍数で、12 回対称', () => {
    expect(pts.length % teeth).toBe(0);
    const per = pts.length / teeth;
    const step = (2 * Math.PI) / teeth;
    const c = Math.cos(step);
    const s = Math.sin(step);
    for (let i = 0; i < pts.length; i++) {
      const p = at(pts, i);
      const q = at(pts, i + per);
      expect(Math.abs(c * p[0] - s * p[1] - q[0])).toBeLessThan(EPS);
      expect(Math.abs(s * p[0] + c * p[1] - q[1])).toBeLessThan(EPS);
    }
  });

  it('x 軸について対称（y を反転した点の集合が元の集合と一致）', () => {
    for (const p of pts) {
      const found = pts.some((q) => Math.abs(q[0] - p[0]) < EPS && Math.abs(q[1] + p[1]) < EPS);
      expect(found).toBe(true);
    }
  });

  it('0 番目の歯の中心線が +x 軸に乗る（点 (7, 0) を囲む歯先がある）', () => {
    const psiA = toothHalfAngleAt(1, teeth, d.addendumRadius);
    const tip = pts.filter(
      (p) => Math.abs(radius(p) - d.addendumRadius) < EPS && p[0] > 0 && Math.abs(p[1]) < 1,
    );
    const angles = tip.map((p) => Math.atan2(p[1], p[0]));
    expect(Math.min(...angles)).toBeCloseTo(-psiA, 9);
    expect(Math.max(...angles)).toBeCloseTo(psiA, 9);
  });

  it('歯面の点の極角が toothHalfAngleAt に一致する', () => {
    const rStart = Math.max(d.baseRadius, d.dedendumRadius);
    const flank = pts.filter((p) => {
      const r = radius(p);
      if (r < rStart - EPS || r >= d.addendumRadius - EPS) return false;
      return Math.abs(r - d.dedendumRadius) >= EPS; // 歯底の円弧の点は除く
    });
    expect(flank.length).toBeGreaterThan(0);
    for (const p of flank) {
      const diff = angleFromNearestTooth(p, teeth) - toothHalfAngleAt(1, teeth, radius(p));
      expect(Math.abs(diff)).toBeLessThan(EPS);
    }
  });

  it('自己交差しない', () => {
    expect(countSelfIntersections(pts)).toBe(0);
  });

  it('0 番目の歯の基礎円より内側の点は、極角 ±toothHalfAngleAt(r_b) の直線上にある', () => {
    const psiB = toothHalfAngleAt(1, teeth, d.baseRadius);
    expect(psiB).toBeCloseTo(0.145804, 6);
    const inside = pts.filter(
      (p) => radius(p) < 5.638156 && Math.abs(Math.atan2(p[1], p[0])) <= psiB + EPS,
    );
    expect(inside.length).toBeGreaterThanOrEqual(2);
    for (const p of inside) {
      expect(Math.abs(Math.abs(Math.atan2(p[1], p[0])) - psiB)).toBeLessThan(EPS);
    }
    // 直線は歯底円まで下りている
    const bottoms = inside.filter((p) => Math.abs(radius(p) - d.dedendumRadius) < EPS);
    expect(bottoms.some((p) => p[1] > 0)).toBe(true);
    expect(bottoms.some((p) => p[1] < 0)).toBe(true);
  });
});

describe('spurOutline(1, 80)（r_f > r_b）', () => {
  const teeth = 80;
  const pts = spurOutline(1, teeth);
  const d = spurDimensions(1, teeth);

  it('全点の半径が [38.75, 41] に入る', () => {
    for (const p of pts) {
      const r = radius(p);
      expect(r).toBeGreaterThanOrEqual(38.75 - EPS);
      expect(r).toBeLessThanOrEqual(41 + EPS);
    }
  });

  it('歯面の最も内側の点の半径が 38.75（基礎円 37.588 ではない）', () => {
    expect(d.baseRadius).toBeCloseTo(37.588, 3);
    // 歯面の点 = 歯先円より内側で、極角が toothHalfAngleAt に一致する点
    const flank = pts.filter(
      (p) =>
        radius(p) < d.addendumRadius - EPS &&
        Math.abs(angleFromNearestTooth(p, teeth) - toothHalfAngleAt(1, teeth, radius(p))) < EPS,
    );
    expect(flank.length).toBeGreaterThan(0);
    expect(Math.min(...flank.map(radius))).toBeCloseTo(38.75, 9);
  });
});

describe('全ての大きさの最小・最大の歯数', () => {
  for (const [size, spec] of Object.entries(GEAR_SIZES)) {
    for (const teeth of [spec.minTeeth, spec.maxTeeth]) {
      it(`${size} ${teeth} 枚: 自己交差しない・半径の範囲に入る`, () => {
        const pts = spurOutline(spec.module, teeth);
        const d = spurDimensions(spec.module, teeth);
        expect(pts.length % teeth).toBe(0);
        for (const p of pts) {
          const r = radius(p);
          expect(r).toBeGreaterThanOrEqual(d.dedendumRadius - EPS);
          expect(r).toBeLessThanOrEqual(d.addendumRadius + EPS);
        }
        expect(signedArea(pts)).toBeGreaterThan(0);
        expect(countSelfIntersections(pts)).toBe(0);
      });
    }
  }
});

describe('OutlineOptions', () => {
  it('分割数を変えると点数が変わり、交差しない', () => {
    const coarse = spurOutline(2, 20, { flankSegments: 1, tipSegments: 1, rootSegments: 1 });
    const fine = spurOutline(2, 20, { flankSegments: 16, tipSegments: 4, rootSegments: 6 });
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(coarse.length % 20).toBe(0);
    expect(countSelfIntersections(coarse)).toBe(0);
    expect(countSelfIntersections(fine)).toBe(0);
  });

  it('分割数が 1 未満や整数でないときは例外にする', () => {
    expect(() => spurOutline(1, 12, { flankSegments: 0 })).toThrow();
    expect(() => spurOutline(1, 12, { tipSegments: 1.5 })).toThrow();
  });
});
