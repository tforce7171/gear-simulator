import { describe, expect, it } from 'vitest';
import { buildSpurGeometry, createGeometryCache } from './gear-geometry';

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
    const a1 = cache.acquire('spur', 'S', 12);
    const a2 = cache.acquire('spur', 'S', 12);
    expect(a2).toBe(a1);
    expect(cache.size()).toBe(1);

    const b = cache.acquire('spur', 'S', 13);
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

    cache.release('spur', 'S', 12);
    expect(disposedA).toBe(0);
    expect(cache.size()).toBe(2);

    cache.release('spur', 'S', 12);
    expect(disposedA).toBe(1);
    expect(disposedB).toBe(0);
    expect(cache.size()).toBe(1);
  });

  it('dispose した後に同じキーで acquire すると新しいインスタンスを作る', () => {
    const cache = createGeometryCache();
    const a = cache.acquire('spur', 'M', 20);
    cache.release('spur', 'M', 20);
    const b = cache.acquire('spur', 'M', 20);
    expect(b).not.toBe(a);
    expect(cache.size()).toBe(1);
  });

  it('持っていないキーの release は何もしない', () => {
    const cache = createGeometryCache();
    expect(() => cache.release('spur', 'L', 16)).not.toThrow();
    expect(cache.size()).toBe(0);
  });
});
