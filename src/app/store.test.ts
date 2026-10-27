import { describe, expect, it, vi } from 'vitest';
import type { Scene } from '../core/scene/types';
import { demoScene } from './demo-scene';
import { createLayoutMemo, createStore } from './store';

const offScene: Scene = {
  ...demoScene,
  motors: {},
};

describe('createStore', () => {
  it('最初の状態: シーンと、角度 0・ω を求めた運動', () => {
    const store = createStore(demoScene);
    const { scene, motion } = store.getState();
    expect(scene).toBe(demoScene);
    expect(motion.angles).toEqual({ shaft_1: 0, shaft_2: 0 });
    expect(motion.omegas.shaft_1).toBeCloseTo(2 * Math.PI, 9);
  });

  it('subscribe した関数が dispatch のたびに呼ばれ、解除後は呼ばれない', () => {
    const store = createStore(demoScene);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.dispatch({ type: 'loadScene', scene: offScene });
    store.dispatch({ type: 'loadScene', scene: demoScene });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(store.getState());
    unsubscribe();
    store.dispatch({ type: 'loadScene', scene: offScene });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('loadScene はシーンを置き換え、運動の状態を初期化する', () => {
    const store = createStore(demoScene);
    store.setMotion({ ...store.getState().motion, angles: { shaft_1: 5, shaft_2: -2.5 } });
    store.dispatch({ type: 'loadScene', scene: offScene });
    expect(store.getState().scene).toBe(offScene);
    expect(store.getState().motion.angles).toEqual({ shaft_1: 0, shaft_2: 0 });
    expect(store.getState().motion.omegas).toEqual({ shaft_1: 0, shaft_2: 0 });
  });

  it('最初の運動にロックが出る: 12 歯どうしに逆向きの S 60rpm', () => {
    const gear2 = demoScene.gears.gear_2;
    const motor1 = demoScene.motors.motor_1;
    if (gear2 === undefined || motor1 === undefined) throw new Error('demoScene が想定と違う');
    const scene: Scene = {
      ...demoScene,
      gears: { ...demoScene.gears, gear_2: { ...gear2, teeth: 12 } },
      motors: { ...demoScene.motors, motor_2: { ...motor1, id: 'motor_2', shaftId: 'shaft_2' } },
    };
    const { motion } = createStore(scene).getState();
    expect(motion.locks.map((l) => l.reason)).toEqual(['stalemate']);
    expect(motion.omegas).toEqual({ shaft_1: 0, shaft_2: 0 });
  });

  it('setMotion は購読者に知らせない', () => {
    const store = createStore(demoScene);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setMotion(store.getState().motion);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createLayoutMemo', () => {
  it('シーンの参照が同じなら同じ結果を返す', () => {
    const layoutOf = createLayoutMemo();
    const a = layoutOf(demoScene);
    expect(layoutOf(demoScene)).toBe(a);
    expect(layoutOf({ ...demoScene })).not.toBe(a);
  });
});
