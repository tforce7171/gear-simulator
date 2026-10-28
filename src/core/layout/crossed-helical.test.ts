import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../edit/commands';
import { canMesh } from '../geometry/can-mesh';
import { angleAround, skewSign } from '../geometry/skew';
import { meshCoefficients } from '../kinematics/mesh-coefficients';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import type { MotionState } from '../kinematics/types';
import { sub, type Vec3 } from '../math/vec3';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Gear, Motor, Scene, Shaft } from '../scene/types';
import { validateScene } from '../scene/validate';
import { listGrowCandidates } from './candidates';
import { resolveLayout } from './resolve';
import type { Layout, Mesh } from './types';

// ねじ歯車（S2-04）: S2-03 の skew の配置・候補・contact・拘束に、ねじ歯車同士の組を足す

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

const crossedPair = fixture('crossed-pair');
const TWO_PI = 2 * Math.PI;

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  if (actual === undefined) throw new Error('値が無い');
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i] as number, 9);
}

function apply(scene: Scene, command: Command): Scene {
  const result = applyCommand(scene, command, { ids: createSequentialIdGenerator() });
  if (!result.ok) throw new Error(`${command.type}: ${result.error.message}`);
  return result.scene;
}

function withShaft(scene: Scene, shaft: Shaft): Scene {
  return { ...scene, shafts: { ...scene.shafts, [shaft.id]: shaft } };
}

function withMotors(scene: Scene, motors: Motor[]): Scene {
  return { ...scene, motors: Object.fromEntries(motors.map((m) => [m.id, m])) };
}

// crossed-pair の B の配置の side・axisStep を変えたもの
function placementB(side: 1 | -1, axisStep: 1 | 2 = 2): Scene {
  return withShaft(crossedPair, {
    id: 'shaft_b',
    placement: { kind: 'skew', parentGearId: 'gear_a', childGearId: 'gear_b', axisStep, side },
  });
}

function solve(scene: Scene, layout: Layout = resolveLayout(scene)): MotionState {
  return solveMotion(scene, layout, initialMotionState());
}

// crossed-pair から B を除いたもの
const aOnly: Scene = {
  shafts: { shaft_a: crossedPair.shafts.shaft_a as Shaft },
  gears: { gear_a: crossedPair.gears.gear_a as Gear },
  motors: crossedPair.motors,
  anchors: {},
  carriers: {},
};
const gearA = crossedPair.gears.gear_a as Gear;
const gearB = crossedPair.gears.gear_b as Gear;

describe('canMesh（ねじ歯車）', () => {
  it('ねじ歯車同士（同じ大きさ）→ 真。ねじ歯車とハスバ歯車・平歯車 → 偽', () => {
    expect(canMesh(gearA, gearB)).toBe(true);
    expect(canMesh(gearB, gearA)).toBe(true);
    const others: Gear[] = [
      { ...gearB, kind: 'helical', hand: 'right' },
      { ...gearB, kind: 'helical', hand: 'left' },
      { ...gearB, kind: 'spur' },
      { ...gearB, kind: 'wormWheel' },
    ];
    for (const other of others) {
      expect(canMesh(gearA, other)).toBe(false);
      expect(canMesh(other, gearA)).toBe(false);
    }
    expect(canMesh(gearA, { ...gearB, size: 'S' })).toBe(false);
  });
});

describe('resolveLayout(crossed-pair)', () => {
  it("B のシャフトの軸 'z'、B の中心 [4, 140, 0]、crossedHelical のかみ合い、干渉なし", () => {
    expect(validateScene(crossedPair)).toEqual({ ok: true });
    const layout = resolveLayout(crossedPair);
    expectVec(layout.gears.gear_a?.center, [4, 80, 0]);
    expect(layout.shafts.shaft_b?.axis).toBe('z');
    expectVec(layout.gears.gear_b?.center, [4, 140, 0]);
    expectVec(layout.shafts.shaft_b?.origin, [4, 140, -4]);
    expect(layout.meshes).toEqual([
      { a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'crossedHelical' },
    ]);
    expect(layout.interferences).toEqual([]);
  });
});

describe('運動', () => {
  it('crossed-pair（A 2π rad/s）→ B は −π rad/s（s = (x × y)·z = 1）', () => {
    const motion = solve(crossedPair);
    expect(motion.locks).toEqual([]);
    expect(motion.omegas.shaft_a).toBeCloseTo(TWO_PI, 9);
    expect(motion.omegas.shaft_b).toBeCloseTo(-Math.PI, 9);
  });

  it('side −1（B の中心 [4, 20, 0]）→ B は +π rad/s', () => {
    const scene = placementB(-1);
    const layout = resolveLayout(scene);
    expectVec(layout.gears.gear_b?.center, [4, 20, 0]);
    expect(layout.interferences).toEqual([]);
    expect(solve(scene, layout).omegas.shaft_b).toBeCloseTo(Math.PI, 9);
  });

  it("axisStep 1（B の軸 'y'、u は z）、side 1 → 中心 [4, 80, 60]、s = (x × z)·y = −1 → B は +π rad/s", () => {
    const scene = placementB(1, 1);
    const layout = resolveLayout(scene);
    expect(layout.shafts.shaft_b?.axis).toBe('y');
    expectVec(layout.gears.gear_b?.center, [4, 80, 60]);
    expect(layout.interferences).toEqual([]);
    const la = layout.gears.gear_a;
    const lb = layout.gears.gear_b;
    if (la === undefined || lb === undefined) throw new Error('レイアウトが無い');
    expect(skewSign(la.axis, la.center, lb.axis, lb.center)).toBeCloseTo(-1, 12);
    expect(solve(scene, layout).omegas.shaft_b).toBeCloseTo(Math.PI, 9);
  });

  it('逆側の駆動: モーターを B のシャフトに移す（30 rpm = π rad/s）→ A は −2π rad/s。ロックしない', () => {
    const scene = withMotors(crossedPair, [
      { id: 'motor_m', shaftId: 'shaft_b', size: 'M', rpm: 30, direction: 1, on: true },
    ]);
    const motion = solve(scene);
    expect(motion.locks).toEqual([]);
    expect(motion.omegas.shaft_b).toBeCloseTo(Math.PI, 9);
    expect(motion.omegas.shaft_a).toBeCloseTo(-TWO_PI, 9);
  });

  it('s の対称性: a と b を入れ替えても係数から求まる比が同じ', () => {
    for (const scene of [crossedPair, placementB(-1), placementB(1, 1), placementB(-1, 1)]) {
      const forward: Mesh = { a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'crossedHelical' };
      const backward: Mesh = { a: 'gear_b', b: 'gear_a', source: 'tree', kind: 'crossedHelical' };
      const f = meshCoefficients(forward, scene);
      const r = meshCoefficients(backward, scene);
      expect(-f.a / f.b).toBeCloseTo(-r.b / r.a, 12);
      expect(Math.abs(-f.a / f.b)).toBeCloseTo(20 / 40, 12);
    }
  });
});

describe('位相', () => {
  it('接点で A の歯の中心と B の歯溝の中心が重なり、回しても保たれる', () => {
    for (const scene of [crossedPair, placementB(-1), placementB(1, 1), placementB(-1, 1)]) {
      const layout = resolveLayout(scene);
      const la = layout.gears.gear_a;
      const lb = layout.gears.gear_b;
      if (la === undefined || lb === undefined) throw new Error('レイアウトが無い');
      const d = sub(lb.center, la.center);
      const thetaC = angleAround(la.axis, d);
      const alphaC = angleAround(lb.axis, [-d[0], -d[1], -d[2]]);
      const s = skewSign(la.axis, la.center, lb.axis, lb.center);
      // z_b·(φ_b − α_c)/2π + 1/2 − s·z_a·(θ_c − φ_a)/2π が整数
      const mismatch = (phiA: number, phiB: number) => {
        const x = (40 * (phiB - alphaC)) / TWO_PI + 0.5 - (s * 20 * (thetaC - phiA)) / TWO_PI;
        return Math.abs(x - Math.round(x));
      };
      expect(mismatch(la.basePhase, lb.basePhase)).toBeLessThan(1e-9);
      // z_b·ω_b + s·z_a·ω_a = 0 で回す
      const turn = 1.234;
      expect(mismatch(la.basePhase + turn, lb.basePhase - (s * 20 * turn) / 40)).toBeLessThan(1e-9);
    }
  });
});

describe('候補', () => {
  const spec = {
    perimeterTeeth: 20,
    coaxialSize: 'M',
    coaxialTeeth: 20,
    coaxialKind: 'spur',
  } as const;

  it("A から列挙した外周の候補（新しいシャフトを作るもの）がすべて 'skew' で、軸が 'y' か 'z'。平行な軸の候補はない", () => {
    const candidates = listGrowCandidates(crossedPair, 'gear_a', spec);
    const fresh = candidates.filter((c) => c.kind !== 'coaxial');
    expect(fresh.length).toBeGreaterThanOrEqual(1);
    expect(fresh.length).toBeLessThanOrEqual(4);
    for (const c of fresh) {
      expect(c.kind).toBe('skew');
      expect(['y', 'z']).toContain(c.axis);
      expect(c.shape).toEqual({ kind: 'crossedHelical' });
      expect(c.size).toBe('M');
      expect(c.teeth).toBe(20);
    }
    expect(fresh.some((c) => c.axis === 'x')).toBe(false);
    // 既にある B と同じ場所（axisStep 2・side 1）は干渉するので出ない
    expect(fresh.some((c) => c.kind === 'skew' && c.axisStep === 2 && c.side === 1)).toBe(false);
  });

  it('候補をクリックしたのと同じコマンド → skew のシャフトにねじ歯車が生え、干渉なし', () => {
    const candidate = listGrowCandidates(crossedPair, 'gear_a', spec).find(
      (c) => c.kind === 'skew',
    );
    if (candidate?.kind !== 'skew') throw new Error('skew の候補が無い');
    const scene = apply(crossedPair, {
      type: 'growGear',
      mode: 'skew',
      parentGearId: 'gear_a',
      axisStep: candidate.axisStep,
      side: candidate.side,
      teeth: candidate.teeth,
    });
    expect(validateScene(scene)).toEqual({ ok: true });
    const added = Object.values(scene.gears).find((g) => !(g.id in crossedPair.gears)) as Gear;
    expect(added).toMatchObject({ kind: 'crossedHelical', size: 'M', teeth: 20, offset: 0 });
    expect(scene.shafts[added.shaftId]?.placement.kind).toBe('skew');
    const layout = resolveLayout(scene);
    expectVec(layout.gears[added.id]?.center, candidate.center);
    expect(layout.gears[added.id]?.basePhase).toBeCloseTo(candidate.basePhase, 12);
    expect(layout.interferences).toEqual([]);
  });

  it("同じ軸の候補・起点で 'crossedHelical' を作れる", () => {
    const coaxial = listGrowCandidates(aOnly, 'gear_a', {
      ...spec,
      coaxialKind: 'crossedHelical',
    }).filter((c) => c.kind === 'coaxial');
    expect(coaxial.map((c) => (c.kind === 'coaxial' ? c.offset : null))).toEqual([-8, 8]);
    for (const c of coaxial) expect(c.shape).toEqual({ kind: 'crossedHelical' });
    const scene = apply(aOnly, {
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_a',
      offset: 8,
      size: 'M',
      teeth: 20,
      kind: 'crossedHelical',
    });
    expect(validateScene(scene)).toEqual({ ok: true });
    const root = apply(crossedPair, {
      type: 'addRootShaft',
      axis: 'y',
      origin: [200, 50, 0],
      gear: { size: 'S', teeth: 30, kind: 'crossedHelical' },
    });
    const added = Object.values(root.gears).find((g) => !(g.id in crossedPair.gears)) as Gear;
    expect(added).toMatchObject({ kind: 'crossedHelical', teeth: 30, size: 'S' });
  });
});

describe('contact と検証', () => {
  it('木の親子でないねじ歯車がちょうどの位置 → contact のかみ合い', () => {
    const scene: Scene = {
      ...crossedPair,
      shafts: {
        shaft_a: crossedPair.shafts.shaft_a as Shaft,
        shaft_b: { id: 'shaft_b', placement: { kind: 'root', origin: [4, 140, -4], axis: 'z' } },
      },
    };
    const layout = resolveLayout(scene);
    expect(layout.meshes).toEqual([
      { a: 'gear_a', b: 'gear_b', source: 'contact', kind: 'crossedHelical' },
    ]);
    expect(layout.interferences).toEqual([]);
    expect(solve(scene, layout).omegas.shaft_b).toBeCloseTo(-Math.PI, 9);

    // 中心を結ぶ線が軸に直交しない（B を z 方向に 4 ずらす）→ かみ合いでなく干渉
    const shifted = withShaft(scene, {
      id: 'shaft_b',
      placement: { kind: 'root', origin: [4, 140, 0], axis: 'z' },
    });
    const l2 = resolveLayout(shifted);
    expect(l2.meshes).toEqual([]);
    expect(l2.interferences).toContainEqual(['gear_a', 'gear_b']);
  });

  it('平行な軸ではかみ合わない（外周の mesh の配置・contact・外周に生やすコマンド）', () => {
    const codes = (scene: Scene) => {
      const r = validateScene(scene);
      return r.ok ? [] : r.errors.map((e) => e.code);
    };
    expect(
      codes(
        withShaft(crossedPair, {
          id: 'shaft_b',
          placement: { kind: 'mesh', parentGearId: 'gear_a', childGearId: 'gear_b', angle: 0 },
        }),
      ),
    ).toEqual(['meshKindMismatch']);
    // 平行な軸でちょうどの距離に置いても contact にならない（干渉になる）
    const parallel: Scene = {
      ...crossedPair,
      shafts: {
        shaft_a: crossedPair.shafts.shaft_a as Shaft,
        shaft_b: { id: 'shaft_b', placement: { kind: 'root', origin: [0, 140, 0], axis: 'x' } },
      },
    };
    const layout = resolveLayout(parallel);
    expect(layout.meshes).toEqual([]);
    expect(layout.interferences).toContainEqual(['gear_a', 'gear_b']);
    const r = applyCommand(
      crossedPair,
      { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_a', angle: 0, teeth: 20 },
      { ids: createSequentialIdGenerator() },
    );
    expect(r.ok ? null : r.error.code).toBe('notAllowed');
  });
});
