import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEETH } from '../constants';
import { applyCommand, type Command, type CommandContext } from '../edit/commands';
import { emptyHistory, execute, undo } from '../edit/history';
import { rackPitch } from '../geometry/rack';
import { initialMotionState, solveMotion, stepMotion } from '../kinematics/motion';
import type { HandConstraint, MotionState } from '../kinematics/types';
import { axisFrame, axisVector } from '../math/axis';
import { add, dot, scale, sub, type Vec3 } from '../math/vec3';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Scene } from '../scene/types';
import { validateScene } from '../scene/validate';
import { listGrowCandidates, listRackCandidates } from './candidates';
import { resolveLayout } from './resolve';
import { rackWorldOrigin } from './world';

// S3-04: ラック＆ピニオン。共通: rack-basic（r = 20、L = 60π ≈ 188.50、余白 2π、s の範囲 [−28π, 28π]）

const PI = Math.PI;

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

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  expect(actual).toBeDefined();
  const v = actual as Vec3;
  for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo(expected[i] as number, 6);
}

const basic = fixture('rack-basic');

function withMotor(scene: Scene, patch: { on?: boolean; direction?: 1 | -1 }): Scene {
  const motor = scene.motors.motor_p;
  if (motor === undefined) throw new Error('no motor');
  return { ...scene, motors: { motor_p: { ...motor, ...patch } } };
}

function withRack(scene: Scene, patch: Partial<Scene['racks'][string]>): Scene {
  const rack = scene.racks.rack_r;
  if (rack === undefined) throw new Error('no rack');
  return { ...scene, racks: { ...scene.racks, rack_r: { ...rack, ...patch } } };
}

// dt ずつ n フレーム進める
function run(
  scene: Scene,
  frames: number,
  dt = 1 / 60,
  start: MotionState = solveMotion(scene, resolveLayout(scene), initialMotionState()),
  hand?: (frame: number) => HandConstraint,
): MotionState {
  const layout = resolveLayout(scene);
  let motion = start;
  for (let i = 0; i < frames; i++) {
    const h = hand?.(i + 1);
    motion = stepMotion(scene, layout, motion, dt, h === undefined ? {} : { hand: h });
  }
  return motion;
}

// 2 つ目のピニオン Q（中・20 歯、'rack' の配置）を足したシーン
function withSecondPinion(scene: Scene, position: number): Scene {
  return apply(scene, { type: 'growGear', mode: 'rack', rackId: 'rack_r', position, teeth: 20 });
}

describe('S3-04 ラック＆ピニオン: レイアウト', () => {
  it('validateScene が通る', () => {
    expect(validateScene(basic)).toEqual({ ok: true });
  });

  it('resolveLayout: 向き・基準位置・範囲・かみ合い・干渉', () => {
    const layout = resolveLayout(basic);
    const r = layout.racks.rack_r;
    expect(r?.direction).toBe('x');
    expect(r?.normal).toBe('y');
    expect(r?.normalSign).toBe(1);
    expect(r?.width).toBe('z');
    expectVec(r?.origin, [0, 40, 4]);
    expect(r?.length).toBeCloseTo(60 * PI, 9);
    expect(r?.travel[0]).toBeCloseTo(-28 * PI, 9);
    expect(r?.travel[1]).toBeCloseTo(28 * PI, 9);
    expect(layout.rackMeshes).toEqual([
      { gear: 'gear_p', rack: 'rack_r', position: 0, source: 'tree' },
    ]);
    expect(layout.interferences).toEqual([]);
  });

  it('歯数 10 のラック → s の範囲 [−8π, 8π]', () => {
    const layout = resolveLayout(withRack(basic, { teeth: 10 }));
    expect(layout.racks.rack_r?.travel[0]).toBeCloseTo(-8 * PI, 9);
    expect(layout.racks.rack_r?.travel[1]).toBeCloseTo(8 * PI, 9);
  });

  it('向きの追従: P のシャフトの軸を x に → direction y・normal z、かみ合いが保たれる', () => {
    const scene = apply(basic, { type: 'setShaftAxis', shaftId: 'shaft_p', axis: 'x' });
    const layout = resolveLayout(scene);
    expect(layout.racks.rack_r?.direction).toBe('y');
    expect(layout.racks.rack_r?.normal).toBe('z');
    expect(layout.rackMeshes.map((m) => [m.gear, m.rack])).toEqual([['gear_p', 'rack_r']]);
    // 基準位置 = ピニオンの中心 − r·normal
    const p = layout.gears.gear_p;
    expectVec(layout.racks.rack_r?.origin, sub(p?.center as Vec3, [0, 0, 20]));
  });

  it('位相: s = 0 で、P の歯の中心が接点にあり、R の基準位置が歯溝の中心', () => {
    const layout = resolveLayout(basic);
    const p = layout.gears.gear_p;
    const r = layout.racks.rack_r;
    // 接点（R の基準位置）は P の中心から −y。その向きの角度
    const { u, v } = axisFrame('z');
    const toContact = sub(r?.origin as Vec3, p?.center as Vec3);
    const beta = Math.atan2(dot(toContact, v), dot(toContact, u));
    const pitch = (2 * PI) / 20;
    const k = (((beta - (p?.basePhase as number)) / pitch) % 1) + 1;
    expect(Math.min(k % 1, 1 - (k % 1))).toBeCloseTo(0, 9); // 歯の中心が接点に来る
    expect(r?.grooveOffset).toBeCloseTo(0, 9); // 基準位置が歯溝の中心
  });

  it('干渉: R の動く範囲（x ≈ −182〜182）の途中の歯車は干渉、範囲の外は干渉しない', () => {
    // 縦の起点のシャフトに中・12 歯（中心 [x, 40, 4]、歯先円半径 14）
    const other = (x: number): Scene => ({
      ...basic,
      shafts: {
        ...basic.shafts,
        shaft_o: { id: 'shaft_o', placement: { kind: 'root', origin: [x, 36, 4], axis: 'y' } },
      },
      gears: {
        ...basic.gears,
        gear_o: { id: 'gear_o', kind: 'spur', shaftId: 'shaft_o', size: 'M', teeth: 12, offset: 0 },
      },
    });
    const pairsOf = (x: number) =>
      resolveLayout(other(x)).interferences.filter(([a, b]) => a === 'gear_o' || b === 'gear_o');
    expect(pairsOf(150)).toContainEqual(['gear_o', 'rack_r']);
    expect(pairsOf(-150)).toContainEqual(['gear_o', 'rack_r']);
    expect(pairsOf(200)).toEqual([]);
  });
});

describe('S3-04 ラック＆ピニオン: 運動', () => {
  it('P が 2π rad/s → R の v = 40π mm/s（k = (z × −y)·x = 1）', () => {
    const motion = solveMotion(basic, resolveLayout(basic), initialMotionState());
    expect(motion.omegas.shaft_p).toBeCloseTo(2 * PI, 9);
    expect(motion.rackVelocities.rack_r).toBeCloseTo(40 * PI, 9);
    expect(motion.rackPositions.rack_r).toBe(0);
    expect(motion.locks).toEqual([]);
  });

  it('normalSign −1（R が P の上、基準位置 [0, 80, 4]）→ v = −40π', () => {
    const scene = withRack(basic, {
      placement: { kind: 'pinion', gearId: 'gear_p', axisStep: 1, normalSign: -1 },
    });
    const layout = resolveLayout(scene);
    expectVec(layout.racks.rack_r?.origin, [0, 80, 4]);
    const motion = solveMotion(scene, layout, initialMotionState());
    expect(motion.rackVelocities.rack_r).toBeCloseTo(-40 * PI, 9);
  });

  it('積分: dt = 1/60 で 0.5 秒 → s = 20π、ロックなし', () => {
    const motion = run(basic, 30);
    expect(motion.rackPositions.rack_r).toBeCloseTo(20 * PI, 6);
    expect(motion.locks).toEqual([]);
    // 角度とそろって積分する（s = r·θ）
    expect(motion.rackPositions.rack_r).toBeCloseTo(20 * (motion.angles.shaft_p as number), 6);
  });

  it('端: 1 秒 → s = 28π（越えない）、ロック 1 件（rackEnd）、ω = 0、v = 0', () => {
    const motion = run(basic, 60);
    expect(motion.rackPositions.rack_r).toBeCloseTo(28 * PI, 6);
    expect(motion.rackPositions.rack_r as number).toBeLessThanOrEqual(28 * PI + 1e-6);
    expect(motion.locks).toHaveLength(1);
    expect(motion.locks[0]?.reason).toBe('rackEnd');
    expect(motion.locks[0]?.rackIds).toEqual(['rack_r']);
    expect(motion.locks[0]?.shaftIds).toEqual(['shaft_p']);
    expect(motion.omegas.shaft_p).toBe(0);
    expect(motion.rackVelocities.rack_r).toBe(0);
  });

  it('端から戻る: 端にいる状態でモーターの向きを −1 に → ロックなし、v = −40π。次のフレームで s < 28π', () => {
    const atEnd = run(basic, 60);
    const reversed = withMotor(basic, { direction: -1 });
    const layout = resolveLayout(reversed);
    const solved = solveMotion(reversed, layout, atEnd);
    expect(solved.locks).toEqual([]);
    expect(solved.rackVelocities.rack_r).toBeCloseTo(-40 * PI, 9);
    const next = stepMotion(reversed, layout, solved, 1 / 60);
    expect(next.rackPositions.rack_r as number).toBeLessThan(28 * PI);
    expect(next.locks).toEqual([]);
  });

  it('2 つ目のピニオン: position 16π（8 ピッチ）→ Q の中心 [16π, 60, 4]、Q の ω = P の ω、範囲 [−12π, 28π]', () => {
    const scene = withSecondPinion(basic, 16 * PI);
    expect(validateScene(scene)).toEqual({ ok: true });
    const layout = resolveLayout(scene);
    const q = Object.values(scene.gears).find((g) => g.id !== 'gear_p');
    expect(q).toBeDefined();
    expectVec(layout.gears[q?.id as string]?.center, [16 * PI, 60, 4]);
    expect(layout.racks.rack_r?.travel[0]).toBeCloseTo(-12 * PI, 9);
    expect(layout.racks.rack_r?.travel[1]).toBeCloseTo(28 * PI, 9);
    expect(layout.interferences).toEqual([]);
    const motion = solveMotion(scene, layout, initialMotionState());
    expect(motion.omegas[q?.shaftId as string]).toBeCloseTo(motion.omegas.shaft_p as number, 9);
    expect(motion.omegas.shaft_p).toBeGreaterThan(0);
  });

  it('2 つ目のピニオン: position 10π（5 ピッチ）では P と干渉する', () => {
    const scene = withSecondPinion(basic, 10 * PI);
    const layout = resolveLayout(scene);
    const q = Object.values(scene.gears).find((g) => g.id !== 'gear_p')?.id as string;
    expect(layout.interferences).toContainEqual(['gear_1', 'gear_p']);
    expect(q).toBe('gear_1');
  });

  it('2 つ目のピニオンの位相: Q の歯の中心が、接点の歯溝の中心に来る', () => {
    const scene = withSecondPinion(basic, 16 * PI);
    const layout = resolveLayout(scene);
    const q = layout.gears.gear_1;
    const r = layout.racks.rack_r;
    const contact = add(r?.origin as Vec3, scale(axisVector('x'), 16 * PI));
    const { u, v } = axisFrame('z');
    const d = sub(contact, q?.center as Vec3);
    const beta = Math.atan2(dot(d, v), dot(d, u));
    const pitch = (2 * PI) / 20;
    const f = ((((beta - (q?.basePhase as number)) / pitch) % 1) + 1) % 1;
    expect(Math.min(f, 1 - f)).toBeCloseTo(0, 9);
  });

  it('2 つ目のピニオンの候補: position がピッチの整数倍で、P と干渉しない', () => {
    const candidates = listRackCandidates(basic, 'rack_r', { perimeterTeeth: DEFAULT_TEETH.M });
    expect(candidates.map((c) => c.kind)).toEqual(['rackPinion', 'rackPinion']);
    const pitch = rackPitch('M');
    for (const c of candidates) {
      if (c.kind !== 'rackPinion') throw new Error('kind');
      const n = c.position / pitch;
      expect(n).toBeCloseTo(Math.round(n), 9);
      const scene = withSecondPinion(basic, c.position);
      expect(resolveLayout(scene).interferences).toEqual([]);
    }
    const positions = candidates.map((c) => (c.kind === 'rackPinion' ? c.position : 0));
    expect(positions[0]).toBeCloseTo(-16 * PI, 9);
    expect(positions[1]).toBeCloseTo(16 * PI, 9);
  });

  it('平歯車を選ぶとラックの候補が 4 か所出る（axisStep 2 通り × normalSign 2 通り）', () => {
    const scene: Scene = { ...basic, racks: {} };
    const candidates = listGrowCandidates(scene, 'gear_p', {
      perimeterTeeth: DEFAULT_TEETH.M,
      coaxialSize: 'M',
      coaxialTeeth: DEFAULT_TEETH.M,
      coaxialKind: 'spur',
    }).filter((c) => c.kind === 'rack');
    expect(
      candidates.map((c) => (c.kind === 'rack' ? [c.axisStep, c.normalSign, c.teeth] : [])),
    ).toEqual([
      [1, -1, 30],
      [1, 1, 30],
      [2, -1, 30],
      [2, 1, 30],
    ]);
    // ラックの候補（axisStep 1・normalSign 1）は rack-basic の R と同じ位置
    const c = candidates[1];
    if (c?.kind !== 'rack') throw new Error('kind');
    expectVec(c.center, [0, 40, 4]);
    expect(c.axis).toBe('x');
    // 候補のコマンドで置ける
    const placed = apply(scene, {
      type: 'growRack',
      gearId: 'gear_p',
      axisStep: c.axisStep,
      normalSign: c.normalSign,
      teeth: c.teeth,
    });
    expect(resolveLayout(placed).rackMeshes).toHaveLength(1);
  });

  it('固定: R を固定 → P の ω = 0、ロック（anchor）。モーター OFF ならロックなし', () => {
    const fixed = apply(basic, { type: 'addAnchor', rackId: 'rack_r' });
    expect(validateScene(fixed)).toEqual({ ok: true });
    const motion = solveMotion(fixed, resolveLayout(fixed), initialMotionState());
    expect(motion.omegas.shaft_p).toBe(0);
    expect(motion.rackVelocities.rack_r).toBe(0);
    expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
    const off = withMotor(fixed, { on: false });
    expect(solveMotion(off, resolveLayout(off), initialMotionState()).locks).toEqual([]);
  });

  it('手で動かす: R の s に規定値（毎秒 +10 mm）→ P の ω = 0.5 rad/s。端を越える規定値 → 端で止まりロック', () => {
    const off = withMotor(basic, { on: false });
    const dt = 1 / 60;
    const motion = run(off, 30, dt, undefined, (frame) => ({
      shaftId: 'rack_r',
      angle: 10 * dt * frame,
    }));
    expect(motion.omegas.shaft_p).toBeCloseTo(0.5, 9);
    expect(motion.rackVelocities.rack_r).toBeCloseTo(10, 9);
    expect(motion.rackPositions.rack_r).toBeCloseTo(5, 9);
    expect(motion.angles.shaft_p).toBeCloseTo(0.25, 9);

    const pushed = run(off, 2, dt, undefined, () => ({ shaftId: 'rack_r', angle: 100 }));
    expect(pushed.rackPositions.rack_r).toBeCloseTo(28 * PI, 6);
    expect(pushed.locks.map((l) => l.reason)).toEqual(['rackEnd']);
    expect(pushed.omegas.shaft_p).toBe(0);
  });

  it('ピニオンを手で回して端を越えると、端で止まりロック', () => {
    const off = withMotor(basic, { on: false });
    const pushed = run(off, 1, 1 / 60, undefined, () => ({ shaftId: 'shaft_p', angle: 10 }));
    expect(pushed.rackPositions.rack_r).toBeCloseTo(28 * PI, 6);
    expect(pushed.angles.shaft_p).toBeCloseTo((28 * PI) / 20, 6);
    expect(pushed.locks.map((l) => l.reason)).toEqual(['rackEnd']);
  });

  it('rackWorldOrigin: 基準位置 + s·direction', () => {
    const motion = run(basic, 30);
    expectVec(rackWorldOrigin(resolveLayout(basic), motion, 'rack_r'), [20 * PI, 40, 4]);
  });
});

describe('S3-04 ラック＆ピニオン: 編集', () => {
  it('歯数の変更: P を 30 歯に → 基準位置 [0, 30, 4]', () => {
    const scene = apply(basic, { type: 'setGearTeeth', gearId: 'gear_p', teeth: 30 });
    expectVec(resolveLayout(scene).racks.rack_r?.origin, [0, 30, 4]);
  });

  it('歯数の変更: R を 10 歯に変えたとき s = 20π なら、s が 8π に寄せられる', () => {
    const at20 = run(basic, 30);
    expect(at20.rackPositions.rack_r).toBeCloseTo(20 * PI, 6);
    const scene = apply(basic, { type: 'setRackTeeth', rackId: 'rack_r', teeth: 10 });
    const off = withMotor(scene, { on: false });
    const motion = solveMotion(off, resolveLayout(off), at20);
    expect(motion.rackPositions.rack_r).toBeCloseTo(8 * PI, 6);
    expect(motion.angles.shaft_p).toBeCloseTo((8 * PI) / 20, 6);
  });

  it('setRackTeeth: 範囲外は invalidValue、無いラックは notFound', () => {
    expect(
      applyCommand(basic, { type: 'setRackTeeth', rackId: 'rack_r', teeth: 9 }, ctx()),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalidValue' },
    });
    expect(
      applyCommand(basic, { type: 'setRackTeeth', rackId: 'rack_x', teeth: 20 }, ctx()),
    ).toMatchObject({
      ok: false,
      error: { code: 'notFound' },
    });
  });

  it('削除: P を消す → R が detached（origin [0, 40, 4]、x・y・1）。Undo で戻る', () => {
    const deleted = execute(
      { scene: basic, history: emptyHistory() },
      { type: 'deleteParts', ids: ['gear_p'] },
      ctx(),
    );
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    const state = deleted.state;
    const rack = state.scene.racks.rack_r;
    expect(rack?.placement.kind).toBe('detached');
    if (rack?.placement.kind !== 'detached') return;
    expectVec(rack.placement.origin, [0, 40, 4]);
    expect(rack.placement.direction).toBe('x');
    expect(rack.placement.normal).toBe('y');
    expect(rack.placement.normalSign).toBe(1);
    expect(validateScene(state.scene)).toEqual({ ok: true });
    expect(resolveLayout(state.scene).racks.rack_r?.origin).toEqual(rack.placement.origin);
    const back = undo(state);
    expect(back?.scene).toBe(basic);
  });

  it('削除: ラックを消すと、それに載ったピニオンのシャフトは detached になる。固定具も消える', () => {
    const scene = apply(withSecondPinion(basic, 16 * PI), { type: 'addAnchor', rackId: 'rack_r' });
    const deleted = apply(scene, { type: 'deleteParts', ids: ['rack_r'] });
    expect(deleted.racks).toEqual({});
    expect(deleted.anchors).toEqual({});
    const q = deleted.shafts.shaft_1;
    expect(q?.placement.kind).toBe('detached');
    if (q?.placement.kind === 'detached') {
      expectVec(q.placement.origin, [16 * PI, 60, 0]);
      expect(q.placement.axis).toBe('z');
    }
    expect(validateScene(deleted)).toEqual({ ok: true });
  });

  it('growRack: 平歯車でない・無い歯車・範囲外の歯数は失敗', () => {
    const scene = apply(basic, {
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_p',
      offset: 8,
      size: 'M',
      teeth: 20,
      kind: 'helical',
    });
    const helical = Object.values(scene.gears).find((g) => g.kind === 'helical')?.id as string;
    const grow = (gearId: string, teeth = 30): ReturnType<typeof applyCommand> =>
      applyCommand(scene, { type: 'growRack', gearId, axisStep: 1, normalSign: 1, teeth }, ctx());
    expect(grow(helical)).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    expect(grow('gear_x')).toMatchObject({ ok: false, error: { code: 'notFound' } });
    expect(grow('gear_p', 61)).toMatchObject({ ok: false, error: { code: 'invalidValue' } });
  });

  it('growGear rack: position をピッチの整数倍に吸着する', () => {
    const scene = withSecondPinion(basic, 16 * PI + 1.2);
    const p = scene.shafts.shaft_1?.placement;
    expect(p?.kind === 'rack' ? p.position : null).toBeCloseTo(16 * PI, 9);
  });

  it('検証: ピニオンが平歯車でない・大きさが違う・浮いたラックの向きが同じ・固定具の対象のラックが無い', () => {
    const bad = (scene: Scene): string[] => {
      const result = validateScene(scene);
      return result.ok ? [] : result.errors.map((e) => e.code);
    };
    expect(bad(withRack(basic, { size: 'S' }))).toContain('meshSizeMismatch');
    expect(bad(withRack(basic, { teeth: 61 }))).toContain('teethOutOfRange');
    expect(
      bad(
        withRack(basic, {
          placement: {
            kind: 'detached',
            origin: [0, 0, 0],
            direction: 'x',
            normal: 'x',
            normalSign: 1,
          },
        }),
      ),
    ).toContain('rackAxesNotDistinct');
    expect(
      bad({
        ...basic,
        anchors: { anchor_a: { id: 'anchor_a', target: { kind: 'rack', id: 'rack_x' } } },
      }),
    ).toContain('missingRef');
  });
});
