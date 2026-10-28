import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEETH } from '../constants';
import { applyCommand, type Command, type CommandContext } from '../edit/commands';
import { emptyHistory, execute, undo } from '../edit/history';
import { defaultPlanetTeeth, planetaryConditions } from '../geometry/planetary';
import { solveBalance } from '../kinematics/balance';
import {
  anchoredMeshGraphOf,
  initialMotionState,
  solveMotion,
  stepMotion,
} from '../kinematics/motion';
import { radPerSecToRpm, rpmToRadPerSec } from '../kinematics/motor';
import type { MotionState } from '../kinematics/types';
import { axisFrame } from '../math/axis';
import { dot, length, sub, type Vec3 } from '../math/vec3';
import { makeGear } from '../scene/gear-shape';
import { createSequentialIdGenerator } from '../scene/ids';
import { planetShaftsOf } from '../scene/scene';
import type { Gear, Scene } from '../scene/types';
import { validateScene } from '../scene/validate';
import { listGrowCandidates } from './candidates';
import { resolveLayout } from './resolve';
import { gearWorldCenter, shaftWorldOrigin } from './world';

// S3-03: 遊星歯車とキャリア。共通: 中、z_s = 24、z_p = 12、z_r = 48、n = 3（公転半径 36）

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

function ctx(): CommandContext {
  return { ids: createSequentialIdGenerator() };
}

function apply(scene: Scene, command: Command, context: CommandContext = ctx()): Scene {
  const result = applyCommand(scene, command, context);
  if (!result.ok) throw new Error(result.error.message);
  return result.scene;
}

function rejected(scene: Scene, command: Command): boolean {
  return !applyCommand(scene, command, ctx()).ok;
}

function solve(scene: Scene): MotionState {
  return solveMotion(scene, resolveLayout(scene), initialMotionState());
}

function rpm(motion: MotionState, shaftId: string): number {
  return radPerSecToRpm(motion.omegas[shaftId] ?? Number.NaN);
}

// planetary-ring-fixed: shaft_s（起点 [0, 60, 0]、縦）に中・24 歯 gear_s とモーター 60 rpm。キャリア carrier_k（shaft_k）、
// 遊星 gear_p0〜p2（shaft_p0〜p2、中・12 歯）、リング gear_r（shaft_r、中・48 歯）。リングのシャフトに固定具 anchor_r
const ringFixed = fixture('planetary-ring-fixed');
const PLANETS = ['shaft_p0', 'shaft_p1', 'shaft_p2'] as const;

function withoutAnchors(scene: Scene): Scene {
  return { ...scene, anchors: {} };
}

function anchored(scene: Scene, ...shaftIds: string[]): Scene {
  let next = scene;
  for (const shaftId of shaftIds) next = apply(next, { type: 'addAnchor', shaftId });
  return next;
}

function moveMotor(scene: Scene, shaftId: string): Scene {
  const motor = scene.motors.motor_s;
  if (motor === undefined) throw new Error('no motor');
  return { ...scene, motors: { motor_s: { ...motor, shaftId } } };
}

// 太陽だけのシーン（中・24 歯、shaft_sun は起点 [0, 60, 0]）
function sunOnly(teeth = 24, size: Gear['size'] = 'M'): Scene {
  return {
    shafts: {
      shaft_sun: { id: 'shaft_sun', placement: { kind: 'root', origin: [0, 60, 0], axis: 'y' } },
    },
    gears: {
      gear_sun: makeGear(
        { id: 'gear_sun', shaftId: 'shaft_sun', size, teeth, offset: 0 },
        { kind: 'spur' },
      ),
    },
    motors: {},
    anchors: {},
    carriers: {},
  };
}

// 太陽だけのシーンから growGear（planetary）で作った機構。ID は順に shaft_1（キャリアのシャフト）、carrier_1、
// shaft_2〜4（遊星のシャフト、angle 0・2π/3・4π/3）と gear_1〜3、shaft_5（リングのシャフト）と gear_4（リング）
// context を渡すと、続けて使うコマンドの ID が重ならない
function grown(context: CommandContext = ctx()): Scene {
  return apply(
    sunOnly(),
    { type: 'growGear', mode: 'planetary', parentGearId: 'gear_sun' },
    context,
  );
}

// 軸 y の歯車の、中心から見た角度 a の向きでの歯の位置（ピッチを 1 とした端数）
function toothFraction(phase: number, teeth: number, angle: number): number {
  const raw = ((angle - phase) * teeth) / (2 * Math.PI);
  return raw - Math.floor(raw);
}

function angleAround(center: Vec3, p: Vec3): number {
  const { u, v } = axisFrame('y');
  const d = sub(p, center);
  return Math.atan2(dot(d, v), dot(d, u));
}

function radial(p: Vec3, q: Vec3): number {
  return Math.hypot(p[0] - q[0], p[2] - q[2]);
}

describe('planetaryConditions', () => {
  it('(24, 12, 48, 3) はすべて真', () => {
    expect(planetaryConditions(24, 12, 48, 3)).toEqual({
      equalSpacing: true,
      concentric: true,
      clearance: true,
    });
  });
  it('(20, 12, 44, 3) は equalSpacing が偽', () => {
    expect(planetaryConditions(20, 12, 44, 3).equalSpacing).toBe(false);
  });
  it('(12, 30, 72, 4) は clearance が偽（42·sin45° ≈ 29.7 < 32）', () => {
    expect(planetaryConditions(12, 30, 72, 4).clearance).toBe(false);
  });
});

describe('defaultPlanetTeeth', () => {
  const sun = (size: Gear['size'], teeth: number) =>
    makeGear({ id: 'g', shaftId: 's', size, teeth, offset: 0 }, { kind: 'spur' });
  it('中・24 歯 → { zp: 12, zr: 48 }', () => {
    expect(defaultPlanetTeeth(sun('M', 24), 3)).toEqual({ zp: 12, zr: 48 });
  });
  it('中・20 歯 → { zp: 13, zr: 46 }', () => {
    expect(defaultPlanetTeeth(sun('M', 20), 3)).toEqual({ zp: 13, zr: 46 });
  });
  it('大・12 歯 → { zp: 12, zr: 36 }', () => {
    expect(defaultPlanetTeeth(sun('L', 12), 3)).toEqual({ zp: 12, zr: 36 });
  });
  it('大・16 歯 → null', () => {
    expect(defaultPlanetTeeth(sun('L', 16), 3)).toBeNull();
  });
});

describe('運動学（ウィリスの式）', () => {
  it('フィクスチャはシーンの検証を通る', () => {
    expect(validateScene(ringFixed)).toEqual({ ok: true });
  });

  it('零空間: 固定具なし → 次元 2。リングを固定 → 1', () => {
    const free = withoutAnchors(ringFixed);
    const freeGraph = anchoredMeshGraphOf(free, resolveLayout(free));
    expect(freeGraph.components.map((c) => c.dof)).toEqual([2]);
    const graph = anchoredMeshGraphOf(ringFixed, resolveLayout(ringFixed));
    expect(graph.components.map((c) => c.dof)).toEqual([1]);
  });

  it('リング固定・太陽 60 → キャリア 20、遊星 −60（自転、ワールドに対して）、リング 0', () => {
    const motion = solve(ringFixed);
    expect(rpm(motion, 'shaft_s')).toBeCloseTo(60, 9);
    expect(rpm(motion, 'shaft_k')).toBeCloseTo(20, 9);
    for (const id of PLANETS) expect(rpm(motion, id)).toBeCloseTo(-60, 9);
    expect(rpm(motion, 'shaft_r')).toBeCloseTo(0, 9);
    expect(motion.locks).toEqual([]);
  });

  it('キャリア固定・太陽 60 → リング −30、遊星 −120', () => {
    const motion = solve(anchored(withoutAnchors(ringFixed), 'shaft_k'));
    expect(rpm(motion, 'shaft_k')).toBeCloseTo(0, 9);
    expect(rpm(motion, 'shaft_r')).toBeCloseTo(-30, 9);
    for (const id of PLANETS) expect(rpm(motion, id)).toBeCloseTo(-120, 9);
  });

  it('太陽固定・リングにモーター 60 → キャリア 40', () => {
    const scene = anchored(moveMotor(withoutAnchors(ringFixed), 'shaft_r'), 'shaft_s');
    const motion = solve(scene);
    expect(rpm(motion, 'shaft_r')).toBeCloseTo(60, 9);
    expect(rpm(motion, 'shaft_k')).toBeCloseTo(40, 9);
    expect(rpm(motion, 'shaft_s')).toBeCloseTo(0, 9);
  });

  describe('固定なし・太陽 60 だけ → ω の二乗和が最小の解', () => {
    // 拘束から ω_p = 3ω_c − 120、ω_r = 1.5ω_c − 30。f = ω_c² + 3·ω_p² + ω_r² を最小にすると 60.5·ω_c = 2250
    const carrier = 2250 / 60.5;
    const ring = 1.5 * carrier - 30;
    const planet = 3 * carrier - 120;
    const free = withoutAnchors(ringFixed);

    it('キャリア ≈ 37.190、リング ≈ 25.785、遊星 ≈ −8.430（3 本とも）。ロックしない', () => {
      const motion = solve(free);
      expect(carrier).toBeCloseTo(37.19, 2);
      expect(ring).toBeCloseTo(25.785, 2);
      expect(planet).toBeCloseTo(-8.43, 2);
      expect(rpm(motion, 'shaft_s')).toBeCloseTo(60, 6);
      expect(rpm(motion, 'shaft_k')).toBeCloseTo(carrier, 2);
      expect(rpm(motion, 'shaft_r')).toBeCloseTo(ring, 2);
      for (const id of PLANETS) expect(rpm(motion, id)).toBeCloseTo(planet, 2);
      expect(motion.locks).toEqual([]);
    });

    it('2 つの拘束の式を満たす', () => {
      const motion = solve(free);
      const [s, c, r] = ['shaft_s', 'shaft_k', 'shaft_r'].map((id) => motion.omegas[id] ?? 0);
      for (const id of PLANETS) {
        const p = motion.omegas[id] ?? 0;
        expect(24 * ((s as number) - (c as number)) + 12 * (p - (c as number))).toBeCloseTo(0, 9);
        expect(12 * (p - (c as number)) - 48 * ((r as number) - (c as number))).toBeCloseTo(0, 9);
      }
    });

    it('N の基底を入れ替えても同じ値', () => {
      const graph = anchoredMeshGraphOf(free, resolveLayout(free));
      const component = graph.components[0];
      if (component === undefined) throw new Error('no component');
      const drives = component.shaftIds.map((id) =>
        id === 'shaft_s' ? { damping: 3 / rpmToRadPerSec(60), bias: 3 } : { damping: 0, bias: 0 },
      );
      // 列を入れ替え、混ぜた基底（N' = N·T、T は正則）
      const mixed = component.basis.map((row) => [
        (row[1] as number) + 2 * (row[0] as number),
        (row[0] as number) - (row[1] as number),
      ]);
      const a = solveBalance(component.basis, drives).omegas;
      const b = solveBalance(mixed, drives).omegas;
      a.forEach((w, i) => {
        expect(b[i]).toBeCloseTo(w, 9);
      });
      const k = component.shaftIds.indexOf('shaft_k');
      expect(radPerSecToRpm(a[k] as number)).toBeCloseTo(carrier, 2);
    });
  });

  it('固定具との矛盾: リングとキャリアを両方固定して太陽にモーター → ロック（anchor）', () => {
    const motion = solve(anchored(ringFixed, 'shaft_k'));
    expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
  });
});

describe('レイアウト（基準配置と公転）', () => {
  it('基準配置: 遊星 0 番のシャフトの原点は太陽の中心から距離 36、orbit.carrierShaftId がキャリアのシャフト', () => {
    const layout = resolveLayout(ringFixed);
    const sun = layout.gears.gear_s?.center as Vec3;
    const p0 = layout.shafts.shaft_p0;
    expect(radial(p0?.origin as Vec3, sun)).toBeCloseTo(36, 9);
    expect(length(sub(layout.gears.gear_p0?.center as Vec3, sun))).toBeCloseTo(36, 9);
    expect(p0?.orbit?.carrierShaftId).toBe('shaft_k');
    expect(p0?.orbit?.carrierId).toBe('carrier_k');
    expect(layout.carriers.carrier_k?.planetShaftIds).toEqual(['shaft_p0', 'shaft_p1', 'shaft_p2']);
  });

  it('公転: リング固定・太陽 60 で 1.5 秒積分 → キャリアの角度 π、遊星 0 番は太陽の中心をはさんで反対側', () => {
    const layout = resolveLayout(ringFixed);
    let motion = solveMotion(ringFixed, layout, initialMotionState());
    for (let i = 0; i < 90; i++) motion = stepMotion(ringFixed, layout, motion, 1 / 60);
    expect(motion.angles.shaft_k).toBeCloseTo(Math.PI, 9);
    const base = layout.shafts.shaft_p0?.origin as Vec3;
    const world = shaftWorldOrigin(layout, motion, 'shaft_p0');
    // 太陽の軸（x = 0、z = 0）について点対称
    expect(world[0]).toBeCloseTo(-base[0], 9);
    expect(world[1]).toBeCloseTo(base[1], 9);
    expect(world[2]).toBeCloseTo(-base[2], 9);
    const center = gearWorldCenter(layout, motion, 'gear_p0');
    const sun = layout.gears.gear_s?.center as Vec3;
    expect(radial(center, sun)).toBeCloseTo(36, 9);
  });

  it('位相: リングと 3 つの遊星が contact でかみ合い、interferences が空。接点の歯の位置がすべて 0.5 ずれる', () => {
    const layout = resolveLayout(ringFixed);
    expect(layout.interferences).toEqual([]);
    const ringMeshes = layout.meshes.filter((m) => m.a === 'gear_r' || m.b === 'gear_r');
    expect(ringMeshes.map((m) => [m.a, m.b, m.source, m.kind])).toEqual([
      ['gear_p0', 'gear_r', 'contact', 'internal'],
      ['gear_p1', 'gear_r', 'contact', 'internal'],
      ['gear_p2', 'gear_r', 'contact', 'internal'],
    ]);
    const ring = layout.gears.gear_r;
    if (ring === undefined) throw new Error('no ring');
    for (const id of ['gear_p0', 'gear_p1', 'gear_p2']) {
      const planet = layout.gears[id];
      if (planet === undefined) throw new Error(`no ${id}`);
      const contact = angleAround(ring.center, planet.center); // リングから見た遊星（接点）の向き
      const fRing = toothFraction(ring.basePhase, 48, contact);
      const fPlanet = toothFraction(planet.basePhase, 12, contact);
      const diff = fRing - fPlanet - Math.floor(fRing - fPlanet);
      expect(diff).toBeCloseTo(0.5, 9);
    }
  });

  it('位相の合わない組（20, 12, 44）を手で組む → 3 組とも meshes に入り、interferences には入らない', () => {
    const gears = { ...ringFixed.gears };
    gears.gear_s = { ...(gears.gear_s as Gear), teeth: 20 };
    gears.gear_r = { ...(gears.gear_r as Gear), teeth: 44 };
    const scene: Scene = { ...withoutAnchors(ringFixed), gears };
    expect(validateScene(scene)).toEqual({ ok: true });
    const layout = resolveLayout(scene);
    const ringMeshes = layout.meshes.filter((m) => m.a === 'gear_r' || m.b === 'gear_r');
    expect(ringMeshes).toHaveLength(3);
    expect(layout.interferences).toEqual([]);
    expect(planetaryConditions(20, 12, 44, 3).equalSpacing).toBe(false);
  });
});

describe('候補と編集', () => {
  const spec = {
    perimeterTeeth: DEFAULT_TEETH.M,
    coaxialSize: 'M' as const,
    coaxialTeeth: DEFAULT_TEETH.M,
    coaxialKind: 'spur' as const,
  };

  it('候補: 中・24 歯の太陽から作った機構が共通の値になる。Undo 1 回で全部消える', () => {
    const scene = sunOnly();
    const candidates = listGrowCandidates(scene, 'gear_sun', spec);
    const planetary = candidates.filter((c) => c.kind === 'planetary');
    expect(planetary).toHaveLength(1);
    const state = { scene, history: emptyHistory() };
    const result = execute(
      state,
      { type: 'growGear', mode: 'planetary', parentGearId: 'gear_sun' },
      ctx(),
    );
    if (!result.ok) throw new Error(result.error.message);
    const next = result.state.scene;
    expect(Object.keys(next.carriers)).toHaveLength(1);
    const carrierId = Object.keys(next.carriers)[0] as string;
    const planets = planetShaftsOf(next, carrierId);
    expect(planets).toHaveLength(3);
    const planetGears = Object.values(next.gears).filter((g) =>
      planets.some((s) => s.id === g.shaftId),
    );
    expect(planetGears.map((g) => [g.size, g.teeth])).toEqual([
      ['M', 12],
      ['M', 12],
      ['M', 12],
    ]);
    const ring = Object.values(next.gears).find((g) => g.kind === 'internal');
    expect(ring?.teeth).toBe(48);
    expect(ring).toMatchObject({ webSide: -1, offset: 0 });
    const layout = resolveLayout(next);
    expect(layout.interferences).toEqual([]);
    const sun = layout.gears.gear_sun?.center as Vec3;
    for (const s of planets)
      expect(radial(layout.shafts[s.id]?.origin as Vec3, sun)).toBeCloseTo(36, 9);
    expect(validateScene(next)).toEqual({ ok: true });
    expect(undo(result.state)?.scene).toBe(scene);
  });

  it('遊星の数: n = 4 は受け付けて π/2 おき。n = 5 は拒否', () => {
    const context = ctx();
    const scene = grown(context);
    const four = apply(
      scene,
      { type: 'setPlanetCount', carrierId: 'carrier_1', count: 4 },
      context,
    );
    const shafts = planetShaftsOf(four, 'carrier_1');
    expect(shafts).toHaveLength(4);
    shafts.forEach((s, k) => {
      expect(s.placement.kind === 'planet' ? s.placement.angle : -1).toBeCloseTo(
        (k * Math.PI) / 2,
        12,
      );
    });
    expect(resolveLayout(four).interferences).toEqual([]);
    expect(rejected(scene, { type: 'setPlanetCount', carrierId: 'carrier_1', count: 5 })).toBe(
      true,
    );
  });

  it('歯数: 遊星を 18 歯に → リングが 60 歯（全遊星 18 歯）。太陽を 25 歯は拒否。リングの直接の変更も拒否', () => {
    const scene = grown();
    const next = apply(scene, { type: 'setGearTeeth', gearId: 'gear_2', teeth: 18 });
    expect(next.gears.gear_4?.teeth).toBe(60);
    expect(['gear_1', 'gear_2', 'gear_3'].map((id) => next.gears[id]?.teeth)).toEqual([18, 18, 18]);
    expect(resolveLayout(next).interferences).toEqual([]);
    expect(rejected(scene, { type: 'setGearTeeth', gearId: 'gear_sun', teeth: 25 })).toBe(true);
    expect(rejected(scene, { type: 'setGearTeeth', gearId: 'gear_4', teeth: 50 })).toBe(true);
  });

  it('遊星のシャフトにモーター・固定具を付けるコマンドは拒否。遊星の歯車からの候補は同じ軸のものだけ', () => {
    const scene = grown();
    expect(rejected(scene, { type: 'addMotor', shaftId: 'shaft_2', size: 'M' })).toBe(true);
    expect(rejected(scene, { type: 'addAnchor', shaftId: 'shaft_2' })).toBe(true);
    expect(
      rejected(scene, {
        type: 'growGear',
        mode: 'perimeter',
        parentGearId: 'gear_1',
        angle: 0,
        teeth: 20,
      }),
    ).toBe(true);
    // 小・12 歯なら遊星の下（リングの空洞の中）に段付きの遊星を置ける
    const small = { ...spec, coaxialSize: 'S' as const, coaxialTeeth: 12 };
    const kinds = listGrowCandidates(scene, 'gear_1', small).map((c) => c.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(['coaxial']));
    // パレットで内歯車を選んでいても、囲む候補・遊星歯車機構の候補は出ない
    const withInternal = listGrowCandidates(scene, 'gear_1', { ...small, coaxialKind: 'internal' });
    expect(withInternal.filter((c) => c.kind !== 'coaxial')).toEqual([]);
  });

  it('削除: キャリアを消す → 遊星のシャフトが detached になり、位置が消す前の基準配置と同じ', () => {
    const scene = grown();
    const before = resolveLayout(scene);
    const next = apply(scene, { type: 'deleteParts', ids: ['carrier_1'] });
    expect(next.carriers).toEqual({});
    for (const id of ['shaft_2', 'shaft_3', 'shaft_4']) {
      const p = next.shafts[id]?.placement;
      expect(p?.kind).toBe('detached');
      expect(p?.kind === 'detached' ? p.origin : null).toEqual(before.shafts[id]?.origin);
    }
    // 歯車もほかのキャリアも残らないキャリアのシャフトは消える
    expect(next.shafts.shaft_1).toBeUndefined();
    expect(validateScene(next)).toEqual({ ok: true });
  });

  it('削除: 太陽歯車を消す → 遊星のシャフトは detached、同じ線上のシャフトもその場に残る', () => {
    const scene = grown();
    const next = apply(scene, { type: 'deleteParts', ids: ['gear_sun'] });
    expect(validateScene(next)).toEqual({ ok: true });
    for (const id of ['shaft_2', 'shaft_3', 'shaft_4', 'shaft_1', 'shaft_5']) {
      expect(next.shafts[id]?.placement.kind).toBe('detached');
    }
  });
});

describe('干渉', () => {
  it('太陽・キャリア・リングのシャフト（同じ線上）は互いに干渉しない', () => {
    const layout = resolveLayout(grown());
    expect(layout.interferences).toEqual([]);
    // 3 本のシャフトは同じ線上で、軸方向に重なる区間がある（太陽とキャリア）
    const sun = layout.shafts.shaft_sun;
    const carrier = layout.shafts.shaft_1;
    expect(sun?.origin).toEqual(carrier?.origin);
    expect(Math.min(sun?.span[1] ?? 0, carrier?.span[1] ?? 0)).toBeGreaterThan(
      Math.max(sun?.span[0] ?? 0, carrier?.span[0] ?? 0),
    );
  });

  it('機構の外、公転半径の範囲にある別の歯車 → 干渉に入る', () => {
    const scene = grown();
    // 遊星 0 番（angle 0）と 1 番（2π/3）の間、公転半径 36 の位置の小さな歯車（基準配置ではどの部品とも重ならない）
    const a = Math.PI / 3;
    const { u, v } = axisFrame('y');
    const at: Vec3 = [
      36 * (Math.cos(a) * u[0] + Math.sin(a) * v[0]),
      60,
      36 * (Math.cos(a) * u[2] + Math.sin(a) * v[2]),
    ];
    const next: Scene = {
      ...scene,
      shafts: {
        ...scene.shafts,
        shaft_x: { id: 'shaft_x', placement: { kind: 'root', origin: at, axis: 'y' } },
      },
      gears: {
        ...scene.gears,
        gear_x: makeGear(
          { id: 'gear_x', shaftId: 'shaft_x', size: 'S', teeth: 12, offset: 0 },
          { kind: 'spur' },
        ),
      },
    };
    const interferences = resolveLayout(next).interferences;
    const withX = interferences.filter(([p, q]) => p === 'gear_x' || q === 'gear_x');
    expect(
      withX.some(([p, q]) => ['gear_1', 'gear_2', 'gear_3'].includes(p === 'gear_x' ? q : p)),
    ).toBe(true);
  });
});

describe('手で回す', () => {
  it('固定なし（自由度 2）でキャリアのシャフトをつかむ → キャリアが手の角度、残りはつり合いで決まる', () => {
    const free = withoutAnchors(ringFixed);
    const layout = resolveLayout(free);
    const motion = stepMotion(free, layout, initialMotionState(), 1 / 60, {
      hand: { shaftId: 'shaft_k', angle: 0.2 },
    });
    expect(motion.angles.shaft_k).toBeCloseTo(0.2, 9);
    // 太陽はモーターの回転数のまま（モーターに負荷がかからない）
    expect(rpm(motion, 'shaft_s')).toBeCloseTo(60, 6);
    expect(motion.locks).toEqual([]);
    // 角度は拘束を満たす（θ = N q）
    const th = (id: string) => motion.angles[id] ?? 0;
    expect(
      24 * (th('shaft_s') - th('shaft_k')) + 12 * (th('shaft_p0') - th('shaft_k')),
    ).toBeCloseTo(0, 9);
  });

  it('dt = 0 でも手の角度に合わせる', () => {
    const free = withoutAnchors(ringFixed);
    const motion = solveMotion(free, resolveLayout(free), initialMotionState(), {
      hand: { shaftId: 'shaft_k', angle: 0.3 },
    });
    expect(motion.angles.shaft_k).toBeCloseTo(0.3, 9);
  });
});
