import { describe, expect, it } from 'vitest';
import { EMPTY_SHAFT_HALF_LENGTH, SHAFT_END_MARGIN } from '../constants';
import { samePhase } from '../geometry/mesh';
import type { Axis, Gear, Scene, Shaft, SizeKey } from '../scene/types';
import { descendantShafts, resolveLayout } from './resolve';

// テスト用の小さな組み立て
function root(id: string, origin: [number, number, number], axis: Axis = 'y'): Shaft {
  return { id, placement: { kind: 'root', origin, axis } };
}
function detached(id: string, origin: [number, number, number], axis: Axis): Shaft {
  return { id, placement: { kind: 'detached', origin, axis } };
}
function meshShaft(id: string, parentGearId: string, childGearId: string, angle: number): Shaft {
  return { id, placement: { kind: 'mesh', parentGearId, childGearId, angle } };
}
function gear(id: string, shaftId: string, teeth: number, offset = 0, size: SizeKey = 'S'): Gear {
  return { id, kind: 'spur', shaftId, size, teeth, offset };
}
function scene(shafts: Shaft[], gears: Gear[]): Scene {
  return {
    shafts: Object.fromEntries(shafts.map((s) => [s.id, s])),
    gears: Object.fromEntries(gears.map((g) => [g.id, g])),
    motors: {},
  };
}

function expectVec(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined();
  expected.forEach((e, i) => {
    expect(actual?.[i]).toBeCloseTo(e, 9);
  });
}

function compare(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function byPair(p: readonly [string, string], q: readonly [string, string]): number {
  return compare(p[0], q[0]) || compare(p[1], q[1]);
}

const S3 = Math.sqrt(3);

describe('定数', () => {
  it('design.md §3 の値', () => {
    expect(SHAFT_END_MARGIN).toBe(4);
    expect(EMPTY_SHAFT_HALF_LENGTH).toBe(10);
  });
});

describe('resolveLayout: 位置・位相・span', () => {
  it('起点 1 本', () => {
    const l = resolveLayout(scene([root('s', [0, 10, 0])], [gear('g', 's', 12, 4)]));
    expectVec(l.gears.g?.center, [0, 16, 0]);
    expect(l.gears.g?.pitchRadius).toBe(6);
    expect(l.gears.g?.basePhase).toBe(0);
    expect(l.gears.g?.axis).toBe('y');
    expect(l.shafts.s?.axis).toBe('y');
    expectVec(l.shafts.s?.span, [0, 12]);
  });

  it('歯車の無い起点 → span = [−10, 10]', () => {
    const l = resolveLayout(scene([root('s', [0, 0, 0])], []));
    expectVec(l.shafts.s?.span, [-10, 10]);
  });

  it('親子', () => {
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 20, 0]), meshShaft('s_B', 'g_A', 'g_B', Math.PI / 2)],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 24)],
      ),
    );
    expectVec(l.gears.g_A?.center, [0, 22, 0]);
    expectVec(l.shafts.s_B?.origin, [18, 20, 0]);
    expectVec(l.gears.g_B?.center, [18, 22, 0]);
    expect(l.gears.g_B?.pitchRadius).toBe(12);
    expect(samePhase(l.gears.g_B?.basePhase ?? Number.NaN, Math.PI / 24, 24)).toBe(true);
    expect(l.meshes).toEqual([{ a: 'g_A', b: 'g_B', source: 'tree' }]);
    expect(l.interferences).toEqual([]);
  });

  it('軸 x: 子のシャフトの向きは親から導く', () => {
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 0, 0], 'x'), meshShaft('s_B', 'g_A', 'g_B', 0)],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 24)],
      ),
    );
    expectVec(l.gears.g_A?.center, [2, 0, 0]);
    expectVec(l.gears.g_B?.center, [2, 18, 0]);
    expect(l.shafts.s_B?.axis).toBe('x');
    expect(l.gears.g_B?.axis).toBe('x');
  });

  it('軸 z', () => {
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 0, 0], 'z'), meshShaft('s_B', 'g_A', 'g_B', Math.PI / 2)],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 24)],
      ),
    );
    expectVec(l.gears.g_A?.center, [0, 0, 2]);
    expectVec(l.gears.g_B?.center, [0, 18, 2]);
    expect(l.shafts.s_B?.axis).toBe('z');
  });

  it('detached とその子', () => {
    const l = resolveLayout(
      scene(
        [detached('s_A', [30, 0, 0], 'z'), meshShaft('s_B', 'g_A', 'g_B', 0)],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 24)],
      ),
    );
    expectVec(l.gears.g_A?.center, [30, 0, 2]);
    expect(l.gears.g_A?.basePhase).toBe(0);
    expectVec(l.gears.g_B?.center, [48, 0, 2]);
    expect(l.shafts.s_B?.axis).toBe('z');
  });

  it('子の offset は 0 として親の面にそろう。子以外の歯車の位相は 0', () => {
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 20, 0]), meshShaft('s_B', 'g_A', 'g_B', Math.PI / 2)],
        [gear('g_A', 's_A', 12, 8), gear('g_B', 's_B', 24), gear('g_X', 's_B', 20, 4)],
      ),
    );
    expectVec(l.shafts.s_B?.origin, [18, 28, 0]);
    expectVec(l.gears.g_B?.center, [18, 30, 0]);
    expectVec(l.gears.g_X?.center, [18, 34, 0]);
    expect(l.gears.g_X?.basePhase).toBe(0);
  });

  it('根にたどり着かないシャフトと歯車は含めない（例外にしない）', () => {
    const l = resolveLayout(
      scene(
        [
          root('s_A', [0, 20, 0]),
          meshShaft('s_B', 'g_A', 'g_B', Math.PI / 2),
          meshShaft('s_Z', 'g_none', 'g_Z', 0),
        ],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 24), gear('g_Z', 's_Z', 12)],
      ),
    );
    expect(l.shafts.s_Z).toBeUndefined();
    expect(l.gears.g_Z).toBeUndefined();
    expect(l.meshes).toHaveLength(1);
  });
});

// 伝播: A（[0, 20, 0]、12 歯）→ B（24 歯、π/2。B には別の 24 歯 B2 も offset 4）→ C（B2 の子、12 歯、0）
function propagation(
  opts: { teethA?: number; angleB?: number; origin?: [number, number, number] } = {},
): Scene {
  return scene(
    [
      root('s_A', opts.origin ?? [0, 20, 0]),
      meshShaft('s_B', 'g_A', 'g_B', opts.angleB ?? Math.PI / 2),
      meshShaft('s_C', 'g_B2', 'g_C', 0),
    ],
    [
      gear('g_A', 's_A', opts.teethA ?? 12),
      gear('g_B', 's_B', 24),
      gear('g_B2', 's_B', 24, 4),
      gear('g_C', 's_C', 12),
    ],
  );
}

describe('resolveLayout: 伝播', () => {
  it('基本の形', () => {
    const l = resolveLayout(propagation());
    expectVec(l.gears.g_B?.center, [18, 22, 0]);
    expectVec(l.gears.g_B2?.center, [18, 26, 0]);
    expectVec(l.shafts.s_C?.origin, [18, 24, 18]);
    expectVec(l.gears.g_C?.center, [18, 26, 18]);
    expect(samePhase(l.gears.g_C?.basePhase ?? Number.NaN, Math.PI / 12, 12)).toBe(true);
    expectVec(l.shafts.s_B?.span, [-4, 12]);
    expect(l.interferences).toEqual([]);
  });

  it('A の歯数を 20 にする → その先が全部動く', () => {
    const l = resolveLayout(propagation({ teethA: 20 }));
    expectVec(l.gears.g_B?.center, [22, 22, 0]);
    expectVec(l.gears.g_C?.center, [22, 26, 18]);
  });

  it('B の angle を 0 にする → その先が全部動く', () => {
    const l = resolveLayout(propagation({ angleB: 0 }));
    expectVec(l.gears.g_B?.center, [0, 22, 18]);
    expectVec(l.gears.g_C?.center, [0, 26, 36]);
  });

  it('起点の origin を [100, 20, 0] にする → 全部が x に +100', () => {
    const base = resolveLayout(propagation());
    const moved = resolveLayout(propagation({ origin: [100, 20, 0] }));
    for (const id of ['g_A', 'g_B', 'g_B2', 'g_C']) {
      const c = base.gears[id]?.center ?? [Number.NaN, 0, 0];
      expectVec(moved.gears[id]?.center, [c[0] + 100, c[1], c[2]]);
    }
    for (const id of ['s_A', 's_B', 's_C']) {
      const o = base.shafts[id]?.origin ?? [Number.NaN, 0, 0];
      expectVec(moved.shafts[id]?.origin, [o[0] + 100, o[1], o[2]]);
    }
  });
});

// 四角形: A（原点）→ B（π/2）→ C（0）→ D（−π/2）。teethB で B の歯数を変える
function square(teethB = 12): Scene {
  return scene(
    [
      root('s_A', [0, 0, 0]),
      meshShaft('s_B', 'g_A', 'g_B', Math.PI / 2),
      meshShaft('s_C', 'g_B', 'g_C', 0),
      meshShaft('s_D', 'g_C', 'g_D', -Math.PI / 2),
    ],
    [
      gear('g_A', 's_A', 12),
      gear('g_B', 's_B', teethB),
      gear('g_C', 's_C', 12),
      gear('g_D', 's_D', 12),
    ],
  );
}

describe('resolveLayout: contact と干渉', () => {
  it('四角形 → A–D が contact、干渉なし', () => {
    const l = resolveLayout(square());
    expectVec(l.gears.g_A?.center, [0, 2, 0]);
    expectVec(l.gears.g_B?.center, [12, 2, 0]);
    expectVec(l.gears.g_C?.center, [12, 2, 12]);
    expectVec(l.gears.g_D?.center, [0, 2, 12]);
    expect(l.meshes).toContainEqual({ a: 'g_A', b: 'g_D', source: 'contact' });
    expect(l.meshes).toHaveLength(4);
    expect(l.interferences).toEqual([]);
  });

  it('正三角形 → 位相が合わなくても contact', () => {
    const l = resolveLayout(
      scene(
        [
          root('s_A', [0, 0, 0]),
          meshShaft('s_B', 'g_A', 'g_B', Math.PI / 2),
          meshShaft('s_C', 'g_B', 'g_C', -Math.PI / 6),
        ],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 12), gear('g_C', 's_C', 12)],
      ),
    );
    expectVec(l.gears.g_C?.center, [6, 2, 6 * S3]);
    expect(l.meshes).toEqual([
      { a: 'g_A', b: 'g_B', source: 'tree' },
      { a: 'g_A', b: 'g_C', source: 'contact' },
      { a: 'g_B', b: 'g_C', source: 'tree' },
    ]);
    expect(l.interferences).toEqual([]);
  });

  it('ループの辻褄: 四角形の B を 14 歯 → contact なし、A–D が干渉', () => {
    const l = resolveLayout(square(14));
    expectVec(l.gears.g_B?.center, [13, 2, 0]);
    expectVec(l.gears.g_C?.center, [13, 2, 13]);
    expectVec(l.gears.g_D?.center, [1, 2, 13]);
    expect(l.meshes.filter((m) => m.source === 'contact')).toEqual([]);
    expect(l.meshes).toHaveLength(3);
    expect(l.interferences).toContainEqual(['g_A', 'g_D']);
  });

  it('大きさが違う（S と M）→ 距離がちょうどでも contact にしない', () => {
    // S 12 歯（ピッチ円半径 6）と M 12 歯（12）を 18 離す
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 0, 0]), root('s_B', [18, 0, 0])],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 12, 0, 'M')],
      ),
    );
    expect(l.meshes).toEqual([]);
  });

  it('軸方向にずれて歯幅が重ならない（offset が 4 違う）→ contact にしない', () => {
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 0, 0]), root('s_B', [12, 0, 0])],
        [gear('g_A', 's_A', 12, 0), gear('g_B', 's_B', 12, 4)],
      ),
    );
    expect(l.meshes).toEqual([]);
  });

  it('軸の向きが違う → contact にしない', () => {
    // A は y 軸で中心 [0, 2, 0]。B は x 軸で中心 [0, 2, 12]（距離 12）
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 0, 0], 'y'), root('s_B', [-2, 2, 12], 'x')],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 12)],
      ),
    );
    expect(l.meshes).toEqual([]);
  });

  it('別々の根でも、ちょうどの距離なら contact', () => {
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 0, 0]), root('s_B', [12, 0, 0])],
        [gear('g_A', 's_A', 12), gear('g_B', 's_B', 12)],
      ),
    );
    expect(l.meshes).toEqual([{ a: 'g_A', b: 'g_B', source: 'contact' }]);
    expect(l.interferences).toEqual([]);
  });

  it('兄弟の干渉: 12 歯の親に 12 歯の子を 0 と π/6 で 2 本', () => {
    const l = resolveLayout(
      scene(
        [
          root('s_P', [0, 0, 0]),
          meshShaft('s_1', 'g_P', 'g_1', 0),
          meshShaft('s_2', 'g_P', 'g_2', Math.PI / 6),
        ],
        [gear('g_P', 's_P', 12), gear('g_1', 's_1', 12), gear('g_2', 's_2', 12)],
      ),
    );
    const c1 = l.gears.g_1?.center ?? [0, 0, 0];
    const c2 = l.gears.g_2?.center ?? [0, 0, 0];
    expect(Math.hypot(c1[0] - c2[0], c1[2] - c2[2])).toBeCloseTo(24 * Math.sin(Math.PI / 12), 9);
    expect(l.interferences).toContainEqual(['g_1', 'g_2']);
  });

  it('シャフトの干渉: A のシャフトの上端が E の歯車に入る → その 1 組だけ', () => {
    const l = resolveLayout(
      scene(
        [root('s_A', [0, 0, 0], 'y'), root('s_E', [-2, 12, 0], 'x')],
        [gear('g_A', 's_A', 12), gear('g_E', 's_E', 12)],
      ),
    );
    expectVec(l.shafts.s_A?.span, [-4, 8]);
    expectVec(l.gears.g_E?.center, [0, 12, 0]);
    expect(l.interferences).toEqual([['g_E', 's_A']]);
  });

  it('別の根のシャフトが歯車を貫く → その組（両方のシャフトが SHAFT_END_MARGIN だけ伸びる）', () => {
    // shaft_1 の span は [−4, 8]（y 16〜28）、shaft_2 は [−4, 16]（y 12〜32）。中心の間は 3 で、
    // どちらのシャフトも相手のシャフトの歯車（半径 7）を貫く
    const l = resolveLayout(
      scene(
        [root('shaft_1', [0, 20, 0]), root('shaft_2', [3, 16, 0])],
        [
          gear('gear_1', 'shaft_1', 12),
          gear('gear_2', 'shaft_2', 12, 0),
          gear('gear_3', 'shaft_2', 12, 8),
        ],
      ),
    );
    expect(l.interferences).toEqual([
      ['gear_1', 'shaft_2'],
      ['gear_2', 'shaft_1'],
      ['gear_3', 'shaft_1'],
    ]);
  });

  it('並び: meshes と interferences が辞書順、組の中も a < b', () => {
    // 親の ID が子より大きい木の辺、contact（四角形の a–z）、干渉（z の兄弟 m と b）を混ぜる
    const l = resolveLayout(
      scene(
        [
          root('s_9', [0, 0, 0]),
          meshShaft('s_5', 'g_z', 'g_m', Math.PI / 2),
          meshShaft('s_3', 'g_m', 'g_c', 0),
          meshShaft('s_1', 'g_c', 'g_a', -Math.PI / 2),
          meshShaft('s_7', 'g_z', 'g_b', Math.PI / 2 + Math.PI / 6),
        ],
        [
          gear('g_z', 's_9', 12),
          gear('g_m', 's_5', 12),
          gear('g_c', 's_3', 12),
          gear('g_a', 's_1', 12),
          gear('g_b', 's_7', 12),
        ],
      ),
    );
    expect(l.meshes).toContainEqual({ a: 'g_m', b: 'g_z', source: 'tree' });
    expect(l.meshes).toContainEqual({ a: 'g_a', b: 'g_z', source: 'contact' });
    expect(l.interferences.length).toBeGreaterThan(1);
    for (const m of l.meshes) expect(m.a < m.b).toBe(true);
    for (const [a, b] of l.interferences) expect(a < b).toBe(true);
    const meshPairs = l.meshes.map((m) => [m.a, m.b] as [string, string]);
    expect(meshPairs).toEqual([...meshPairs].sort(byPair));
    const pairs = l.interferences.map(([a, b]) => [a, b] as [string, string]);
    expect(pairs).toEqual([...pairs].sort(byPair));
  });
});

describe('resolveLayout: キャッシュ', () => {
  it('同じシーンのオブジェクト → 同じ参照、中身が同じ別のオブジェクト → 等しい値', () => {
    const s = propagation();
    const first = resolveLayout(s);
    expect(resolveLayout(s)).toBe(first);
    const other = resolveLayout(structuredClone(s));
    expect(other).not.toBe(first);
    expect(other).toEqual(first);
  });
});

describe('descendantShafts', () => {
  it('伝播のシーン', () => {
    const s = propagation();
    expect(descendantShafts(s, 's_A')).toEqual(['s_A', 's_B', 's_C']);
    expect(descendantShafts(s, 's_B')).toEqual(['s_B', 's_C']);
    expect(descendantShafts(s, 's_C')).toEqual(['s_C']);
  });

  it('幅優先: 浅いものが先', () => {
    // A → B → D、A → C
    const t = scene(
      [
        root('s_A', [0, 0, 0]),
        meshShaft('s_B', 'g_A', 'g_B', 0),
        meshShaft('s_D', 'g_B', 'g_D', 0),
        meshShaft('s_C', 'g_A', 'g_C', Math.PI),
      ],
      [
        gear('g_A', 's_A', 12),
        gear('g_B', 's_B', 12),
        gear('g_D', 's_D', 12),
        gear('g_C', 's_C', 12),
      ],
    );
    expect(descendantShafts(t, 's_A')).toEqual(['s_A', 's_B', 's_C', 's_D']);
  });

  it('シーンに無いシャフト → 空', () => {
    expect(descendantShafts(propagation(), 's_none')).toEqual([]);
  });
});
