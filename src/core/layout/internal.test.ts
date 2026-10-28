import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEETH } from '../constants';
import { applyCommand, type Command } from '../edit/commands';
import { toothFraction } from '../geometry/bevel';
import { canMesh } from '../geometry/can-mesh';
import { centerDistance, teethRange } from '../geometry/dimensions';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import { rpmToRadPerSec } from '../kinematics/motor';
import { axisFrame } from '../math/axis';
import { add, dot, scale, sub, type Vec3 } from '../math/vec3';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Axis, Gear, Scene, Shaft, SizeKey } from '../scene/types';
import { validateScene } from '../scene/validate';
import { type GrowCandidate, type GrowSpec, listGrowCandidates } from './candidates';
import { resolveLayout } from './resolve';

// S3-02: 内歯車

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

function spur(id: string, size: SizeKey, teeth: number, shaftId = 'shaft_x'): Gear {
  return { id, kind: 'spur', shaftId, size, teeth, offset: 0 };
}
function internal(id: string, size: SizeKey, teeth: number, shaftId = 'shaft_x'): Gear {
  return { id, kind: 'internal', webSide: -1, shaftId, size, teeth, offset: 0 };
}

function apply(scene: Scene, command: Command): Scene {
  const result = applyCommand(scene, command, { ids: createSequentialIdGenerator() });
  if (!result.ok) throw new Error(result.error.message);
  return result.scene;
}

// 起点のシャフトと、その上の 1 枚の歯車だけのシーン
function single(gear: Gear, axis: Axis = 'y'): Scene {
  return {
    shafts: {
      [gear.shaftId]: { id: gear.shaftId, placement: { kind: 'root', origin: [0, 35, 0], axis } },
    },
    gears: { [gear.id]: gear },
    motors: {},
    anchors: {},
  };
}

// シーンに、起点のシャフト（axis、原点 origin）と、そこに載る歯車（あれば）を足す
function withRoot(scene: Scene, shaft: Shaft, gear?: Gear): Scene {
  return {
    ...scene,
    shafts: { ...scene.shafts, [shaft.id]: shaft },
    gears: gear === undefined ? scene.gears : { ...scene.gears, [gear.id]: gear },
  };
}

function rootShaft(id: string, origin: Vec3, axis: Axis = 'y'): Shaft {
  return { id, placement: { kind: 'root', origin, axis } };
}

// 軸 axis まわりの、center から point への向きの角度（radialDirection と同じ取り方）
function angleAround(axis: Axis, center: Vec3, point: Vec3): number {
  const { u, v } = axisFrame(axis);
  const d = sub(point, center);
  return Math.atan2(dot(d, v), dot(d, u));
}

function fracDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

const pair = fixture('internal-pair');
const P = 'gear_p';
const G = 'gear_g';

const SPEC_M: GrowSpec = {
  perimeterTeeth: DEFAULT_TEETH.M,
  coaxialSize: 'M',
  coaxialTeeth: DEFAULT_TEETH.M,
  coaxialKind: 'spur',
};

describe('centerDistance・canMesh・teethRange', () => {
  it('centerDistance: 中・20 歯の平歯車と中・60 歯の内歯車 → 40。中・20 歯同士の平歯車 → 40', () => {
    expect(centerDistance(spur('a', 'M', 20), internal('b', 'M', 60))).toBe(40);
    expect(centerDistance(internal('b', 'M', 60), spur('a', 'M', 20))).toBe(40);
    expect(centerDistance(spur('a', 'M', 20), spur('b', 'M', 20))).toBe(40);
  });

  it('canMesh: 内 32 と平 20 → 真、内 30 と平 20（差 10）→ 偽、内歯車同士 → 偽、大きさ違い → 偽', () => {
    expect(canMesh(internal('i', 'M', 32), spur('s', 'M', 20))).toBe(true);
    expect(canMesh(spur('s', 'M', 20), internal('i', 'M', 32))).toBe(true);
    expect(canMesh(internal('i', 'M', 30), spur('s', 'M', 20))).toBe(false);
    expect(canMesh(spur('s', 'M', 20), internal('i', 'M', 30))).toBe(false);
    expect(canMesh(internal('i', 'M', 40), internal('j', 'M', 24))).toBe(false);
    expect(canMesh(internal('i', 'M', 40), spur('s', 'S', 20))).toBe(false);
  });

  it("teethRange('internal', 'L') → { min: 24, max: 40 }。teethRange('spur', 'S') → { min: 12, max: 80 }", () => {
    expect(teethRange('internal', 'L')).toEqual({ min: 24, max: 40 });
    expect(teethRange('spur', 'S')).toEqual({ min: 12, max: 80 });
  });
});

describe('resolveLayout(internal-pair)', () => {
  it('検証を通る', () => {
    expect(validateScene(pair)).toEqual({ ok: true });
  });

  it('中心距離 40、meshes に kind: internal、interferences が空', () => {
    const layout = resolveLayout(pair);
    const p = layout.gears[P];
    const g = layout.gears[G];
    expect(p).toBeDefined();
    expect(g).toBeDefined();
    if (p === undefined || g === undefined) return;
    const d = sub(g.center, p.center);
    expect(Math.hypot(...d)).toBeCloseTo(40, 9);
    expect(d[1]).toBeCloseTo(0, 9); // 面がそろう
    expect(layout.meshes).toEqual([{ a: G, b: P, source: 'tree', kind: 'internal' }]);
    expect(layout.interferences).toEqual([]);
  });

  it('G のシャフトはウェブ（ボス）だけを通り、中の空洞に入らない', () => {
    const layout = resolveLayout(pair);
    // リングの区画は [0, 8]、ウェブは [−12, −8]。シャフトはウェブの外側の面から SHAFT_END_MARGIN、内側の面まで
    expect(layout.shafts.shaft_g?.span).toEqual([-16, -8]);
  });
});

describe('運動', () => {
  it('internal-pair（P 2π rad/s）→ G は 2π/3 rad/s（同じ符号）', () => {
    const motion = solveMotion(pair, resolveLayout(pair), initialMotionState());
    expect(motion.omegas.shaft_p).toBeCloseTo(2 * Math.PI, 9);
    expect(motion.omegas.shaft_g).toBeCloseTo((2 * Math.PI) / 3, 9);
    expect(motion.locks).toEqual([]);
  });

  it('内歯車 G にモーターを移す（20 rpm）→ P は 60 rpm（同じ符号）', () => {
    const moved: Scene = {
      ...pair,
      motors: {
        motor_g: { id: 'motor_g', shaftId: 'shaft_g', size: 'M', rpm: 20, direction: 1, on: true },
      },
    };
    expect(validateScene(moved)).toEqual({ ok: true });
    const motion = solveMotion(moved, resolveLayout(moved), initialMotionState());
    expect(motion.omegas.shaft_g).toBeCloseTo(rpmToRadPerSec(20), 9);
    expect(motion.omegas.shaft_p).toBeCloseTo(rpmToRadPerSec(60), 9);
  });
});

describe('位相', () => {
  it('接点で P の歯の位置の端数が 0 のとき、G の歯の位置の端数は 0.5（歯溝の中心が重なる）', () => {
    const layout = resolveLayout(pair);
    const p = layout.gears[P];
    const g = layout.gears[G];
    if (p === undefined || g === undefined) throw new Error('no layout');
    // 接点: P の中心から、G の中心と反対の向きに r（= G の中心から R）
    const away = scale(sub(p.center, g.center), 1 / 40);
    const contact = add(p.center, scale(away, p.pitchRadius));
    const fP = toothFraction(p.basePhase, 20, angleAround('y', p.center, contact));
    const fG = toothFraction(g.basePhase, 60, angleAround('y', g.center, contact));
    expect(fracDistance(fP, 0)).toBeLessThan(1e-9);
    expect(fracDistance(fG, 0.5)).toBeLessThan(1e-9);
  });

  it('内歯車が親（角度 π/3、子 18 歯）でも、接点で歯と歯溝が合う', () => {
    const scene = apply(single(internal('gear_i', 'M', 30)), {
      type: 'growGear',
      mode: 'perimeter',
      parentGearId: 'gear_i',
      angle: Math.PI / 3,
      teeth: 18,
    });
    const layout = resolveLayout(scene);
    const child = Object.values(scene.gears).find((g) => g.id !== 'gear_i');
    if (child === undefined) throw new Error('no child');
    const i = layout.gears.gear_i;
    const c = layout.gears[child.id];
    if (i === undefined || c === undefined) throw new Error('no layout');
    expect(Math.hypot(...sub(c.center, i.center))).toBeCloseTo(30 - 18, 9);
    // 接点: 内歯車の中心から子の向きに R
    const dir = scale(sub(c.center, i.center), 1 / 12);
    const contact = add(i.center, scale(dir, 30));
    const fI = toothFraction(i.basePhase, 30, angleAround('y', i.center, contact));
    const fC = toothFraction(c.basePhase, 18, angleAround('y', c.center, contact));
    expect(fracDistance(fC, fI + 0.5)).toBeLessThan(1e-9);
  });
});

describe('候補', () => {
  function perimeterTeeth(list: readonly GrowCandidate[]): number[] {
    return list.filter((c) => c.kind === 'perimeter').map((c) => c.teeth);
  }

  it('内側の候補: 中・30 歯 → 18 歯、中・24 歯 → 12 歯、小・24 歯（既定 30）→ 12 歯。どれも平歯車', () => {
    const m30 = listGrowCandidates(single(internal('gear_i', 'M', 30)), 'gear_i', SPEC_M);
    expect(perimeterTeeth(m30)).toEqual(Array(8).fill(18));
    expect(m30.filter((c) => c.kind === 'perimeter').every((c) => c.shape.kind === 'spur')).toBe(
      true,
    );
    const m24 = listGrowCandidates(single(internal('gear_i', 'M', 24)), 'gear_i', SPEC_M);
    expect(new Set(perimeterTeeth(m24))).toEqual(new Set([12]));
    const s24 = listGrowCandidates(single(internal('gear_i', 'S', 24)), 'gear_i', {
      ...SPEC_M,
      perimeterTeeth: DEFAULT_TEETH.S,
      coaxialSize: 'S',
      coaxialTeeth: DEFAULT_TEETH.S,
    });
    expect(new Set(perimeterTeeth(s24))).toEqual(new Set([12]));
  });

  it('内側の候補は内歯車の内側（中心距離 R − r）にあり、仮のシーンで干渉しない', () => {
    const scene = single(internal('gear_i', 'M', 30));
    const list = listGrowCandidates(scene, 'gear_i', SPEC_M);
    const center = resolveLayout(scene).gears.gear_i?.center as Vec3;
    for (const c of list.filter((c) => c.kind === 'perimeter')) {
      expect(Math.hypot(...sub(c.center, center))).toBeCloseTo(30 - 18, 9);
    }
  });

  it('囲む候補: 中・20 歯 → 40 歯の内歯車。大・20 歯 → 40 歯。大・30 歯 → 候補なし', () => {
    const encloseOf = (gear: Gear) =>
      listGrowCandidates(single(gear), gear.id, {
        ...SPEC_M,
        perimeterTeeth: DEFAULT_TEETH[gear.size],
        coaxialSize: gear.size,
        coaxialTeeth: DEFAULT_TEETH[gear.size],
        coaxialKind: 'internal', // パレットで内歯車を選んでいる
      }).filter((c) => c.kind === 'enclose');
    const m20 = encloseOf(spur('gear_s', 'M', 20));
    expect(m20.map((c) => [c.teeth, c.shape])).toEqual([[40, { kind: 'internal', webSide: -1 }]]);
    expect(encloseOf(spur('gear_s', 'L', 20)).map((c) => c.teeth)).toEqual([40]);
    expect(encloseOf(spur('gear_s', 'L', 30))).toEqual([]);
  });

  it('囲む候補は、パレットで内歯車を選んでいるときだけ出す。平歯車以外の親には出さない', () => {
    const scene = single(spur('gear_s', 'M', 20));
    expect(listGrowCandidates(scene, 'gear_s', SPEC_M).some((c) => c.kind === 'enclose')).toBe(
      false,
    );
    const helical: Gear = { ...spur('gear_h', 'M', 20), kind: 'helical', hand: 'right' };
    const list = listGrowCandidates(single(helical), 'gear_h', {
      ...SPEC_M,
      coaxialKind: 'internal',
    });
    expect(list.some((c) => c.kind === 'enclose')).toBe(false);
  });

  it('囲む候補をコマンドにすると、内歯車ができて親とかみ合う（interferences が空）', () => {
    const scene = single(spur('gear_s', 'M', 20));
    const [c] = listGrowCandidates(scene, 'gear_s', { ...SPEC_M, coaxialKind: 'internal' }).filter(
      (c) => c.kind === 'enclose',
    );
    if (c === undefined || c.kind !== 'enclose') throw new Error('no enclose candidate');
    const next = apply(scene, {
      type: 'growGear',
      mode: 'enclose',
      parentGearId: c.parentGearId,
      angle: c.angle,
      teeth: c.teeth,
    });
    const layout = resolveLayout(next);
    expect(layout.meshes.map((m) => m.kind)).toEqual(['internal']);
    expect(layout.interferences).toEqual([]);
  });

  it('同じ軸の候補で内歯車を作れる（歯数は INTERNAL_MIN_TEETH 以上に上げる。ウェブの外に並べる）', () => {
    const scene = single(spur('gear_s', 'M', 20));
    const list = listGrowCandidates(scene, 'gear_s', { ...SPEC_M, coaxialKind: 'internal' });
    const coaxial = list.filter((c) => c.kind === 'coaxial');
    expect(coaxial.map((c) => [c.teeth, c.shape.kind])).toEqual([
      [24, 'internal'],
      [24, 'internal'],
    ]);
    // 負の側: リングが平歯車の負側の面に接する（offset −8）。正の側: ウェブが平歯車の正側の面に接する（offset 8 + 12）
    expect(coaxial.map((c) => (c.kind === 'coaxial' ? c.offset : null))).toEqual([-8, 20]);
  });
});

describe('干渉', () => {
  const layout = resolveLayout(pair);
  const g = layout.gears[G];
  const p = layout.gears[P];
  if (g === undefined || p === undefined) throw new Error('no layout');
  // G の軸から見て P と反対の向き（軸に垂直）
  const away = scale(sub(g.center, p.center), 1 / 40);
  const at = (distance: number, y: number): Vec3 => {
    const q = add(g.center, scale(away, distance));
    return [q[0], y, q[2]];
  };
  // 中・12 歯（歯先円の半径 14）の歯車を、G のリングと同じ面に置く
  const withGear = (distance: number) =>
    withRoot(pair, rootShaft('shaft_x', at(distance, 35)), spur('gear_x', 'M', 12, 'shaft_x'));

  it('G の内側、P と反対の向きに距離 10 → 10 + 14 ≤ 58 で干渉なし', () => {
    const scene = withGear(10);
    expect(validateScene(scene)).toEqual({ ok: true });
    expect(resolveLayout(scene).interferences).toEqual([]);
  });

  it('同じ向きで距離 46 → 内歯車と干渉あり', () => {
    expect(resolveLayout(withGear(46)).interferences).toContainEqual([G, 'gear_x']);
  });

  it('G の空洞を通る、G と平行なシャフト → 干渉なし。ウェブまで伸びる → 干渉あり', () => {
    // G のリングは y = 35〜43、つなぎの筒は 27〜35、ウェブは 23〜27。歯車の無いシャフトの長さは ±10
    const through = withRoot(pair, rootShaft('shaft_x', at(30, 40)));
    expect(resolveLayout(through).interferences).toEqual([]);
    const toWeb = withRoot(pair, rootShaft('shaft_x', at(30, 30)));
    expect(resolveLayout(toWeb).interferences).toEqual([[G, 'shaft_x']]);
  });

  it('G と直交するシャフトが空洞の中を横切る → 外側の円柱として扱うので干渉あり', () => {
    const axis: Axis = Math.abs(away[0]) > 0.5 ? 'z' : 'x';
    const across = withRoot(pair, rootShaft('shaft_x', at(20, 39), axis));
    expect(resolveLayout(across).interferences).toEqual([[G, 'shaft_x']]);
  });

  it('contact: 木の親子でない平歯車を G の内側でちょうど R − r の距離に置く → contact のかみ合い。ロックしない', () => {
    // P と反対の側、G の中心から 40 に中・20 歯の Q
    const scene = withRoot(
      pair,
      rootShaft('shaft_q', at(40, 35)),
      spur('gear_q', 'M', 20, 'shaft_q'),
    );
    const l = resolveLayout(scene);
    expect(l.meshes).toEqual([
      { a: G, b: P, source: 'tree', kind: 'internal' },
      { a: G, b: 'gear_q', source: 'contact', kind: 'internal' },
    ]);
    expect(l.interferences).toEqual([]);
    const motion = solveMotion(scene, l, initialMotionState());
    expect(motion.locks).toEqual([]);
    expect(motion.omegas.shaft_q).toBeCloseTo(2 * Math.PI, 9);
  });
});

describe('編集', () => {
  it('internal-pair で P を 50 歯に → 歯数差 10 で拒否され、シーンが変わらない', () => {
    const result = applyCommand(
      pair,
      { type: 'setGearTeeth', gearId: P, teeth: 50 },
      { ids: createSequentialIdGenerator() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('notAllowed');
  });

  it('P を 48 歯（差 12）にはできる。G を 23 歯（範囲外）にはできない', () => {
    expect(apply(pair, { type: 'setGearTeeth', gearId: P, teeth: 48 }).gears[P]?.teeth).toBe(48);
    const bad = applyCommand(
      pair,
      { type: 'setGearTeeth', gearId: G, teeth: 23 },
      { ids: createSequentialIdGenerator() },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalidValue');
  });

  it('setWebSide: ウェブを反対側に移す。内歯車でなければ notAllowed', () => {
    const flipped = apply(pair, { type: 'setWebSide', gearId: G, webSide: 1 });
    expect(flipped.gears[G]).toMatchObject({ kind: 'internal', webSide: 1 });
    // ウェブは区画の正の側 [16, 20]。シャフトはウェブの内側の面から、外側の面 + SHAFT_END_MARGIN まで
    expect(resolveLayout(flipped).shafts.shaft_g?.span).toEqual([16, 24]);
    const notInternal = applyCommand(
      pair,
      { type: 'setWebSide', gearId: P, webSide: 1 },
      { ids: createSequentialIdGenerator() },
    );
    expect(notInternal.ok).toBe(false);
    if (!notInternal.ok) expect(notInternal.error.code).toBe('notAllowed');
  });

  it('内歯車の内側に、歯数差の足りない平歯車は生やせない（notAllowed）', () => {
    const result = applyCommand(
      single(internal('gear_i', 'M', 30)),
      { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_i', angle: 0, teeth: 20 },
      { ids: createSequentialIdGenerator() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('notAllowed');
  });
});
