import { describe, expect, it } from 'vitest';
import { emptyMotion } from '../core/kinematics/types';
import { resolveLayout } from '../core/layout/resolve';
import type { Layout } from '../core/layout/types';
import type { Motor, Scene } from '../core/scene/types';
import { demoScene } from './demo-scene';
import { stepProvisionalMotion } from './provisional-motion';

function withMotor(patch: Partial<Motor>): Scene {
  const motor = demoScene.motors.motor_1 as Motor;
  return { ...demoScene, motors: { motor_1: { ...motor, ...patch } } };
}

function step(scene: Scene, dt: number) {
  return stepProvisionalMotion(scene, resolveLayout(scene), emptyMotion(), dt);
}

describe('stepProvisionalMotion', () => {
  it('固定シーンで dt = 0.5 を 1 回', () => {
    const m = step(demoScene, 0.5);
    expect(m.omegas.shaft_1).toBeCloseTo(2 * Math.PI, 9);
    expect(m.omegas.shaft_2).toBeCloseTo(-Math.PI, 9);
    expect(m.angles.shaft_1).toBeCloseTo(Math.PI, 9);
    expect(m.angles.shaft_2).toBeCloseTo(-Math.PI / 2, 9);
    expect(m.locks).toEqual([]);
    expect(m.backDriven).toEqual([]);
  });

  it('モーターが OFF なら全ての ω が 0', () => {
    const m = step(withMotor({ on: false }), 0.5);
    expect(Object.keys(m.omegas).sort()).toEqual(['shaft_1', 'shaft_2']);
    for (const omega of Object.values(m.omegas)) expect(omega).toBe(0);
  });

  it('direction −1、30rpm', () => {
    const m = step(withMotor({ direction: -1, rpm: 30 }), 0.5);
    expect(m.omegas.shaft_1).toBeCloseTo(-Math.PI, 9);
    expect(m.omegas.shaft_2).toBeCloseTo(Math.PI / 2, 9);
  });

  it('角度は前の状態に ω·dt を足す', () => {
    const layout = resolveLayout(demoScene);
    const first = stepProvisionalMotion(demoScene, layout, emptyMotion(), 0.25);
    const second = stepProvisionalMotion(demoScene, layout, first, 0.25);
    expect(second.angles.shaft_1).toBeCloseTo(Math.PI, 9);
    expect(second.angles.shaft_2).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('モーターが子のシャフトにあっても親へ伝わる', () => {
    const scene = withMotor({ shaftId: 'shaft_2' });
    const m = step(scene, 0);
    expect(m.omegas.shaft_2).toBeCloseTo(2 * Math.PI, 9);
    expect(m.omegas.shaft_1).toBeCloseTo(-4 * Math.PI, 9);
  });

  it('自由度 0 の成分（三角形）は止め、別の成分は回す', () => {
    const scene: Scene = {
      shafts: {
        shaft_a: { id: 'shaft_a', placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } },
        shaft_b: { id: 'shaft_b', placement: { kind: 'root', origin: [20, 0, 0], axis: 'y' } },
        shaft_c: { id: 'shaft_c', placement: { kind: 'root', origin: [40, 0, 0], axis: 'y' } },
        shaft_d: { id: 'shaft_d', placement: { kind: 'root', origin: [60, 0, 0], axis: 'y' } },
      },
      gears: {
        gear_a: { id: 'gear_a', kind: 'spur', shaftId: 'shaft_a', size: 'S', teeth: 12, offset: 0 },
        gear_b: { id: 'gear_b', kind: 'spur', shaftId: 'shaft_b', size: 'S', teeth: 12, offset: 0 },
        gear_c: { id: 'gear_c', kind: 'spur', shaftId: 'shaft_c', size: 'S', teeth: 12, offset: 0 },
      },
      motors: {
        motor_1: { id: 'motor_1', shaftId: 'shaft_a', size: 'S', rpm: 60, direction: 1, on: true },
        motor_2: { id: 'motor_2', shaftId: 'shaft_d', size: 'S', rpm: 30, direction: 1, on: true },
      },
    };
    const layout: Layout = {
      shafts: {},
      gears: {},
      meshes: [
        { a: 'gear_a', b: 'gear_b', source: 'tree' },
        { a: 'gear_b', b: 'gear_c', source: 'tree' },
        { a: 'gear_a', b: 'gear_c', source: 'contact' },
      ],
      interferences: [],
    };
    const m = stepProvisionalMotion(scene, layout, emptyMotion(), 0.5);
    expect(m.omegas.shaft_a).toBe(0);
    expect(m.omegas.shaft_b).toBe(0);
    expect(m.omegas.shaft_c).toBe(0);
    expect(m.omegas.shaft_d).toBeCloseTo(Math.PI, 9);
    expect(m.angles.shaft_a).toBe(0);
    expect(m.angles.shaft_d).toBeCloseTo(Math.PI / 2, 9);
  });

  it('同じ Layout でもシーンが変われば作り直す', () => {
    const layout = resolveLayout(demoScene);
    const before = stepProvisionalMotion(demoScene, layout, emptyMotion(), 0);
    expect(before.omegas.shaft_1).toBeCloseTo(2 * Math.PI, 9);
    const moved = withMotor({ shaftId: 'shaft_2' });
    const after = stepProvisionalMotion(moved, layout, emptyMotion(), 0);
    expect(after.omegas.shaft_2).toBeCloseTo(2 * Math.PI, 9);
    expect(after.omegas.shaft_1).toBeCloseTo(-4 * Math.PI, 9);
  });

  it('ω は力のつり合いの解: 逆向きの S と M（12 歯どうし）→ ∓30rpm', () => {
    const gear2 = demoScene.gears.gear_2;
    if (gear2 === undefined) throw new Error('demoScene に gear_2 が無い');
    const base = withMotor({});
    const scene: Scene = {
      ...base,
      gears: { ...base.gears, gear_2: { ...gear2, teeth: 12 } },
      motors: {
        ...base.motors,
        motor_2: { id: 'motor_2', shaftId: 'shaft_2', size: 'M', rpm: 60, direction: 1, on: true },
      },
    };
    const m = step(scene, 0);
    expect(m.omegas.shaft_1).toBeCloseTo(-Math.PI, 9);
    expect(m.omegas.shaft_2).toBeCloseTo(Math.PI, 9);
  });
});
