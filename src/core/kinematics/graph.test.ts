import { describe, expect, it } from 'vitest';
import type { Mesh } from '../layout/types';
import type { Gear, Scene, Shaft, ShaftId } from '../scene/types';
import { buildMeshGraph, type KinematicComponent, type MeshGraph, speedRatio } from './graph';

// テストのシーン。歯車はすべて大きさ S。shafts の root に挙げたシャフトだけを root、他は mesh にする
// （mesh の親子の参照はこのモジュールでは使わないので、形だけ埋める）
function makeScene(
  shaftIds: readonly ShaftId[],
  gears: ReadonlyArray<readonly [id: string, shaftId: ShaftId, teeth: number]>,
  roots: readonly ShaftId[] = [shaftIds[0] as ShaftId],
): Scene {
  const shafts: Record<string, Shaft> = {};
  for (const id of shaftIds) {
    shafts[id] = roots.includes(id)
      ? { id, placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } }
      : {
          id,
          placement: {
            kind: 'mesh',
            parentGearId: 'gear_parent',
            childGearId: 'gear_child',
            angle: 0,
          },
        };
  }
  const gearMap: Record<string, Gear> = {};
  for (const [id, shaftId, teeth] of gears) {
    gearMap[id] = { id, kind: 'spur', shaftId, size: 'S', teeth, offset: 0 };
  }
  return { shafts, gears: gearMap, motors: {} };
}

function tree(a: string, b: string): Mesh {
  return { a, b, source: 'tree', kind: 'spur' };
}

function only(graph: MeshGraph): KinematicComponent {
  expect(graph.components).toHaveLength(1);
  return graph.components[0] as KinematicComponent;
}

function rowOf(component: KinematicComponent, shaftId: ShaftId): number[] {
  const i = component.shaftIds.indexOf(shaftId);
  expect(i).toBeGreaterThanOrEqual(0);
  return component.basis[i] as number[];
}

const A = 'shaft_a';
const B = 'shaft_b';
const C = 'shaft_c';
const D = 'shaft_d';
const E = 'shaft_e';

describe('buildMeshGraph', () => {
  it('歯車の無いシャフト 1 本', () => {
    const graph = buildMeshGraph(makeScene([A], []), []);
    const c = only(graph);
    expect(c.shaftIds).toEqual([A]);
    expect(c.gearIds).toEqual([]);
    expect(c.meshes).toEqual([]);
    expect(c.basis).toEqual([[1]]);
    expect(c.dof).toBe(1);
    expect(c.referenceShaftIds).toEqual([A]);
    expect(graph.componentOfShaft).toEqual({ [A]: 0 });
  });

  const twoSpurGears = [
    ['gear_a', A, 12],
    ['gear_b', B, 24],
  ] as const;

  it('A(12)–B(24)', () => {
    const graph = buildMeshGraph(makeScene([A, B], twoSpurGears), [tree('gear_a', 'gear_b')]);
    const c = only(graph);
    expect(c.shaftIds).toEqual([A, B]);
    expect(c.gearIds).toEqual(['gear_a', 'gear_b']);
    expect(c.dof).toBe(1);
    expect(c.referenceShaftIds).toEqual([A]);
    expect(rowOf(c, A)).toEqual([1]);
    expect(rowOf(c, B)[0]).toBeCloseTo(-0.5, 12);
    expect(speedRatio(graph, A, B)).toBeCloseTo(-0.5, 12);
    expect(speedRatio(graph, B, A)).toBeCloseTo(-2, 12);
  });

  it('基準シャフトは root を優先する: B だけが root', () => {
    const graph = buildMeshGraph(makeScene([A, B], twoSpurGears, [B]), [tree('gear_a', 'gear_b')]);
    const c = only(graph);
    expect(c.referenceShaftIds).toEqual([B]);
    expect(rowOf(c, B)).toEqual([1]);
    expect(rowOf(c, A)[0]).toBeCloseTo(-2, 12);
  });

  it('detached も root と同じく優先する', () => {
    const scene = makeScene([A, B], twoSpurGears);
    const detached: Scene = {
      ...scene,
      shafts: {
        [A]: {
          id: A,
          placement: { kind: 'mesh', parentGearId: 'gear_x', childGearId: 'gear_a', angle: 0 },
        },
        [B]: { id: B, placement: { kind: 'detached', origin: [0, 0, 0], axis: 'y' } },
      },
    };
    const c = only(buildMeshGraph(detached, [tree('gear_a', 'gear_b')]));
    expect(c.referenceShaftIds).toEqual([B]);
  });

  it('歯車列: A(12)–B(24)、B(12)–C(36)', () => {
    const scene = makeScene(
      [A, B, C],
      [
        ['gear_a', A, 12],
        ['gear_b1', B, 24],
        ['gear_b2', B, 12],
        ['gear_c', C, 36],
      ],
    );
    const graph = buildMeshGraph(scene, [tree('gear_a', 'gear_b1'), tree('gear_b2', 'gear_c')]);
    expect(only(graph).dof).toBe(1);
    expect(speedRatio(graph, A, C)).toBeCloseTo((-12 / 24) * (-12 / 36), 12);
    expect(speedRatio(graph, A, C)).toBeCloseTo(1 / 6, 12);
  });

  const triangleScene = makeScene(
    [A, B, C],
    [
      ['gear_a', A, 12],
      ['gear_b', B, 12],
      ['gear_c', C, 12],
    ],
  );

  it('正三角形（contact の辺で閉じる）は矛盾', () => {
    const graph = buildMeshGraph(triangleScene, [
      tree('gear_a', 'gear_b'),
      tree('gear_b', 'gear_c'),
      { a: 'gear_a', b: 'gear_c', source: 'contact', kind: 'spur' },
    ]);
    const c = only(graph);
    expect(c.dof).toBe(0);
    expect(c.basis).toEqual([[], [], []]);
    expect(c.referenceShaftIds).toEqual([]);
    expect(c.meshes).toHaveLength(3);
    expect(speedRatio(graph, A, B)).toBeNull();
  });

  it('同じ三角形から contact の辺を除くと自由度 1', () => {
    const graph = buildMeshGraph(triangleScene, [
      tree('gear_a', 'gear_b'),
      tree('gear_b', 'gear_c'),
    ]);
    expect(only(graph).dof).toBe(1);
  });

  it('四角形は自由度 1、行が 1, −1, 1, −1', () => {
    const scene = makeScene(
      [A, B, C, D],
      [
        ['gear_a', A, 12],
        ['gear_b', B, 12],
        ['gear_c', C, 12],
        ['gear_d', D, 12],
      ],
    );
    const graph = buildMeshGraph(scene, [
      tree('gear_a', 'gear_b'),
      tree('gear_b', 'gear_c'),
      tree('gear_c', 'gear_d'),
      { a: 'gear_d', b: 'gear_a', source: 'contact', kind: 'spur' },
    ]);
    const c = only(graph);
    expect(c.dof).toBe(1);
    const expected = [1, -1, 1, -1];
    c.basis.forEach((row, i) => {
      expect(row[0]).toBeCloseTo(expected[i] as number, 12);
    });
  });

  it('多重辺（比が食い違う）は矛盾', () => {
    const scene = makeScene(
      [A, B],
      [
        ['gear_a12', A, 12],
        ['gear_a24', A, 24],
        ['gear_b12', B, 12],
        ['gear_b24', B, 24],
      ],
    );
    const graph = buildMeshGraph(scene, [
      tree('gear_a12', 'gear_b24'),
      { a: 'gear_a24', b: 'gear_b12', source: 'contact', kind: 'spur' },
    ]);
    expect(only(graph).dof).toBe(0);
  });

  it('多重辺（比が整合）は自由度 1', () => {
    const scene = makeScene(
      [A, B],
      [
        ['gear_a1', A, 12],
        ['gear_a2', A, 12],
        ['gear_b1', B, 24],
        ['gear_b2', B, 24],
      ],
    );
    const graph = buildMeshGraph(scene, [
      tree('gear_a1', 'gear_b1'),
      { a: 'gear_a2', b: 'gear_b2', source: 'contact', kind: 'spur' },
    ]);
    expect(only(graph).dof).toBe(1);
    expect(speedRatio(graph, A, B)).toBeCloseTo(-0.5, 12);
  });

  it('非連結: A–B、C–D、歯車の無い E', () => {
    const scene = makeScene(
      [A, B, C, D, E],
      [
        ['gear_a', A, 12],
        ['gear_b', B, 24],
        ['gear_c', C, 12],
        ['gear_d', D, 12],
      ],
      [A, C, E],
    );
    const graph = buildMeshGraph(scene, [tree('gear_a', 'gear_b'), tree('gear_c', 'gear_d')]);
    expect(graph.components.map((c) => c.shaftIds)).toEqual([[A, B], [C, D], [E]]);
    expect(graph.components.map((c) => c.dof)).toEqual([1, 1, 1]);
    expect(graph.components.map((c) => c.gearIds)).toEqual([
      ['gear_a', 'gear_b'],
      ['gear_c', 'gear_d'],
      [],
    ]);
    expect(graph.componentOfShaft).toEqual({ [A]: 0, [B]: 0, [C]: 1, [D]: 1, [E]: 2 });
    expect(speedRatio(graph, A, C)).toBeNull();
    expect(speedRatio(graph, C, D)).toBeCloseTo(-1, 12);
  });

  it('長い減速の列（10 本、9 組）', () => {
    const shaftIds = Array.from({ length: 10 }, (_, i) => `shaft_${i}`);
    const gears: Array<readonly [string, ShaftId, number]> = [];
    const meshes: Mesh[] = [];
    shaftIds.forEach((shaftId, i) => {
      if (i > 0) gears.push([`gear_${i}_in`, shaftId, 80]);
      if (i < 9) gears.push([`gear_${i}_out`, shaftId, 12]);
      if (i > 0) meshes.push(tree(`gear_${i - 1}_out`, `gear_${i}_in`));
    });
    const graph = buildMeshGraph(makeScene(shaftIds, gears), meshes);
    expect(only(graph).dof).toBe(1);
    const ratio = speedRatio(graph, 'shaft_0', 'shaft_9');
    const expected = (-12 / 80) ** 9;
    expect(expected).toBeCloseTo(-3.8443e-8, 12);
    expect(ratio).not.toBeNull();
    expect(Math.abs(((ratio as number) - expected) / expected)).toBeLessThan(1e-9);
  });

  it('同じ入力なら結果が完全に一致する', () => {
    const scene = makeScene(
      [A, B, C, D, E],
      [
        ['gear_e', E, 12],
        ['gear_d', D, 12],
        ['gear_a', A, 12],
        ['gear_b', B, 24],
        ['gear_c', C, 36],
      ],
      [C],
    );
    const meshes = [tree('gear_e', 'gear_d'), tree('gear_c', 'gear_b'), tree('gear_a', 'gear_b')];
    const first = buildMeshGraph(scene, meshes);
    const second = buildMeshGraph(scene, meshes);
    expect(second).toEqual(first);
    expect(first.components.map((c) => c.shaftIds)).toEqual([
      [A, B, C],
      [D, E],
    ]);
    expect(first.components[0]?.referenceShaftIds).toEqual([C]);
  });

  it('シーンに無い歯車や、同じシャフトの歯車どうしの組は例外', () => {
    const scene = makeScene(
      [A, B],
      [
        ['gear_a1', A, 12],
        ['gear_a2', A, 24],
        ['gear_b', B, 12],
      ],
    );
    expect(() => buildMeshGraph(scene, [tree('gear_a1', 'gear_x')])).toThrow();
    expect(() => buildMeshGraph(scene, [tree('gear_a1', 'gear_a2')])).toThrow();
  });
});

describe('speedRatio', () => {
  it('グラフに無いシャフトは null', () => {
    const graph = buildMeshGraph(makeScene([A], []), []);
    expect(speedRatio(graph, A, 'shaft_none')).toBeNull();
    expect(speedRatio(graph, A, A)).toBe(1);
  });
});
