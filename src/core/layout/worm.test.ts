import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../edit/commands';
import { canMesh } from '../geometry/can-mesh';
import { angleAround, skewSign } from '../geometry/skew';
import { wormSectionWidth } from '../geometry/worm';
import { buildMeshGraph } from '../kinematics/graph';
import { meshCoefficients } from '../kinematics/mesh-coefficients';
import { initialMotionState, solveMotion, stepMotion } from '../kinematics/motion';
import type { MotionState } from '../kinematics/types';
import { wormSections } from '../kinematics/worm-solve';
import { sub, type Vec3 } from '../math/vec3';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Gear, Motor, Scene, Shaft } from '../scene/types';
import { validateScene } from '../scene/validate';
import { listGrowCandidates } from './candidates';
import { resolveLayout } from './resolve';
import type { Layout, Mesh } from './types';

// ウォームギア（S2-03）: skew の配置・候補・contact・干渉・拘束・セルフロック

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

const wormBasic = fixture('worm-basic');
const wormBackdrive = fixture('worm-backdrive');
// worm-basic からホイールを除いたもの
const wormOnly: Scene = {
  shafts: { shaft_w: wormBasic.shafts.shaft_w as Shaft },
  gears: { gear_w: wormBasic.gears.gear_w as Gear },
  motors: wormBasic.motors,
  anchors: {},
  carriers: {},
  racks: {},
};
const TWO_PI = 2 * Math.PI;

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  if (actual === undefined) throw new Error('値が無い');
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i] as number, 9);
}

function apply(scene: Scene, command: Command, ids = createSequentialIdGenerator()): Scene {
  const result = applyCommand(scene, command, { ids });
  if (!result.ok) throw new Error(`${command.type}: ${result.error.message}`);
  return result.scene;
}

function withShaft(scene: Scene, shaft: Shaft): Scene {
  return { ...scene, shafts: { ...scene.shafts, [shaft.id]: shaft } };
}

function withGear(scene: Scene, gear: Gear): Scene {
  return { ...scene, gears: { ...scene.gears, [gear.id]: gear } };
}

function withMotors(scene: Scene, motors: Motor[]): Scene {
  return { ...scene, motors: Object.fromEntries(motors.map((m) => [m.id, m])) };
}

function motor(id: string, shaftId: string, patch: Partial<Motor> = {}): Motor {
  return { id, shaftId, size: 'M', rpm: 60, direction: 1, on: true, ...patch };
}

// worm-basic の H の配置の side・axisStep を変えたもの
function wheelPlacement(side: 1 | -1, axisStep: 1 | 2 = 2): Scene {
  return withShaft(wormBasic, {
    id: 'shaft_h',
    placement: {
      kind: 'skew',
      parentGearId: 'gear_w',
      childGearId: 'gear_h',
      axisStep,
      side,
    },
  });
}

function solve(scene: Scene, layout: Layout = resolveLayout(scene)): MotionState {
  return solveMotion(scene, layout, initialMotionState());
}

describe('resolveLayout(worm-basic)', () => {
  it('W の中心 [16, 80, 0]、H は軸 z・中心 [16, 40, 0]・原点 [16, 40, -4]、worm のかみ合い、干渉なし', () => {
    expect(validateScene(wormBasic)).toEqual({ ok: true });
    const layout = resolveLayout(wormBasic);
    expectVec(layout.gears.gear_w?.center, [16, 80, 0]);
    expect(layout.gears.gear_w?.pitchRadius).toBe(10);
    expect(layout.shafts.shaft_h?.axis).toBe('z');
    expectVec(layout.gears.gear_h?.center, [16, 40, 0]);
    expectVec(layout.shafts.shaft_h?.origin, [16, 40, -4]);
    expect(layout.meshes).toEqual([{ a: 'gear_h', b: 'gear_w', source: 'tree', kind: 'worm' }]);
    expect(layout.interferences).toEqual([]);
  });

  it('ウォームのシャフトの長さは区画の幅 32 の両側に 4 mm', () => {
    expect(resolveLayout(wormBasic).shafts.shaft_w?.span).toEqual([-4, 36]);
  });

  it('axisStep 1（H の軸 y、u は z）、side 1 → H の中心 [16, 80, 40]', () => {
    const layout = resolveLayout(wheelPlacement(1, 1));
    expect(layout.shafts.shaft_h?.axis).toBe('y');
    expectVec(layout.gears.gear_h?.center, [16, 80, 40]);
    expectVec(layout.shafts.shaft_h?.origin, [16, 76, 40]);
    expect(layout.interferences).toEqual([]);
  });

  it('親の向きを R で変える（W の軸 z）→ H の軸は y（z → x → y）', () => {
    const scene = withShaft(wormBasic, {
      id: 'shaft_w',
      placement: { kind: 'root', origin: [0, 80, 0], axis: 'z' },
    });
    const layout = resolveLayout(scene);
    expect(layout.shafts.shaft_h?.axis).toBe('y');
    // u は x。W の中心 [0, 80, 16] から −x 側へ 40
    expectVec(layout.gears.gear_h?.center, [-40, 80, 16]);
    expect(layout.meshes).toEqual([{ a: 'gear_h', b: 'gear_w', source: 'tree', kind: 'worm' }]);
  });
});

describe('区画の幅', () => {
  it('小・中・大のウォームで 16・32・48', () => {
    expect(wormSectionWidth('S')).toBe(16);
    expect(wormSectionWidth('M')).toBe(32);
    expect(wormSectionWidth('L')).toBe(48);
  });

  it('offset 4 のウォーム（中）の中心は原点から 20', () => {
    const scene = withGear(wormBasic, { ...(wormBasic.gears.gear_w as Gear), offset: 4 });
    expectVec(resolveLayout(scene).gears.gear_w?.center, [20, 80, 0]);
  });
});

describe('運動', () => {
  it('worm-basic（W 60 rpm = 2π rad/s）→ H は 2π/30 rad/s（同じ符号）', () => {
    const motion = solve(wormBasic);
    expect(motion.locks).toEqual([]);
    expect(motion.omegas.shaft_w).toBeCloseTo(TWO_PI, 9);
    expect(motion.omegas.shaft_h).toBeCloseTo(TWO_PI / 30, 9);
  });

  it('side 1（H の中心 [16, 120, 0]）→ H は −2π/30 rad/s', () => {
    const scene = wheelPlacement(1);
    expectVec(resolveLayout(scene).gears.gear_h?.center, [16, 120, 0]);
    expect(solve(scene).omegas.shaft_h).toBeCloseTo(-TWO_PI / 30, 9);
  });

  it('s の対称性: a と b を入れ替えても係数から求まる比が同じ', () => {
    for (const scene of [
      wormBasic,
      wheelPlacement(1),
      wheelPlacement(1, 1),
      wheelPlacement(-1, 1),
    ]) {
      const forward: Mesh = { a: 'gear_w', b: 'gear_h', source: 'tree', kind: 'worm' };
      const backward: Mesh = { a: 'gear_h', b: 'gear_w', source: 'tree', kind: 'worm' };
      const f = meshCoefficients(forward, scene);
      const b = meshCoefficients(backward, scene);
      // c_a·ω_a + c_b·ω_b = 0 から ω_h / ω_w
      expect(-f.a / f.b).toBeCloseTo(-b.b / b.a, 12);
      expect(Math.abs(-f.a / f.b)).toBeCloseTo(1 / 30, 12);
      const lw = resolveLayout(scene).gears.gear_w;
      const lh = resolveLayout(scene).gears.gear_h;
      if (lw === undefined || lh === undefined) throw new Error('レイアウトが無い');
      expect(skewSign(lw.axis, lw.center, lh.axis, lh.center)).toBeCloseTo(
        skewSign(lh.axis, lh.center, lw.axis, lw.center),
        12,
      );
    }
  });

  it('角度の積分: worm-basic を dt = 1/60 で 60 回 → W の角度 2π、H の角度 2π/30', () => {
    const layout = resolveLayout(wormBasic);
    let state = initialMotionState();
    for (let i = 0; i < 60; i++) state = stepMotion(wormBasic, layout, state, 1 / 60);
    expect(Math.abs((state.angles.shaft_w ?? 0) - TWO_PI)).toBeLessThan(1e-9);
    expect(Math.abs((state.angles.shaft_h ?? 0) - TWO_PI / 30)).toBeLessThan(1e-9);
  });

  it('ホイールの先に平歯車: H のシャフトに中・20 歯 P、P の外周に中・40 歯 Q → Q の ω = −(2π/30)·20/40', () => {
    const ids = createSequentialIdGenerator();
    let scene = apply(
      wormBasic,
      {
        type: 'growGear',
        mode: 'coaxial',
        shaftId: 'shaft_h',
        offset: -8,
        size: 'M',
        teeth: 20,
      },
      ids,
    );
    const p = Object.keys(scene.gears).find((id) => !(id in wormBasic.gears)) as string;
    scene = apply(
      scene,
      { type: 'growGear', mode: 'perimeter', parentGearId: p, angle: (3 * Math.PI) / 2, teeth: 40 },
      ids,
    );
    const q = Object.values(scene.gears).find((g) => g.teeth === 40) as Gear;
    const motion = solve(scene);
    expect(motion.locks).toEqual([]);
    expect(motion.omegas[q.shaftId]).toBeCloseTo((-(TWO_PI / 30) * 20) / 40, 9);
  });
});

describe('セルフロック', () => {
  it('逆駆動: worm-backdrive → ロック（wormBackDrive）、全シャフトの ω = 0', () => {
    const motion = solve(wormBackdrive);
    expect(motion.locks).toEqual([
      {
        reason: 'wormBackDrive',
        shaftIds: ['shaft_h', 'shaft_w'],
        gearIds: ['gear_h', 'gear_w'],
      },
    ]);
    expect(motion.omegas).toEqual({ shaft_h: 0, shaft_w: 0 });
    expect(motion.backDriven).toEqual([]);
  });

  it('逆駆動（どの強さでも）: H 側のモーターを 大・120 rpm にしてもロック', () => {
    for (const direction of [1, -1] as const) {
      const scene = withMotors(wormBackdrive, [
        motor('motor_m', 'shaft_h', { size: 'L', rpm: 120, direction }),
      ]);
      const motion = solve(scene);
      expect(motion.locks.map((l) => l.reason)).toEqual(['wormBackDrive']);
      expect(motion.omegas).toEqual({ shaft_h: 0, shaft_w: 0 });
    }
  });

  it('両側にモーター（H は逆向き）→ ロックしない。W は 2π（無負荷）、H は 2π/30、H のモーターが backDriven', () => {
    const scene = withMotors(wormBasic, [
      motor('motor_w', 'shaft_w', { size: 'S', rpm: 60 }),
      motor('motor_h', 'shaft_h', { size: 'L', rpm: 15, direction: -1 }),
    ]);
    const motion = solve(scene);
    expect(motion.locks).toEqual([]);
    expect(motion.omegas.shaft_w).toBeCloseTo(TWO_PI, 9);
    expect(motion.omegas.shaft_h).toBeCloseTo(TWO_PI / 30, 9);
    expect(motion.backDriven).toEqual(['motor_h']);
  });

  it('両側に同じ向き → H は 2π/30 のまま、backDriven に入らない', () => {
    const scene = withMotors(wormBasic, [
      motor('motor_w', 'shaft_w', { size: 'S', rpm: 60 }),
      motor('motor_h', 'shaft_h', { size: 'L', rpm: 15, direction: 1 }),
    ]);
    const motion = solve(scene);
    expect(motion.locks).toEqual([]);
    expect(motion.omegas.shaft_w).toBeCloseTo(TWO_PI, 9);
    expect(motion.omegas.shaft_h).toBeCloseTo(TWO_PI / 30, 9);
    expect(motion.backDriven).toEqual([]);
  });

  it('手で回す: H のシャフトをつかむ → ロック。W のシャフトをつかんで 1 rad/s → H は 1/30 rad/s', () => {
    const layout = resolveLayout(wormBasic);
    const prev = stepMotion(wormBasic, layout, initialMotionState(), 0);
    const dt = 0.1;
    const grabH = stepMotion(wormBasic, layout, prev, dt, {
      hand: { shaftId: 'shaft_h', angle: 0.5 },
    });
    expect(grabH.locks.map((l) => l.reason)).toEqual(['wormBackDrive']);
    expect(grabH.omegas).toEqual({ shaft_h: 0, shaft_w: 0 });
    expect(grabH.angles).toEqual(prev.angles);

    const grabW = stepMotion(wormBasic, layout, prev, dt, {
      hand: { shaftId: 'shaft_w', angle: 1 * dt },
    });
    expect(grabW.locks).toEqual([]);
    expect(grabW.omegas.shaft_w).toBeCloseTo(1, 9);
    expect(grabW.omegas.shaft_h).toBeCloseTo(1 / 30, 9);
  });

  it('止まったウォームが別のウォームに逆から回される（2 本のウォームが 1 枚のホイールを回す）→ wormBackDrive', () => {
    // W2 は H の反対側（+z）を、軸 y で回す（H の軸 z、u は x）
    let scene = wheelPlacement(-1);
    scene = withShaft(scene, {
      id: 'shaft_w2',
      placement: {
        kind: 'skew',
        parentGearId: 'gear_h',
        childGearId: 'gear_w2',
        axisStep: 2,
        side: 1,
      },
    });
    scene = withGear(scene, {
      id: 'gear_w2',
      kind: 'worm',
      shaftId: 'shaft_w2',
      size: 'M',
      teeth: 1,
      offset: 0,
    });
    expect(validateScene(scene)).toEqual({ ok: true });
    const layout = resolveLayout(scene);
    expect(layout.meshes.map((m) => m.kind)).toEqual(['worm', 'worm']);
    const motion = solve(scene, layout);
    expect(motion.locks.map((l) => l.reason)).toEqual(['wormBackDrive']);
  });

  it('閉路: 2 つのウォームで区画 A → B、B → A → まとめて 1 区画として解き、ギア比が合わなければ段階 1 の矛盾でロック', () => {
    const root = (id: string, origin: Vec3, axis: 'x' | 'z'): Shaft => ({
      id,
      placement: { kind: 'root', origin, axis },
    });
    const gear = (id: string, shaftId: string, kind: Gear['kind'], teeth: number, offset: number) =>
      ({ id, shaftId, kind, size: 'M', teeth, offset }) as Gear;
    const scene: Scene = {
      shafts: {
        shaft_a: root('shaft_a', [0, 0, 0], 'x'),
        shaft_b: root('shaft_b', [16, -40, -4], 'z'),
        shaft_c: root('shaft_c', [200, 0, 0], 'x'),
        shaft_d: root('shaft_d', [216, -40, -4], 'z'),
      },
      gears: {
        gear_w1: gear('gear_w1', 'shaft_a', 'worm', 1, 0),
        gear_p4: gear('gear_p4', 'shaft_a', 'spur', 20, 40),
        gear_h1: gear('gear_h1', 'shaft_b', 'wormWheel', 30, 0),
        gear_p1: gear('gear_p1', 'shaft_b', 'spur', 20, 20),
        gear_w2: gear('gear_w2', 'shaft_c', 'worm', 1, 0),
        gear_p2: gear('gear_p2', 'shaft_c', 'spur', 20, 40),
        gear_h2: gear('gear_h2', 'shaft_d', 'wormWheel', 30, 0),
        gear_p3: gear('gear_p3', 'shaft_d', 'spur', 20, 20),
      },
      motors: { motor_a: motor('motor_a', 'shaft_a') },
      anchors: {},
      carriers: {},
      racks: {},
    };
    // A（W1）→ B（H1）、B（P1）— C（P2）、C（W2）→ D（H2）、D（P3）— A（P4）の機構（かみ合いだけを与える）
    const meshes: Mesh[] = [
      { a: 'gear_h1', b: 'gear_w1', source: 'tree', kind: 'worm' },
      { a: 'gear_p1', b: 'gear_p2', source: 'tree', kind: 'spur' },
      { a: 'gear_h2', b: 'gear_w2', source: 'tree', kind: 'worm' },
      { a: 'gear_p3', b: 'gear_p4', source: 'tree', kind: 'spur' },
    ];
    const graph = buildMeshGraph(scene, meshes);
    const component = graph.components[0];
    if (component === undefined) throw new Error('成分が無い');
    const sections = wormSections(scene, component);
    expect(sections?.sections).toEqual([
      { shaftIds: ['shaft_a', 'shaft_b', 'shaft_c', 'shaft_d'], incoming: false },
    ]);
    expect(component.dof).toBe(0);
    const layout: Layout = { ...resolveLayout(scene), meshes };
    const motion = solve(scene, layout);
    expect(motion.locks.map((l) => l.reason)).toEqual(['contradiction']);
  });
});

describe('位相', () => {
  it('接点でウォームのねじ山の中心とホイールの歯溝の中心が重なり、回しても保たれる', () => {
    for (const scene of [
      wormBasic,
      wheelPlacement(1),
      wheelPlacement(1, 1),
      wheelPlacement(-1, 1),
    ]) {
      const layout = resolveLayout(scene);
      const w = layout.gears.gear_w;
      const h = layout.gears.gear_h;
      if (w === undefined || h === undefined) throw new Error('レイアウトが無い');
      const d = sub(h.center, w.center);
      const thetaC = angleAround(w.axis, d);
      const alphaC = angleAround(h.axis, [-d[0], -d[1], -d[2]]);
      const s = skewSign(w.axis, w.center, h.axis, h.center);
      // z·(φ_H − α_c)/2π + 1/2 − s·(θ_c − φ_W)/2π が整数
      const mismatch = (phiW: number, phiH: number) => {
        const x = (30 * (phiH - alphaC)) / TWO_PI + 0.5 - (s * (thetaC - phiW)) / TWO_PI;
        return Math.abs(x - Math.round(x));
      };
      expect(mismatch(w.basePhase, h.basePhase)).toBeLessThan(1e-9);
      // ω_H = −s·ω_W / 30 で回す
      const turn = 1.234;
      expect(mismatch(w.basePhase + turn, h.basePhase - (s * turn) / 30)).toBeLessThan(1e-9);
    }
  });

  it('ホイールを親にしたウォームの位相も同じ関係を満たす', () => {
    const scene: Scene = {
      shafts: {
        shaft_h: { id: 'shaft_h', placement: { kind: 'root', origin: [0, 40, 0], axis: 'z' } },
        shaft_w: {
          id: 'shaft_w',
          placement: {
            kind: 'skew',
            parentGearId: 'gear_h',
            childGearId: 'gear_w',
            axisStep: 1,
            side: 1,
          },
        },
      },
      gears: {
        gear_h: {
          id: 'gear_h',
          kind: 'wormWheel',
          shaftId: 'shaft_h',
          size: 'M',
          teeth: 30,
          offset: 0,
        },
        gear_w: { id: 'gear_w', kind: 'worm', shaftId: 'shaft_w', size: 'M', teeth: 1, offset: 0 },
      },
      motors: {},
      anchors: {},
      carriers: {},
      racks: {},
    };
    expect(validateScene(scene)).toEqual({ ok: true });
    const layout = resolveLayout(scene);
    // H の中心 [0, 40, 4]、W の軸 x、u は y → W の中心 [0, 80, 4]、原点 [-16, 80, 4]
    expectVec(layout.gears.gear_w?.center, [0, 80, 4]);
    expectVec(layout.shafts.shaft_w?.origin, [-16, 80, 4]);
    const w = layout.gears.gear_w;
    const h = layout.gears.gear_h;
    if (w === undefined || h === undefined) throw new Error('レイアウトが無い');
    const d = sub(h.center, w.center);
    const s = skewSign(w.axis, w.center, h.axis, h.center);
    const x =
      (30 * (h.basePhase - angleAround(h.axis, [-d[0], -d[1], -d[2]]))) / TWO_PI +
      0.5 -
      (s * (angleAround(w.axis, d) - w.basePhase)) / TWO_PI;
    expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-9);
  });
});

describe('候補', () => {
  const spec = {
    perimeterTeeth: 20,
    coaxialSize: 'M',
    coaxialTeeth: 20,
    coaxialKind: 'spur',
  } as const;

  it('ウォームを選ぶ → ホイールの skew の候補（4 か所のうち干渉しないもの）。外周の候補は出さない', () => {
    const candidates = listGrowCandidates(wormBasic, 'gear_w', spec);
    expect(candidates.some((c) => c.kind === 'perimeter')).toBe(false);
    const skew = candidates.filter((c) => c.kind === 'skew');
    expect(skew.length).toBeGreaterThanOrEqual(1);
    expect(skew.length).toBeLessThanOrEqual(4);
    for (const c of skew) {
      expect(c.shape).toEqual({ kind: 'wormWheel' });
      expect(c.teeth).toBe(20);
      expect(c.size).toBe('M');
      expect(c.axis).not.toBe('x');
    }
    // 既にある H と同じ場所（axisStep 2・side −1）は干渉するので出ない
    expect(skew.some((c) => c.kind === 'skew' && c.axisStep === 2 && c.side === -1)).toBe(false);
  });

  it('候補をクリックしたのと同じコマンド → skew のシャフトにホイールが生え、干渉なし', () => {
    const candidate = listGrowCandidates(wormBasic, 'gear_w', spec).find((c) => c.kind === 'skew');
    if (candidate?.kind !== 'skew') throw new Error('skew の候補が無い');
    const scene = apply(wormBasic, {
      type: 'growGear',
      mode: 'skew',
      parentGearId: 'gear_w',
      axisStep: candidate.axisStep,
      side: candidate.side,
      teeth: candidate.teeth,
    });
    expect(validateScene(scene)).toEqual({ ok: true });
    const added = Object.values(scene.gears).find((g) => !(g.id in wormBasic.gears)) as Gear;
    expect(added.kind).toBe('wormWheel');
    expect(scene.shafts[added.shaftId]?.placement.kind).toBe('skew');
    const layout = resolveLayout(scene);
    expectVec(layout.gears[added.id]?.center, candidate.center);
    expect(layout.gears[added.id]?.basePhase).toBeCloseTo(candidate.basePhase, 12);
    expect(layout.interferences).toEqual([]);
  });

  it('ホイールを選ぶ → ウォームの skew の候補（1 条）', () => {
    const candidates = listGrowCandidates(wormBasic, 'gear_h', spec);
    const skew = candidates.filter((c) => c.kind === 'skew');
    expect(skew.length).toBeGreaterThanOrEqual(1);
    for (const c of skew) {
      expect(c.shape).toEqual({ kind: 'worm' });
      expect(c.teeth).toBe(1);
    }
    expect(candidates.some((c) => c.kind === 'perimeter')).toBe(false);
  });

  it('同じ軸の候補でウォーム・ホイールを作れる（ウォームは区画の幅 32 で、1 条）', () => {
    const worm = listGrowCandidates(wormOnly, 'gear_w', { ...spec, coaxialKind: 'worm' }).filter(
      (c) => c.kind === 'coaxial',
    );
    expect(worm.map((c) => (c.kind === 'coaxial' ? c.offset : null))).toEqual([-32, 32]);
    for (const c of worm) {
      expect(c.shape).toEqual({ kind: 'worm' });
      expect(c.teeth).toBe(1);
    }
    const wheel = listGrowCandidates(wormOnly, 'gear_w', {
      ...spec,
      coaxialKind: 'wormWheel',
    }).filter((c) => c.kind === 'coaxial');
    expect(wheel.map((c) => (c.kind === 'coaxial' ? c.offset : null))).toEqual([-8, 32]);
    for (const c of wheel) expect(c.shape).toEqual({ kind: 'wormWheel' });
  });
});

describe('contact と干渉', () => {
  it('木の親子でないウォームとホイールがちょうどの位置 → contact のかみ合い', () => {
    // H と同じ場所に、root のシャフトで別のホイールを置く代わりに、W と同じ場所に root のウォームを置き直す
    const scene: Scene = {
      shafts: {
        shaft_w: { id: 'shaft_w', placement: { kind: 'root', origin: [0, 80, 0], axis: 'x' } },
        shaft_h: { id: 'shaft_h', placement: { kind: 'root', origin: [16, 40, -4], axis: 'z' } },
      },
      gears: {
        gear_w: { id: 'gear_w', kind: 'worm', shaftId: 'shaft_w', size: 'M', teeth: 1, offset: 0 },
        gear_h: {
          id: 'gear_h',
          kind: 'wormWheel',
          shaftId: 'shaft_h',
          size: 'M',
          teeth: 30,
          offset: 0,
        },
      },
      motors: { motor_m: motor('motor_m', 'shaft_w') },
      anchors: {},
      carriers: {},
      racks: {},
    };
    const layout = resolveLayout(scene);
    expect(layout.meshes).toEqual([{ a: 'gear_h', b: 'gear_w', source: 'contact', kind: 'worm' }]);
    expect(layout.interferences).toEqual([]);
    expect(solve(scene, layout).omegas.shaft_h).toBeCloseTo(TWO_PI / 30, 9);

    // 中心を結ぶ線が軸に直交しない（ホイールを z 方向に 4 ずらす）→ かみ合いでなく干渉
    const shifted = withShaft(scene, {
      id: 'shaft_h',
      placement: { kind: 'root', origin: [16, 40, 0], axis: 'z' },
    });
    const l2 = resolveLayout(shifted);
    expect(l2.meshes).toEqual([]);
    expect(l2.interferences).toContainEqual(['gear_h', 'gear_w']);
  });

  it('ウォームの円柱は半径 5m + m、長さ 5πm（区画の幅ではない）', () => {
    // W の円柱は x ∈ [16 − 5π, 16 + 5π] ≈ [0.29, 31.7]。区画の端（x = 32）の外に置いた平歯車とは干渉しない
    const scene = apply(wormOnly, {
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_w',
      offset: 32,
      size: 'M',
      teeth: 20,
    });
    expect(resolveLayout(scene).interferences).toEqual([]);
  });
});

describe('かみ合える組と検証', () => {
  const w = wormBasic.gears.gear_w as Gear;
  const h = wormBasic.gears.gear_h as Gear;

  it('canMesh: ウォームとホイール（同じ大きさ）だけ', () => {
    expect(canMesh(w, h)).toBe(true);
    expect(canMesh(h, w)).toBe(true);
    expect(canMesh(w, w)).toBe(false);
    expect(canMesh(h, h)).toBe(false);
    expect(canMesh(w, { ...h, kind: 'spur' } as Gear)).toBe(false);
    expect(canMesh(w, { ...h, size: 'S' })).toBe(false);
  });

  it('ウォームの teeth は 1 だけ、skew の親子はウォームとホイール、axisStep・side の範囲', () => {
    const codes = (scene: Scene) => {
      const r = validateScene(scene);
      return r.ok ? [] : r.errors.map((e) => e.code);
    };
    expect(codes(withGear(wormBasic, { ...w, teeth: 2 }))).toEqual(['teethOutOfRange']);
    expect(codes(withGear(wormBasic, { ...h, kind: 'spur' } as Gear))).toEqual([
      'meshKindMismatch',
    ]);
    const placement = wormBasic.shafts.shaft_h?.placement;
    if (placement?.kind !== 'skew') throw new Error('skew でない');
    expect(
      codes(withShaft(wormBasic, { id: 'shaft_h', placement: { ...placement, axisStep: 0 as 1 } })),
    ).toEqual(['invalidAxisStep']);
    expect(
      codes(withShaft(wormBasic, { id: 'shaft_h', placement: { ...placement, side: 2 as 1 } })),
    ).toEqual(['invalidSide']);
    // ウォームとホイールを外周（mesh）でつなぐのは不可
    expect(
      codes(
        withShaft(wormBasic, {
          id: 'shaft_h',
          placement: { kind: 'mesh', parentGearId: 'gear_w', childGearId: 'gear_h', angle: 0 },
        }),
      ),
    ).toEqual(['meshKindMismatch']);
  });

  it('コマンド: ウォームの歯数は変えられない。起点・同じ軸のウォームは歯数によらず 1 条', () => {
    const r = applyCommand(
      wormBasic,
      { type: 'setGearTeeth', gearId: 'gear_w', teeth: 20 },
      { ids: createSequentialIdGenerator() },
    );
    expect(r.ok ? null : r.error.code).toBe('notAllowed');
    const root = apply(wormBasic, {
      type: 'addRootShaft',
      axis: 'y',
      origin: [200, 50, 0],
      gear: { size: 'S', teeth: 30, kind: 'worm' },
    });
    const added = Object.values(root.gears).find((g) => !(g.id in wormBasic.gears)) as Gear;
    expect(added).toMatchObject({ kind: 'worm', teeth: 1, size: 'S' });
    expect(validateScene(root)).toEqual({ ok: true });
    const r2 = applyCommand(
      wormBasic,
      { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_w', angle: 0, teeth: 20 },
      { ids: createSequentialIdGenerator() },
    );
    expect(r2.ok ? null : r2.error.code).toBe('notAllowed');
  });
});
