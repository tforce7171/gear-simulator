import { describe, expect, it } from 'vitest';
import { emptyMotion } from '../core/kinematics/types';
import { resolveLayout } from '../core/layout/resolve';
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
});
