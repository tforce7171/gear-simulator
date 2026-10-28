import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../edit/commands';
import { emptyHistory, execute, undo } from '../edit/history';
import {
  angleAroundAxis,
  bevelApexOf,
  bevelBigEndOf,
  bevelContactPoint,
  bevelToothWidth,
  toothFraction,
} from '../geometry/bevel';
import { buildMeshGraph } from '../kinematics/graph';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import { sub, type Vec3 } from '../math/vec3';
import { createSequentialIdGenerator } from '../scene/ids';
import type { BevelGear, Gear, Scene, Shaft } from '../scene/types';
import { validateScene } from '../scene/validate';
import { listGrowCandidates } from './candidates';
import { resolveAddition, resolveLayout } from './resolve';
import type { Layout } from './types';

// かさ歯車の配置・候補・かみ合い・干渉・運動（S2-02）

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

const bevelPair = fixture('bevel-pair');

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  if (actual === undefined) throw new Error('値が無い');
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i] as number, 9);
}

function bevel(scene: Scene, id: string): BevelGear {
  const gear = scene.gears[id];
  if (gear?.kind !== 'bevel') throw new Error(`${id} はかさ歯車でない`);
  return gear;
}

function bigEnd(scene: Scene, layout: Layout, id: string): Vec3 {
  const g = layout.gears[id];
  if (g === undefined) throw new Error(`${id} のレイアウトが無い`);
  return bevelBigEndOf(g.center, g.axis, bevel(scene, id));
}

function apexPoint(scene: Scene, layout: Layout, id: string): Vec3 {
  const g = layout.gears[id];
  if (g === undefined) throw new Error(`${id} のレイアウトが無い`);
  return bevelApexOf(g.center, g.axis, bevel(scene, id));
}

function apply(scene: Scene, command: Command, ids = createSequentialIdGenerator()): Scene {
  const result = applyCommand(scene, command, { ids });
  if (!result.ok) throw new Error(`${command.type}: ${result.error.message}`);
  return result.scene;
}

function withShaftB(scene: Scene, patch: Partial<{ axisStep: 1 | 2; side: 1 | -1 }>): Scene {
  const shaft = scene.shafts.shaft_b;
  if (shaft?.placement.kind !== 'bevel') throw new Error('shaft_b が bevel でない');
  const placement = { ...shaft.placement, ...patch };
  const b = bevel(scene, 'gear_b');
  return {
    ...scene,
    shafts: { ...scene.shafts, shaft_b: { ...shaft, placement } },
    gears: { ...scene.gears, gear_b: { ...b, apex: placement.side === 1 ? -1 : 1 } },
  };
}

function withApexA(scene: Scene, apex: 1 | -1): Scene {
  return { ...scene, gears: { ...scene.gears, gear_a: { ...bevel(scene, 'gear_a'), apex } } };
}

function omegas(scene: Scene): Record<string, number> {
  return solveMotion(scene, resolveLayout(scene), initialMotionState()).omegas;
}

describe('bevel-pair の配置', () => {
  it('検証を通る', () => {
    expect(validateScene(bevelPair)).toEqual({ ok: true });
  });

  it('resolveLayout: 大端の中心・頂点・B のシャフト・かみ合い・干渉なし', () => {
    const layout = resolveLayout(bevelPair);
    expectVec(layout.gears.gear_a?.center, [0, 39, 0]);
    expectVec(bigEnd(bevelPair, layout, 'gear_a'), [0, 35, 0]);
    expectVec(apexPoint(bevelPair, layout, 'gear_a'), [0, 55, 0]);
    expect(layout.shafts.shaft_b?.axis).toBe('x');
    expectVec(layout.shafts.shaft_b?.origin, [-20, 55, 0]);
    expectVec(bigEnd(bevelPair, layout, 'gear_b'), [-20, 55, 0]);
    expectVec(layout.gears.gear_b?.center, [-16, 55, 0]);
    expectVec(apexPoint(bevelPair, layout, 'gear_b'), [0, 55, 0]);
    expect(layout.meshes).toEqual([{ a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'bevel' }]);
    expect(layout.interferences).toEqual([]);
  });

  it('side: 1 → B の大端の中心 [20, 55, 0]、B は apex −1、シャフトの原点 [12, 55, 0]', () => {
    const scene = withShaftB(bevelPair, { side: 1 });
    expect(validateScene(scene)).toEqual({ ok: true });
    expect(bevel(scene, 'gear_b').apex).toBe(-1);
    const layout = resolveLayout(scene);
    expectVec(bigEnd(scene, layout, 'gear_b'), [20, 55, 0]);
    expectVec(layout.shafts.shaft_b?.origin, [12, 55, 0]);
    expectVec(apexPoint(scene, layout, 'gear_b'), [0, 55, 0]);
    expect(layout.interferences).toEqual([]);
  });

  it('A の apex を −1 に反転（コマンド）→ A の大端の中心 [0, 43, 0]、頂点 [0, 23, 0]、B の大端の中心 [-20, 23, 0]', () => {
    const scene = apply(bevelPair, { type: 'flipBevelApex', gearId: 'gear_a' });
    expect(bevel(scene, 'gear_a').apex).toBe(-1);
    expect(bevel(scene, 'gear_b').apex).toBe(1); // 子の apex は −side のまま
    const layout = resolveLayout(scene);
    expectVec(bigEnd(scene, layout, 'gear_a'), [0, 43, 0]);
    expectVec(apexPoint(scene, layout, 'gear_a'), [0, 23, 0]);
    expectVec(bigEnd(scene, layout, 'gear_b'), [-20, 23, 0]);
    expectVec(apexPoint(scene, layout, 'gear_b'), [0, 23, 0]);
  });

  it("親の向きの変更: A のシャフトの軸を 'x' に → B のシャフトの軸は 'z'、頂点は一致したまま", () => {
    const scene = apply(bevelPair, { type: 'setShaftAxis', shaftId: 'shaft_a', axis: 'x' });
    const layout = resolveLayout(scene);
    expect(layout.shafts.shaft_a?.axis).toBe('x');
    expect(layout.shafts.shaft_b?.axis).toBe('z');
    expectVec(apexPoint(scene, layout, 'gear_b'), apexPoint(scene, layout, 'gear_a'));
    expect(layout.meshes).toEqual([{ a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'bevel' }]);
  });
});

describe('運動', () => {
  it('A が 2π rad/s: side −1 → B は −2π、side 1 → +2π、A の apex −1・side −1 → +2π', () => {
    expect(omegas(bevelPair).shaft_a).toBeCloseTo(2 * Math.PI, 9);
    expect(omegas(bevelPair).shaft_b).toBeCloseTo(-2 * Math.PI, 9);
    expect(omegas(withShaftB(bevelPair, { side: 1 })).shaft_b).toBeCloseTo(2 * Math.PI, 9);
    expect(omegas(withApexA(bevelPair, -1)).shaft_b).toBeCloseTo(2 * Math.PI, 9);
  });

  it("axisStep 1（シャフトの軸 'z'）、side −1 の子（大端の中心 [0, 55, -20]）→ −2π rad/s", () => {
    const scene = withShaftB(bevelPair, { axisStep: 1 });
    const layout = resolveLayout(scene);
    expect(layout.shafts.shaft_b?.axis).toBe('z');
    expectVec(bigEnd(scene, layout, 'gear_b'), [0, 55, -20]);
    expect(omegas(scene).shaft_b).toBeCloseTo(-2 * Math.PI, 9);
  });
});

describe('位相', () => {
  // 接点 P での歯の位置（歯 1 ピッチを 1 とした端数）。回転角は basePhase + シャフトの角度
  function fractionsAtContact(scene: Scene, thetaA: number, thetaB: number): [number, number] {
    const layout = resolveLayout(scene);
    const a = layout.gears.gear_a;
    const b = layout.gears.gear_b;
    if (a === undefined || b === undefined) throw new Error('レイアウトが無い');
    const endA = bigEnd(scene, layout, 'gear_a');
    const endB = bigEnd(scene, layout, 'gear_b');
    const p = bevelContactPoint({ bigEnd: endA }, { axis: b.axis, bigEnd: endB });
    const z = bevel(scene, 'gear_a').teeth;
    return [
      toothFraction(a.basePhase + thetaA, z, angleAroundAxis(a.axis, sub(p, endA))),
      toothFraction(b.basePhase + thetaB, z, angleAroundAxis(b.axis, sub(p, endB))),
    ];
  }

  it('bevel-pair: 接点 P で A の歯の位置が 0 のとき、B は 0.5', () => {
    const [fA, fB] = fractionsAtContact(bevelPair, 0, 0);
    expect(Math.min(fA, 1 - fA)).toBeCloseTo(0, 9);
    expect(fB).toBeCloseTo(0.5, 9);
  });

  it('回しても（ω の比のとおりに角度を進めても）A の歯の中心と B の歯溝の中心が P で重なったまま', () => {
    for (const scene of [
      bevelPair,
      withShaftB(bevelPair, { side: 1 }),
      withApexA(bevelPair, -1),
      withShaftB(bevelPair, { axisStep: 1 }),
    ]) {
      const w = omegas(scene);
      const ratio = (w.shaft_b ?? 0) / (w.shaft_a ?? 1);
      for (const thetaA of [0, 0.1, 0.77, 2]) {
        const [fA, fB] = fractionsAtContact(scene, thetaA, ratio * thetaA);
        // P で 2 枚が同じ向きに動く（ω の比が +1）なら歯の並ぶ向きも同じで fB = fA + 1/2、
        // 逆向き（比が −1）なら fB = 1/2 − fA（1 を法として）
        const gap = ratio > 0 ? fB - fA - 0.5 : fB + fA - 0.5;
        const wrapped = gap - Math.round(gap);
        expect(Math.abs(wrapped)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('3 方向で閉じる', () => {
  it('A（縦）→ B（横 X）→ B のシャフトに C → C から軸 z の D: 縦・X・Z のシャフトがそろい、干渉なし', () => {
    const ids = createSequentialIdGenerator();
    let scene = apply(
      bevelPair,
      {
        type: 'growGear',
        mode: 'coaxial',
        shaftId: 'shaft_b',
        offset: -24,
        size: 'M',
        teeth: 20,
        kind: 'bevel',
      },
      ids,
    );
    const c = Object.keys(scene.gears).find((id) => bevelPair.gears[id] === undefined) as string;
    scene = apply(scene, { type: 'flipBevelApex', gearId: c }, ids);
    const before = new Set(Object.keys(scene.shafts));
    scene = apply(
      scene,
      {
        type: 'growGear',
        mode: 'bevel',
        parentGearId: c,
        axisStep: 2,
        side: 1,
      },
      ids,
    );
    expect(validateScene(scene)).toEqual({ ok: true });
    const shaftD = Object.keys(scene.shafts).find((id) => !before.has(id)) as string;
    const layout = resolveLayout(scene);
    expect(layout.shafts[shaftD]?.axis).toBe('z');
    expect(new Set(Object.values(layout.shafts).map((s) => s.axis))).toEqual(
      new Set(['x', 'y', 'z']),
    );
    expect(layout.interferences).toEqual([]);
    expect(layout.meshes.filter((m) => m.kind === 'bevel')).toHaveLength(2);
    // D のシャフトも A と同じ速さで回る（|ω| = 2π）
    expect(Math.abs(omegas(scene)[shaftD] ?? 0)).toBeCloseTo(2 * Math.PI, 9);
  });
});

// 縦・X・Z の 3 本のシャフトのかさ歯車（中・20 歯）が頂点 [0, 55, 0] を共有する。
// A（縦）の子に B（X、axisStep 2、side −1）と C（Z、axisStep 1、side −1）。B と C は木の親子でない
function triangle(withMotor: boolean): Scene {
  const c: Shaft = {
    id: 'shaft_c',
    placement: {
      kind: 'bevel',
      parentGearId: 'gear_a',
      childGearId: 'gear_c',
      axisStep: 1,
      side: -1,
    },
  };
  const gearC: Gear = { ...bevel(bevelPair, 'gear_b'), id: 'gear_c', shaftId: 'shaft_c' };
  return {
    shafts: { ...bevelPair.shafts, shaft_c: c },
    gears: { ...bevelPair.gears, gear_c: gearC },
    motors: withMotor ? bevelPair.motors : {},
    anchors: {},
  };
}

describe('三角形のロック', () => {
  it('3 組とも互いにかみ合い（1 組は contact）、零空間は 0 次元、モーターがあればロック', () => {
    const scene = triangle(true);
    expect(validateScene(scene)).toEqual({ ok: true });
    const layout = resolveLayout(scene);
    expect(layout.meshes).toEqual([
      { a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'bevel' },
      { a: 'gear_a', b: 'gear_c', source: 'tree', kind: 'bevel' },
      { a: 'gear_b', b: 'gear_c', source: 'contact', kind: 'bevel' },
    ]);
    expect(layout.interferences).toEqual([]);
    const graph = buildMeshGraph(scene, layout.meshes);
    expect(graph.components).toHaveLength(1);
    expect(graph.components[0]?.dof).toBe(0);
    const motion = solveMotion(scene, layout, initialMotionState());
    expect(motion.locks).toEqual([
      expect.objectContaining({
        reason: 'contradiction',
        shaftIds: ['shaft_a', 'shaft_b', 'shaft_c'],
      }),
    ]);
    expect(motion.omegas.shaft_a).toBe(0);
  });

  it('モーターが無ければロックしない（止まっているだけ）', () => {
    const scene = triangle(false);
    const motion = solveMotion(scene, resolveLayout(scene), initialMotionState());
    expect(motion.locks).toEqual([]);
  });
});

describe('歯数の変更', () => {
  it('A を 24 歯に → A と B がともに 24 歯、B の大端の中心 [-24, 59, 0]。Undo で戻る', () => {
    const ctx = { ids: createSequentialIdGenerator() };
    const state0 = { scene: bevelPair, history: emptyHistory() };
    const state1 = execute(state0, { type: 'setGearTeeth', gearId: 'gear_a', teeth: 24 }, ctx);
    expect(state1.ok).toBe(true);
    if (!state1.ok) return;
    const scene = state1.state.scene;
    expect(scene.gears.gear_a?.teeth).toBe(24);
    expect(scene.gears.gear_b?.teeth).toBe(24);
    expect(validateScene(scene)).toEqual({ ok: true });
    const layout = resolveLayout(scene);
    expectVec(bigEnd(scene, layout, 'gear_b'), [-24, 59, 0]);
    expect(state1.state.history.past).toHaveLength(1); // 1 つのコマンド（Undo 1 回）
    expect(undo(state1.state)?.scene).toBe(bevelPair);
  });

  it('子の B を変えても、親の A が一緒に変わる', () => {
    const scene = apply(bevelPair, { type: 'setGearTeeth', gearId: 'gear_b', teeth: 30 });
    expect(scene.gears.gear_a?.teeth).toBe(30);
    expect(scene.gears.gear_b?.teeth).toBe(30);
  });
});

describe('歯の幅 b', () => {
  it('中・12 歯 → min(8, 12·√2/3) ≈ 5.657、中・20 歯 → 8', () => {
    expect(bevelToothWidth('M', 12)).toBeCloseTo((12 * Math.SQRT2) / 3, 9);
    expect(bevelToothWidth('M', 12)).toBeCloseTo(5.657, 3);
    expect(bevelToothWidth('M', 20)).toBe(8);
  });
});

describe('干渉', () => {
  it('bevel-pair の A と B の円柱は互いに除外され、干渉なし', () => {
    expect(resolveLayout(bevelPair).interferences).toEqual([]);
  });

  it('B のシャフトに、頂点を越える位置まで平歯車を通す → A のシャフトとの干渉が出る', () => {
    const scene = apply(bevelPair, {
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_b',
      offset: 16,
      size: 'M',
      teeth: 20,
    });
    const interferences = resolveLayout(scene).interferences;
    expect(interferences.some(([a, b]) => a === 'shaft_a' || b === 'shaft_a')).toBe(true);
  });
});

// かさ歯車の組（起点の縦のシャフトの A と、その bevel の子 B。axisStep 2、side −1）
function pair(size: 'S' | 'M', teeth: number): Scene {
  const a: Gear = {
    id: 'gear_a',
    kind: 'bevel',
    apex: 1,
    shaftId: 'shaft_a',
    size,
    teeth,
    offset: 0,
  };
  return {
    shafts: {
      shaft_a: { id: 'shaft_a', placement: { kind: 'root', origin: [0, 30, 0], axis: 'y' } },
      shaft_b: {
        id: 'shaft_b',
        placement: {
          kind: 'bevel',
          parentGearId: 'gear_a',
          childGearId: 'gear_b',
          axisStep: 2,
          side: -1,
        },
      },
    },
    gears: { gear_a: a, gear_b: { ...a, id: 'gear_b', shaftId: 'shaft_b' } },
    motors: {},
    anchors: {},
  };
}

// シャフトの頂点側の端のワールド座標（軸の座標）
function shaftEnd(layout: Layout, shaftId: string, end: 0 | 1): number {
  const s = layout.shafts[shaftId];
  if (s === undefined) throw new Error(`${shaftId} が無い`);
  const k = { x: 0, y: 1, z: 2 }[s.axis];
  return (s.origin[k] as number) + s.span[end];
}

describe('シャフトの頂点側の端', () => {
  it('小・12 歯の組（R = 6）: どちらのシャフトも頂点の 2 mm 手前で止まり、干渉なし', () => {
    const scene = pair('S', 12);
    expect(validateScene(scene)).toEqual({ ok: true });
    const layout = resolveLayout(scene);
    const apex = apexPoint(scene, layout, 'gear_a');
    expectVec(apexPoint(scene, layout, 'gear_b'), apex);
    expect(shaftEnd(layout, 'shaft_a', 1)).toBeCloseTo(apex[1] - 2, 9);
    expect(shaftEnd(layout, 'shaft_b', 1)).toBeCloseTo(apex[0] - 2, 9);
    expect(layout.interferences).toEqual([]);
  });

  it('中・12 歯の組（R = 12）: 同様に頂点の 2 mm 手前で止まり、干渉なし', () => {
    const scene = pair('M', 12);
    const layout = resolveLayout(scene);
    const apex = apexPoint(scene, layout, 'gear_a');
    expect(shaftEnd(layout, 'shaft_a', 1)).toBeCloseTo(apex[1] - 2, 9);
    expect(shaftEnd(layout, 'shaft_b', 1)).toBeCloseTo(apex[0] - 2, 9);
    expect(layout.interferences).toEqual([]);
  });

  it('中・20 歯（R = 20）は頂点まで届かないので、ふつうの長さ（面 + 4 mm）', () => {
    const layout = resolveLayout(bevelPair);
    expect(layout.shafts.shaft_a?.span).toEqual([-4, 12]);
  });

  it('apex −1 のかさ歯車は負側の端を切る', () => {
    const scene = withShaftB(pair('S', 12), { side: 1 });
    const layout = resolveLayout(scene);
    const apex = apexPoint(scene, layout, 'gear_b');
    expect(shaftEnd(layout, 'shaft_b', 0)).toBeCloseTo(apex[0] + 2, 9);
    expect(layout.interferences).toEqual([]);
  });

  it('小・12 歯の組の A のシャフトの頂点側に平歯車を足す → 平歯車の面 + 4 mm まで伸び、相手のシャフトとの干渉が出る', () => {
    const scene = apply(pair('S', 12), {
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_a',
      offset: 4,
      size: 'S',
      teeth: 12,
    });
    const layout = resolveLayout(scene);
    expect(layout.shafts.shaft_a?.span).toEqual([-4, 4 + 4 + 4]);
    expect(layout.interferences.some(([a, b]) => a === 'shaft_b' || b === 'shaft_b')).toBe(true);
  });
});

describe('偶然のかみ合い（contact）', () => {
  // A の頂点 [0, 55, 0] と頂点が一致する、木の親子でない X 軸の起点のシャフトのかさ歯車 C（apex −1）
  function withRoot(teeth: number): Scene {
    // 大端の中心 [teeth, 55, 0]（頂点まで R = teeth）、apex −1 なので原点 = 大端の中心 − 8
    return {
      shafts: {
        shaft_a: bevelPair.shafts.shaft_a as Shaft,
        shaft_c: {
          id: 'shaft_c',
          placement: { kind: 'root', origin: [teeth - 8, 55, 0], axis: 'x' },
        },
      },
      gears: {
        gear_a: bevelPair.gears.gear_a as Gear,
        gear_c: {
          id: 'gear_c',
          kind: 'bevel',
          apex: -1,
          shaftId: 'shaft_c',
          size: 'M',
          teeth,
          offset: 0,
        },
      },
      motors: {},
      anchors: {},
    };
  }

  it('同じ大きさ・同じ歯数・直交・頂点が一致 → contact の bevel のかみ合い', () => {
    const scene = withRoot(20);
    const layout = resolveLayout(scene);
    expectVec(apexPoint(scene, layout, 'gear_c'), [0, 55, 0]);
    expect(layout.meshes).toEqual([{ a: 'gear_a', b: 'gear_c', source: 'contact', kind: 'bevel' }]);
    expect(layout.interferences).toEqual([]);
    expect(omegas(scene).shaft_c).toBe(0); // モーターが無い
  });

  it('歯数が違う（頂点は一致）→ かみ合いでない', () => {
    const scene = withRoot(24);
    const layout = resolveLayout(scene);
    expectVec(apexPoint(scene, layout, 'gear_c'), [0, 55, 0]);
    expect(layout.meshes).toEqual([]);
  });
});

describe('候補', () => {
  const spec = {
    perimeterTeeth: 20,
    coaxialSize: 'M',
    coaxialTeeth: 20,
    coaxialKind: 'spur',
  } as const;

  it('A（B の無いシーン）を選ぶ → 直交する 2 軸 × 2 方向の 4 つのかさ歯車の候補（外周の候補は無い）', () => {
    const scene: Scene = {
      shafts: { shaft_a: bevelPair.shafts.shaft_a as Shaft },
      gears: { gear_a: bevelPair.gears.gear_a as Gear },
      motors: {},
      anchors: {},
    };
    const list = listGrowCandidates(scene, 'gear_a', spec);
    const bevels = list.filter((c) => c.kind === 'bevel');
    expect(list.filter((c) => c.kind === 'perimeter')).toEqual([]);
    expect(bevels.map((c) => c.kind === 'bevel' && [c.axisStep, c.side])).toEqual([
      [1, -1],
      [1, 1],
      [2, -1],
      [2, 1],
    ]);
    for (const c of bevels) {
      if (c.kind !== 'bevel') continue;
      expect(c.shape).toEqual({ kind: 'bevel', apex: c.side === 1 ? -1 : 1 });
      expect(c.teeth).toBe(20);
      expect(c.size).toBe('M');
    }
    expect(bevels.map((c) => c.axis)).toEqual(['z', 'z', 'x', 'x']);
  });

  it('bevel-pair の A: B のある位置の候補は出ず、候補をコマンドにすると頂点が一致する位置に子が置かれる', () => {
    const list = listGrowCandidates(bevelPair, 'gear_a', spec).filter((c) => c.kind === 'bevel');
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeLessThanOrEqual(3);
    for (const c of list) {
      if (c.kind !== 'bevel') continue;
      expect([c.axisStep, c.side]).not.toEqual([2, -1]);
      const result = applyCommand(
        bevelPair,
        {
          type: 'growGear',
          mode: 'bevel',
          parentGearId: 'gear_a',
          axisStep: c.axisStep,
          side: c.side,
        },
        { ids: createSequentialIdGenerator() },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const [, gearId] = result.created as [string, string];
      const layout = resolveLayout(result.scene);
      expectVec(layout.gears[gearId]?.center, c.center);
      expect(layout.gears[gearId]?.basePhase).toBeCloseTo(c.basePhase, 12);
      expectVec(apexPoint(result.scene, layout, gearId), [0, 55, 0]);
      expect(layout.interferences).toEqual([]);
    }
  });

  it('resolveAddition は、足したシーン全体の resolveLayout と一致する', () => {
    const base = resolveLayout(bevelPair);
    for (const axisStep of [1, 2] as const) {
      for (const side of [-1, 1] as const) {
        const shaft: Shaft = {
          id: 'shaft_n',
          placement: {
            kind: 'bevel',
            parentGearId: 'gear_b',
            childGearId: 'gear_n',
            axisStep,
            side,
          },
        };
        const gear: Gear = {
          id: 'gear_n',
          kind: 'bevel',
          apex: side === 1 ? -1 : 1,
          shaftId: 'shaft_n',
          size: 'M',
          teeth: 20,
          offset: 0,
        };
        const full: Scene = {
          ...bevelPair,
          shafts: { ...bevelPair.shafts, shaft_n: shaft },
          gears: { ...bevelPair.gears, gear_n: gear },
        };
        const expected = resolveLayout(full);
        const addition = resolveAddition(bevelPair, base, shaft, gear);
        expect(addition?.gear).toEqual(expected.gears.gear_n);
        const touching = expected.interferences.filter((pair) =>
          pair.some((id) => id === 'gear_n' || id === 'shaft_n'),
        );
        expect(addition?.interferences).toEqual(touching);
      }
    }
  });
});
