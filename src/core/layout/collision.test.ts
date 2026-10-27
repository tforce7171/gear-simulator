import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../math/vec3';
import type { Axis } from '../scene/types';
import { type Collider, collides, findInterferences, gearCollider } from './collision';

// 特に書かない限り radius 7、halfWidth 2（S・12 歯）
function cyl(id: string, center: Vec3, axis: Axis = 'y', shaftId = `shaft_of_${id}`): Collider {
  return gearCollider(id, shaftId, center, axis, 'S', 12);
}

function seg(id: string, start: Vec3, end: Vec3): Collider {
  return { kind: 'segment', id, start, end };
}

// 順序によらず同じ結果になることも確かめる
function both(a: Collider, b: Collider): boolean {
  const ab = collides(a, b);
  expect(collides(b, a)).toBe(ab);
  return ab;
}

describe('gearCollider', () => {
  it('S・12 歯 → radius 7、halfWidth 2', () => {
    const c = gearCollider('g', 's', [0, 0, 0], 'y', 'S', 12);
    expect(c).toEqual({
      kind: 'cylinder',
      id: 'g',
      shaftId: 's',
      center: [0, 0, 0],
      axis: 'y',
      radius: 7,
      halfWidth: 2,
    });
  });

  it('L・16 歯 → radius 27、halfWidth 6', () => {
    const c = gearCollider('g', 's', [0, 0, 0], 'y', 'L', 16);
    expect(c.kind).toBe('cylinder');
    if (c.kind !== 'cylinder') return;
    expect(c.radius).toBe(27);
    expect(c.halfWidth).toBe(6);
  });
});

describe('collides: 円柱 × 円柱（平行）', () => {
  const p = cyl('P', [0, 0, 0]);

  it('中心距離 13 → 干渉。14 → なし（歯先円が接するだけ）', () => {
    expect(both(p, cyl('Q', [13, 0, 0]))).toBe(true);
    expect(both(p, cyl('Q', [14, 0, 0]))).toBe(false);
  });

  it('軸方向: [13, 4, 0] → なし（面が接するだけ）。[13, 3.9, 0] → 干渉', () => {
    expect(both(p, cyl('Q', [13, 4, 0]))).toBe(false);
    expect(both(p, cyl('Q', [13, 3.9, 0]))).toBe(true);
  });

  it('同軸（同じシャフトに重ねた 2 枚）: [0, 3, 0] → 干渉。[0, 4, 0] → なし', () => {
    expect(both(cyl('P', [0, 0, 0], 'y', 's'), cyl('Q', [0, 3, 0], 'y', 's'))).toBe(true);
    expect(both(cyl('P', [0, 0, 0], 'y', 's'), cyl('Q', [0, 4, 0], 'y', 's'))).toBe(false);
  });
});

describe('findInterferences: かみ合いの除外', () => {
  const p = cyl('P', [0, 0, 0]);
  const q = cyl('Q', [12, 0, 0]); // 中心距離 = ピッチ円半径の和

  it('exempt なしでは干渉', () => {
    expect(findInterferences([p, q], [])).toEqual([['P', 'Q']]);
  });

  it('exempt = [[P, Q]] では干渉なし', () => {
    expect(findInterferences([p, q], [['P', 'Q']])).toEqual([]);
  });

  it('exempt = [[Q, P]]（逆順）でも干渉なし', () => {
    expect(findInterferences([p, q], [['Q', 'P']])).toEqual([]);
  });
});

describe('collides: 円柱 × 円柱（直交）', () => {
  const p = cyl('P', [0, 0, 0], 'y');

  it('Q x 軸・[0, 9, 0] → なし（接するだけ）。[0, 8.9, 0] → 干渉', () => {
    expect(both(p, cyl('Q', [0, 9, 0], 'x'))).toBe(false);
    expect(both(p, cyl('Q', [0, 8.9, 0], 'x'))).toBe(true);
  });

  it('斜めの位置: Q x 軸・[0, 5, 10] → 干渉。[0, 5, 14] → なし', () => {
    expect(both(p, cyl('Q', [0, 5, 10], 'x'))).toBe(true);
    expect(both(p, cyl('Q', [0, 5, 14], 'x'))).toBe(false);
  });

  it('軸の組を変えても同じ（P z 軸、Q y 軸）', () => {
    const pz = cyl('P', [0, 0, 0], 'z');
    expect(both(pz, cyl('Q', [10, 0, 5], 'y'))).toBe(true);
    expect(both(pz, cyl('Q', [14, 0, 5], 'y'))).toBe(false);
    expect(both(pz, cyl('Q', [0, 0, 9], 'y'))).toBe(false);
  });
});

describe('collides: 線分 × 円柱', () => {
  const p = cyl('P', [0, 0, 0]);

  it('[−20, 0, 0]〜[20, 0, 0] → 干渉（貫通）', () => {
    expect(both(p, seg('s', [-20, 0, 0], [20, 0, 0]))).toBe(true);
  });

  it('[8, 0, 0]〜[20, 0, 0] → なし', () => {
    expect(both(p, seg('s', [8, 0, 0], [20, 0, 0]))).toBe(false);
  });

  it('[5, −10, 0]〜[5, 10, 0]（軸と平行で内側）→ 干渉', () => {
    expect(both(p, seg('s', [5, -10, 0], [5, 10, 0]))).toBe(true);
  });

  it('[7.5, −10, 0]〜[7.5, 10, 0] → なし', () => {
    expect(both(p, seg('s', [7.5, -10, 0], [7.5, 10, 0]))).toBe(false);
  });

  it('[0, 2, −20]〜[0, 2, 20]（上の面に接する）→ なし', () => {
    expect(both(p, seg('s', [0, 2, -20], [0, 2, 20]))).toBe(false);
  });
});

describe('findInterferences: 歯車と自分のシャフト', () => {
  it('P（shaftId s1）と線分 s1 → 干渉なし。線分の ID が s2 → 干渉', () => {
    const p = cyl('P', [0, 0, 0], 'y', 's1');
    expect(findInterferences([p, seg('s1', [0, -10, 0], [0, 10, 0])], [])).toEqual([]);
    expect(findInterferences([p, seg('s2', [0, -10, 0], [0, 10, 0])], [])).toEqual([['P', 's2']]);
  });
});

describe('collides: 線分 × 線分', () => {
  const a = seg('a', [0, 0, 0], [10, 0, 0]);

  it('同じ直線で重なる → 干渉。端で接するだけ → なし', () => {
    expect(both(a, seg('b', [5, 0, 0], [15, 0, 0]))).toBe(true);
    expect(both(a, seg('b', [10, 0, 0], [20, 0, 0]))).toBe(false);
  });

  it('中で交差 → 干渉。y = 0.1 にずらす → なし', () => {
    const c = seg('c', [-10, 0, 0], [10, 0, 0]);
    expect(both(c, seg('d', [0, 0, -10], [0, 0, 10]))).toBe(true);
    expect(both(c, seg('d', [0, 0.1, -10], [0, 0.1, 10]))).toBe(false);
  });

  it('端点が内側に触れるだけ → なし', () => {
    const c = seg('c', [-10, 0, 0], [10, 0, 0]);
    expect(both(c, seg('d', [0, 0, 0], [0, 0, 10]))).toBe(false);
  });

  it('平行で別の直線 → なし', () => {
    expect(both(a, seg('b', [0, 1, 0], [10, 1, 0]))).toBe(false);
  });
});

describe('findInterferences: 並び', () => {
  it('g2・g1・g3 が互いに重なる → 辞書順', () => {
    const colliders = [cyl('g2', [0, 0, 0]), cyl('g1', [1, 0, 0]), cyl('g3', [2, 0, 0])];
    expect(findInterferences(colliders, [])).toEqual([
      ['g1', 'g2'],
      ['g1', 'g3'],
      ['g2', 'g3'],
    ]);
  });
});

describe('findInterferences: 性能の目安', () => {
  it('30mm 間隔の格子の円柱 200 個と線分 200 本（干渉なし）→ 0 件、100ms 未満', () => {
    const colliders: Collider[] = [];
    for (let i = 0; i < 200; i++) {
      const x = (i % 20) * 30;
      const z = Math.floor(i / 20) * 30;
      colliders.push(cyl(`gear_${i}`, [x, 0, z], 'y', `shaft_${i}`));
      // 歯車の中心を通るシャフト（自分の歯車とは除外される）
      colliders.push(seg(`shaft_${i}`, [x, -10, z], [x, 10, z]));
    }
    expect(colliders).toHaveLength(400);
    // 1 回目は JIT の準備を含むので、2 回目を測る
    findInterferences(colliders, []);
    const start = performance.now();
    const result = findInterferences(colliders, []);
    const elapsed = performance.now() - start;
    expect(result).toEqual([]);
    expect(elapsed).toBeLessThan(100);
  });
});
