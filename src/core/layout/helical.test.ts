import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../edit/commands';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import type { Vec3 } from '../math/vec3';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Gear, Hand, Scene } from '../scene/types';
import { validateScene } from '../scene/validate';
import { type GrowCandidate, listGrowCandidates } from './candidates';
import { resolveLayout } from './resolve';

// ハスバ歯車の配置・候補・かみ合い・運動（S2-01）

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

const helicalPair = fixture('helical-pair');

function distance(a: Vec3 | undefined, b: Vec3 | undefined): number {
  if (a === undefined || b === undefined) throw new Error('中心が無い');
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// helical-pair の A だけを残し、A から距離 60（+x）に木の親子でない起点のシャフトと歯車 C を置く
function withNeighbor(c: Pick<Gear, 'kind'> & { hand?: Hand; teeth?: number }): Scene {
  const base = {
    id: 'gear_c',
    shaftId: 'shaft_c',
    size: 'M',
    teeth: c.teeth ?? 40,
    offset: 0,
  } as const;
  const gearC: Gear =
    c.kind === 'helical'
      ? { ...base, kind: 'helical', hand: c.hand ?? 'left' }
      : { ...base, kind: 'spur' };
  return {
    shafts: {
      shaft_a: helicalPair.shafts.shaft_a as Scene['shafts'][string],
      shaft_c: { id: 'shaft_c', placement: { kind: 'root', origin: [60, 35, 0], axis: 'y' } },
    },
    gears: { gear_a: helicalPair.gears.gear_a as Gear, gear_c: gearC },
    motors: {},
    anchors: {},
    carriers: {},
    racks: {},
  };
}

describe('helical-pair', () => {
  it('検証を通る', () => {
    expect(validateScene(helicalPair)).toEqual({ ok: true });
  });

  it('resolveLayout: B の中心が A の中心から 60（20 + 40）、tree の helical のかみ合い、干渉なし', () => {
    const layout = resolveLayout(helicalPair);
    expect(distance(layout.gears.gear_a?.center, layout.gears.gear_b?.center)).toBeCloseTo(60, 9);
    expect(layout.meshes).toEqual([{ a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'helical' }]);
    expect(layout.interferences).toEqual([]);
  });

  it('運動: A が 60 rpm（2π rad/s）→ B は −π rad/s', () => {
    const motion = solveMotion(helicalPair, resolveLayout(helicalPair), initialMotionState());
    expect(motion.omegas.shaft_a).toBeCloseTo(2 * Math.PI, 9);
    expect(motion.omegas.shaft_b).toBeCloseTo(-Math.PI, 9);
  });
});

describe('偶然のかみ合い（contact）', () => {
  it("A と距離 60 の 'left' のハスバ（木の親子ではない）→ contact の helical のかみ合い", () => {
    const layout = resolveLayout(withNeighbor({ kind: 'helical', hand: 'left' }));
    expect(layout.meshes).toEqual([
      { a: 'gear_a', b: 'gear_c', source: 'contact', kind: 'helical' },
    ]);
    expect(layout.interferences).toEqual([]);
  });

  it("同じ位置に 'right' のハスバ → かみ合いでなく、干渉", () => {
    const layout = resolveLayout(withNeighbor({ kind: 'helical', hand: 'right' }));
    expect(layout.meshes).toEqual([]);
    expect(layout.interferences).toContainEqual(['gear_a', 'gear_c']);
  });

  it('同じ位置に平歯車 → かみ合いでなく、干渉', () => {
    const layout = resolveLayout(withNeighbor({ kind: 'spur' }));
    expect(layout.meshes).toEqual([]);
    expect(layout.interferences).toContainEqual(['gear_a', 'gear_c']);
  });
});

describe('三角形', () => {
  it('中・20 歯のハスバ 3 枚を互いにちょうどの距離（40）に置くと、どの向きの組み合わせでも 3 組ともかみ合いにはならない', () => {
    const hands: Hand[] = ['right', 'left'];
    const origins: Vec3[] = [
      [0, 35, 0],
      [40, 35, 0],
      [20, 35, 20 * Math.sqrt(3)],
    ];
    for (const h1 of hands) {
      for (const h2 of hands) {
        for (const h3 of hands) {
          const ids = ['1', '2', '3'];
          const handsOf = [h1, h2, h3];
          const scene: Scene = {
            shafts: Object.fromEntries(
              ids.map((k, i) => [
                `shaft_${k}`,
                {
                  id: `shaft_${k}`,
                  placement: { kind: 'root', origin: origins[i] as Vec3, axis: 'y' },
                },
              ]),
            ),
            gears: Object.fromEntries(
              ids.map((k, i) => [
                `gear_${k}`,
                {
                  id: `gear_${k}`,
                  kind: 'helical',
                  hand: handsOf[i] as Hand,
                  shaftId: `shaft_${k}`,
                  size: 'M',
                  teeth: 20,
                  offset: 0,
                },
              ]),
            ),
            motors: {},
            anchors: {},
            carriers: {},
            racks: {},
          };
          const layout = resolveLayout(scene);
          expect(layout.meshes.length).toBeLessThan(3);
          // かみ合わない組はちょうどの距離で歯先円が重なるので干渉
          expect(layout.meshes.length + layout.interferences.length).toBe(3);
        }
      }
    }
  });
});

describe('候補（S1-10 の拡張）', () => {
  const spec = { perimeterTeeth: 20, coaxialSize: 'M', coaxialTeeth: 20 } as const;
  // helical-pair の A だけ（B を除く）
  const onlyA: Scene = {
    shafts: { shaft_a: helicalPair.shafts.shaft_a as Scene['shafts'][string] },
    gears: { gear_a: helicalPair.gears.gear_a as Gear },
    motors: {},
    anchors: {},
    carriers: {},
    racks: {},
  };
  const perimeters = (list: readonly GrowCandidate[]) =>
    list.filter((c): c is Extract<GrowCandidate, { kind: 'perimeter' }> => c.kind === 'perimeter');
  const coaxials = (list: readonly GrowCandidate[]) =>
    list.filter((c): c is Extract<GrowCandidate, { kind: 'coaxial' }> => c.kind === 'coaxial');

  it("中・20 歯 'right' の A の外周の候補は、すべて helical・'left'・大きさ M", () => {
    const list = perimeters(listGrowCandidates(onlyA, 'gear_a', { ...spec, kind: 'helical' }));
    expect(list).toHaveLength(8);
    for (const c of list) {
      expect(c.shape).toEqual({ kind: 'helical', hand: 'left' });
      expect(c.size).toBe('M');
    }
  });

  it('外周の候補の growGear で、逆向きのねじれの子がかみ合う位置に置かれる', () => {
    const [first] = perimeters(listGrowCandidates(onlyA, 'gear_a', { ...spec, kind: 'helical' }));
    if (first === undefined) throw new Error('候補が無い');
    const result = applyCommand(
      onlyA,
      {
        type: 'growGear',
        mode: 'perimeter',
        parentGearId: 'gear_a',
        angle: first.angle,
        teeth: first.teeth,
      },
      { ids: createSequentialIdGenerator() },
    );
    if (!result.ok) throw new Error(result.error.message);
    const childId = result.created[1] as string;
    expect(result.scene.gears[childId]).toMatchObject({ kind: 'helical', hand: 'left', size: 'M' });
    const layout = resolveLayout(result.scene);
    const [a, b] = childId < 'gear_a' ? [childId, 'gear_a'] : ['gear_a', childId];
    expect(layout.meshes).toEqual([{ a, b, source: 'tree', kind: 'helical' }]);
    expect(layout.interferences).toEqual([]);
  });

  it("同じ軸の候補で種類 'helical' を渡すと hand 'right' の歯車になる", () => {
    const list = coaxials(listGrowCandidates(onlyA, 'gear_a', { ...spec, kind: 'helical' }));
    expect(list).toHaveLength(2);
    for (const c of list) expect(c.shape).toEqual({ kind: 'helical', hand: 'right' });
    const first = list[0];
    if (first === undefined) throw new Error('候補が無い');
    const result = applyCommand(
      onlyA,
      {
        type: 'growGear',
        mode: 'coaxial',
        shaftId: first.shaftId,
        offset: first.offset,
        size: first.size,
        teeth: first.teeth,
        kind: first.shape.kind,
      },
      { ids: createSequentialIdGenerator() },
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.scene.gears[result.created[0] as string]).toMatchObject({
      kind: 'helical',
      hand: 'right',
    });
  });

  it("同じ軸の候補で種類 'spur' を渡すと平歯車（段階 1 と同じ）", () => {
    const list = coaxials(listGrowCandidates(onlyA, 'gear_a', { ...spec, kind: 'spur' }));
    for (const c of list) expect(c.shape).toEqual({ kind: 'spur' });
  });

  it('平歯車の外周の候補は平歯車のまま', () => {
    const spurOnly: Scene = {
      ...onlyA,
      gears: {
        gear_a: {
          id: 'gear_a',
          kind: 'spur',
          shaftId: 'shaft_a',
          size: 'M',
          teeth: 20,
          offset: 0,
        },
      },
    };
    const list = perimeters(listGrowCandidates(spurOnly, 'gear_a', { ...spec, kind: 'spur' }));
    expect(list).toHaveLength(8);
    for (const c of list) expect(c.shape).toEqual({ kind: 'spur' });
  });

  it('平歯車とハスバ歯車は外周の候補で結ばれない: 平歯車の外周の、ハスバ歯車とちょうどの距離の候補は干渉で出ない', () => {
    // A（ハスバ 'right'）から +x に 80 離れた平歯車 P（中・20 歯）。P の外周の angle 3π/2（軸 'y' の v = +X の逆向き）の候補は、
    // A からちょうど 40 の位置（平歯車の子）になるが、ハスバ歯車とはかみ合わないので干渉で消える
    const scene: Scene = {
      shafts: {
        ...onlyA.shafts,
        shaft_p: { id: 'shaft_p', placement: { kind: 'root', origin: [80, 35, 0], axis: 'y' } },
      },
      gears: {
        ...onlyA.gears,
        gear_p: { id: 'gear_p', kind: 'spur', shaftId: 'shaft_p', size: 'M', teeth: 20, offset: 0 },
      },
      motors: {},
      anchors: {},
      carriers: {},
      racks: {},
    };
    const angles = perimeters(listGrowCandidates(scene, 'gear_p', { ...spec, kind: 'spur' })).map(
      (c) => Math.round(c.angle / (Math.PI / 4)),
    );
    expect(angles).not.toContain(6);
    expect(angles).toHaveLength(7);
    // A が平歯車なら、同じ候補は contact でかみ合うので出る（段階 1 と同じ）
    const spurA: Scene = {
      ...scene,
      gears: { ...scene.gears, gear_a: { ...(scene.gears.gear_a as Gear), kind: 'spur' } as Gear },
    };
    const spurAngles = perimeters(
      listGrowCandidates(spurA, 'gear_p', { ...spec, kind: 'spur' }),
    ).map((c) => Math.round(c.angle / (Math.PI / 4)));
    expect(spurAngles).toContain(6);
  });
});
