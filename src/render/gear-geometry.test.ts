import { describe, expect, it } from 'vitest';
import { CROSSED_HELIX_ANGLE, GEAR_SIZES, HELIX_ANGLE, PRESSURE_ANGLE } from '../core/constants';
import { helicalTotalTwist } from '../core/geometry/helical';
import { spurOutline } from '../core/geometry/involute';
import {
  WORM_LEAD_ANGLE,
  wormAxialPitch,
  wormOutsideRadius,
  wormRootRadius,
} from '../core/geometry/worm';
import {
  buildBevelGeometry,
  buildHelicalGeometry,
  buildSpurGeometry,
  buildWormGeometry,
  createGeometryCache,
  gearBodyScaleZ,
} from './gear-geometry';

const SPUR = { kind: 'spur' } as const;

describe('buildSpurGeometry', () => {
  it("('M', 20): z は [-4, 4]、x・y は歯先円半径 22 以下で 22 に近い", () => {
    const geometry = buildSpurGeometry('M', 20);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) throw new Error('boundingBox がない');
    expect(box.min.z).toBeCloseTo(-4, 6);
    expect(box.max.z).toBeCloseTo(4, 6);
    const maxXY = Math.max(
      Math.abs(box.min.x),
      Math.abs(box.max.x),
      Math.abs(box.min.y),
      Math.abs(box.max.y),
    );
    expect(maxXY).toBeLessThanOrEqual(22 + 1e-6);
    expect(maxXY).toBeGreaterThan(21.9);
    // 0 番目の歯が +x 軸の上にあるので、x の最大は歯先円半径
    expect(box.max.x).toBeCloseTo(22, 6);
    geometry.dispose();
  });

  it('頂点の半径は歯底円以上・歯先円以下', () => {
    const geometry = buildSpurGeometry('S', 12);
    const pos = geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      expect(r).toBeGreaterThanOrEqual(4.75 - 1e-6);
      expect(r).toBeLessThanOrEqual(7 + 1e-6);
    }
    geometry.dispose();
  });
});

describe('createGeometryCache', () => {
  it('同じキーは同じインスタンスを返し、すべて release すると dispose する', () => {
    const cache = createGeometryCache();
    const a1 = cache.acquire(SPUR, 'S', 12);
    const a2 = cache.acquire(SPUR, 'S', 12);
    expect(a2).toBe(a1);
    expect(cache.size()).toBe(1);

    const b = cache.acquire(SPUR, 'S', 13);
    expect(b).not.toBe(a1);
    expect(cache.size()).toBe(2);

    let disposedA = 0;
    let disposedB = 0;
    a1.addEventListener('dispose', () => {
      disposedA++;
    });
    b.addEventListener('dispose', () => {
      disposedB++;
    });

    cache.release(SPUR, 'S', 12);
    expect(disposedA).toBe(0);
    expect(cache.size()).toBe(2);

    cache.release(SPUR, 'S', 12);
    expect(disposedA).toBe(1);
    expect(disposedB).toBe(0);
    expect(cache.size()).toBe(1);
  });

  it('dispose した後に同じキーで acquire すると新しいインスタンスを作る', () => {
    const cache = createGeometryCache();
    const a = cache.acquire(SPUR, 'M', 20);
    cache.release(SPUR, 'M', 20);
    const b = cache.acquire(SPUR, 'M', 20);
    expect(b).not.toBe(a);
    expect(cache.size()).toBe(1);
  });

  it('持っていないキーの release は何もしない', () => {
    const cache = createGeometryCache();
    expect(() => cache.release(SPUR, 'L', 16)).not.toThrow();
    expect(cache.size()).toBe(0);
  });
});

describe('buildHelicalGeometry（S2-01）', () => {
  // 点 (x, y, z) に最も近い頂点までの距離
  function nearest(
    pos: {
      count: number;
      getX(i: number): number;
      getY(i: number): number;
      getZ(i: number): number;
    },
    [x, y, z]: readonly [number, number, number],
  ): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pos.count; i++) {
      best = Math.min(best, Math.hypot(pos.getX(i) - x, pos.getY(i) - y, pos.getZ(i) - z));
    }
    return best;
  }
  function rotated([x, y]: readonly [number, number], a: number): [number, number] {
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  }

  it("中・20 歯 'right': −b/2 と +b/2 の断面の歯の角度の差が 8·tan20°/20 ≈ 0.1456 rad（'left' は逆）", () => {
    const b = GEAR_SIZES.M.faceWidth;
    const delta = (b * Math.tan(HELIX_ANGLE)) / 20;
    expect(delta).toBeCloseTo(0.1456, 4);
    const tip = spurOutline(GEAR_SIZES.M.module, 20)[10] as [number, number];
    for (const [hand, sign] of [
      ['right', 1],
      ['left', -1],
    ] as const) {
      const geometry = buildHelicalGeometry('M', 20, hand);
      const pos = geometry.getAttribute('position');
      // 中央の断面が平歯車と同じなので、両端は ∓Δφ/2 だけ回った位置に同じ点がある
      const lower = rotated(tip, (-sign * delta) / 2);
      const upper = rotated(tip, (sign * delta) / 2);
      expect(nearest(pos, [lower[0], lower[1], -b / 2])).toBeLessThan(1e-5);
      expect(nearest(pos, [upper[0], upper[1], b / 2])).toBeLessThan(1e-5);
      // 逆向きに回した位置には無い
      const wrong = rotated(tip, (-sign * delta) / 2);
      expect(nearest(pos, [wrong[0], wrong[1], b / 2])).toBeGreaterThan(0.1);
      geometry.dispose();
    }
  });

  it('z は [−b/2, b/2]、頂点の半径は歯底円以上・歯先円以下、法線は単位ベクトル', () => {
    const geometry = buildHelicalGeometry('S', 12, 'right');
    const box = geometry.boundingBox;
    if (box === null) throw new Error('boundingBox がない');
    expect(box.min.z).toBeCloseTo(-2, 6);
    expect(box.max.z).toBeCloseTo(2, 6);
    const pos = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      expect(r).toBeGreaterThanOrEqual(4.75 - 1e-5);
      expect(r).toBeLessThanOrEqual(7 + 1e-5);
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
    }
    geometry.dispose();
  });

  it('面は外を向く: 両端の面の法線は ±z、側面の法線は中心から外向き', () => {
    const geometry = buildHelicalGeometry('M', 20, 'left');
    const pos = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const nz = normal.getZ(i);
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      const radial = (pos.getX(i) * normal.getX(i) + pos.getY(i) * normal.getY(i)) / r;
      // 端の面の頂点（法線がほぼ z 向き）は、その面の外を向く
      if (Math.abs(nz) > 0.99) expect(Math.sign(nz)).toBe(Math.sign(z));
      // 側面の頂点は、半径の向きに対して内向きでない。歯底円から基礎円までの半径方向の直線の面は、法線がほぼ
      // 周方向（ねじれで 1% ほど傾く）なので、少しの負を許す。裏返っていれば −1 に近くなる
      else expect(radial).toBeGreaterThan(-0.02);
    }
    geometry.dispose();
  });
});

describe('形状データの共有（S2-01）', () => {
  it("中・20 歯 'right' を 2 回求めると同じ参照。'left' とは別の参照", () => {
    const cache = createGeometryCache();
    const right1 = cache.acquire({ kind: 'helical', hand: 'right' }, 'M', 20);
    const right2 = cache.acquire({ kind: 'helical', hand: 'right' }, 'M', 20);
    const left = cache.acquire({ kind: 'helical', hand: 'left' }, 'M', 20);
    const spur = cache.acquire(SPUR, 'M', 20);
    expect(right2).toBe(right1);
    expect(left).not.toBe(right1);
    expect(spur).not.toBe(right1);
    expect(spur).not.toBe(left);
    expect(cache.size()).toBe(3);
  });
});

describe('buildBevelGeometry（S2-02）', () => {
  it('中・20 歯: 大端は z = −4（区画の負側の面）、そこから頂点の側へ b·cos45°（b = 8）。頂点に向かって相似に縮む', () => {
    const geometry = buildBevelGeometry('M', 20);
    const box = geometry.boundingBox;
    if (box === null) throw new Error('boundingBox がない');
    const front = -4 + 8 * Math.SQRT1_2;
    expect(box.min.z).toBeCloseTo(-4, 6);
    expect(box.max.z).toBeCloseTo(front, 6);
    // 円すい距離 20√2 のうち b = 8 だけ頂点に寄った断面は、大端の (20√2 − 8) / 20√2 倍
    const shrink = 1 - 8 / (20 * Math.SQRT2);
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      const z = pos.getZ(i);
      if (Math.abs(z + 4) < 1e-6) {
        expect(r).toBeLessThanOrEqual(22 + 1e-5);
        expect(r).toBeGreaterThanOrEqual(17.5 - 1e-5);
      } else {
        expect(z).toBeCloseTo(front, 6);
        expect(r).toBeLessThanOrEqual(22 * shrink + 1e-5);
        expect(r).toBeGreaterThanOrEqual(17.5 * shrink - 1e-5);
      }
    }
    geometry.dispose();
  });

  it('面は外を向く: 背面（大端）の法線は −z、頂点側の面は +z、側面は外向き', () => {
    const geometry = buildBevelGeometry('S', 12);
    const pos = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    // 小・12 歯: R = 6、b = min(4, 6√2/3)。大端 z = −2、頂点側の面 z = −2 + b·cos45° = 0
    const mid = (-2 + (-2 + ((6 * Math.SQRT2) / 3) * Math.SQRT1_2)) / 2;
    for (let i = 0; i < pos.count; i++) {
      const nz = normal.getZ(i);
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      const radial = (pos.getX(i) * normal.getX(i) + pos.getY(i) * normal.getY(i)) / r;
      expect(Math.hypot(normal.getX(i), nz, normal.getY(i))).toBeCloseTo(1, 5);
      if (Math.abs(nz) > 0.99) expect(Math.sign(nz)).toBe(Math.sign(pos.getZ(i) - mid));
      else expect(radial).toBeGreaterThan(-0.02);
    }
    geometry.dispose();
  });

  it('apex は形状のキーに含めず（1 と −1 で同じ形状）、描画でローカルの z を反転する', () => {
    const cache = createGeometryCache();
    const up = cache.acquire({ kind: 'bevel', apex: 1 }, 'M', 20);
    const down = cache.acquire({ kind: 'bevel', apex: -1 }, 'M', 20);
    expect(down).toBe(up);
    expect(cache.acquire(SPUR, 'M', 20)).not.toBe(up);
    expect(gearBodyScaleZ({ kind: 'bevel', apex: 1 })).toBe(1);
    expect(gearBodyScaleZ({ kind: 'bevel', apex: -1 })).toBe(-1);
    expect(gearBodyScaleZ(SPUR)).toBe(1);
  });
});

describe('buildWormGeometry（S2-03）', () => {
  it('中: z は [−5π, 5π]（長さ 5πm）、半径は歯先 12 以下、側面は歯底 7.5 以上', () => {
    const geometry = buildWormGeometry('M');
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) throw new Error('boundingBox がない');
    expect(box.min.z).toBeCloseTo(-5 * Math.PI, 6);
    expect(box.max.z).toBeCloseTo(5 * Math.PI, 6);
    const pos = geometry.getAttribute('position');
    let maxR = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      maxR = Math.max(maxR, r);
      expect(r).toBeLessThanOrEqual(wormOutsideRadius('M') + 1e-5);
    }
    expect(maxR).toBeGreaterThan(wormOutsideRadius('M') - 1e-3);
    geometry.dispose();
  });

  it('右ねじ: 角度 θ の方向で歯先になる z は π·m·θ/2π（π·m を法として）', () => {
    const geometry = buildWormGeometry('M');
    const pos = geometry.getAttribute('position');
    const p = wormAxialPitch('M');
    for (const theta of [0, Math.PI / 2, Math.PI]) {
      // この方向の頂点のうち、端の面取りから遠く、歯先の半径にある頂点の z
      const tips: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const r = Math.hypot(x, y);
        if (r < 1) continue;
        const a = Math.atan2(y, x);
        const d = Math.abs(Math.atan2(Math.sin(a - theta), Math.cos(a - theta)));
        if (d > 1e-6 || Math.abs(pos.getZ(i)) > (3 * p) / 2) continue;
        if (r > wormOutsideRadius('M') - 1e-6) tips.push(pos.getZ(i));
      }
      expect(tips.length).toBeGreaterThan(0);
      const expected = (p * theta) / (2 * Math.PI);
      for (const z of tips) {
        const k = (z - expected) / p;
        // 歯先の平らな部分は、ねじ山の中心から ±(p/4 − m·tan20°) ≈ ±0.843 の範囲
        expect(Math.abs(k - Math.round(k)) * p).toBeLessThan(
          p / 4 - 2 * Math.tan(PRESSURE_ANGLE) + 1e-6,
        );
      }
    }
    // 歯底は角度 0 で z = p/2 の近く
    let rootSeen = false;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i)) > 1e-9 || pos.getX(i) <= 0) continue;
      if (Math.abs(pos.getZ(i) - p / 2) < 0.05) {
        expect(Math.hypot(pos.getX(i), pos.getY(i))).toBeCloseTo(wormRootRadius('M'), 6);
        rootSeen = true;
      }
    }
    expect(rootSeen).toBe(true);
    geometry.dispose();
  });

  it('面は外を向く: 両端の面の法線は ±z', () => {
    const geometry = buildWormGeometry('S');
    const pos = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const nz = normal.getZ(i);
      if (Math.abs(nz) > 0.999 && Math.hypot(pos.getX(i), pos.getY(i)) < 1e-9) {
        expect(Math.sign(nz)).toBe(Math.sign(pos.getZ(i)));
      }
      // 側面の頂点は内向きでない
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      if (r > 1e-9 && Math.abs(nz) < 0.999) {
        const radial = (pos.getX(i) * normal.getX(i) + pos.getY(i) * normal.getY(i)) / r;
        expect(radial).toBeGreaterThan(-1e-6);
      }
    }
    geometry.dispose();
  });

  it('ホイールは進み角と同じねじれ角の右ねじれ。形状のキーはウォームが (種類, 大きさ)、ホイールが (種類, 大きさ, 歯数)', () => {
    expect(helicalTotalTwist('M', 30, 'right', WORM_LEAD_ANGLE)).toBeCloseTo((8 * 0.1) / 30, 12);
    const cache = createGeometryCache();
    const worm = cache.acquire({ kind: 'worm' }, 'M', 1);
    expect(cache.acquire({ kind: 'worm' }, 'M', 1)).toBe(worm);
    const wheel30 = cache.acquire({ kind: 'wormWheel' }, 'M', 30);
    expect(cache.acquire({ kind: 'wormWheel' }, 'M', 40)).not.toBe(wheel30);
    expect(cache.size()).toBe(3);
  });
});

describe('ねじ歯車の形（S2-04）', () => {
  it('中・20 歯: 両端の断面の歯の角度の差が b / r = 8 / 20 = 0.4 rad（右ねじれ 45°）', () => {
    expect(helicalTotalTwist('M', 20, 'right', CROSSED_HELIX_ANGLE)).toBeCloseTo(8 / 20, 12);
    const cache = createGeometryCache();
    const geometry = cache.acquire({ kind: 'crossedHelical' }, 'M', 20);
    const pos = geometry.getAttribute('position');
    const nearest = ([x, y, z]: readonly [number, number, number]) => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < pos.count; i++) {
        best = Math.min(best, Math.hypot(pos.getX(i) - x, pos.getY(i) - y, pos.getZ(i) - z));
      }
      return best;
    };
    const rotated = ([x, y]: readonly [number, number], a: number): [number, number] => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
    ];
    const tip = spurOutline(GEAR_SIZES.M.module, 20)[10] as [number, number];
    const b = GEAR_SIZES.M.faceWidth;
    // 中央の断面が平歯車と同じ。右ねじれなので −b/2 は −0.2、+b/2 は +0.2 回った位置に同じ点がある
    const lower = rotated(tip, -0.2);
    const upper = rotated(tip, 0.2);
    expect(nearest([lower[0], lower[1], -b / 2])).toBeLessThan(1e-5);
    expect(nearest([upper[0], upper[1], b / 2])).toBeLessThan(1e-5);
    expect(nearest([lower[0], lower[1], b / 2])).toBeGreaterThan(0.1);
    // 形状のキーは (種類, 大きさ, 歯数)。同じ歯数のハスバ歯車・ホイールとは別の形
    expect(cache.acquire({ kind: 'crossedHelical' }, 'M', 20)).toBe(geometry);
    expect(cache.acquire({ kind: 'helical', hand: 'right' }, 'M', 20)).not.toBe(geometry);
    expect(cache.acquire({ kind: 'wormWheel' }, 'M', 20)).not.toBe(geometry);
    expect(cache.acquire({ kind: 'crossedHelical' }, 'M', 40)).not.toBe(geometry);
    expect(cache.size()).toBe(4);
  });
});
