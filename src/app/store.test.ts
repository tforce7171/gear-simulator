import { describe, expect, it, vi } from 'vitest';
import { createSequentialIdGenerator } from '../core/scene/ids';
import { emptyScene } from '../core/scene/scene';
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

describe('編集コマンドと Undo/Redo', () => {
  const addRoot = {
    type: 'command',
    command: {
      type: 'addRootShaft',
      axis: 'y',
      origin: [0, 20, 0],
      gear: { size: 'S', teeth: 12 },
    },
  } as const;

  it('command で新しい部品が足され、undo / redo で戻る・進む', () => {
    const store = createStore(emptyScene(), { ids: createSequentialIdGenerator() });
    const before = store.getState().scene;
    store.dispatch(addRoot);
    expect(Object.keys(store.getState().scene.gears)).toEqual(['gear_1']);
    expect(store.getState().history.past).toEqual([before]);
    const after = store.getState().scene;
    store.dispatch({ type: 'undo' });
    expect(store.getState().scene).toBe(before);
    store.dispatch({ type: 'redo' });
    expect(store.getState().scene).toBe(after);
  });

  it('シーンが変わると ω を求め直し、角度は引き継ぐ', () => {
    const store = createStore(demoScene, { ids: createSequentialIdGenerator() });
    store.setMotion({ ...store.getState().motion, angles: { shaft_1: 1, shaft_2: -0.5 } });
    store.dispatch({
      type: 'command',
      command: { type: 'updateMotor', motorId: 'motor_1', patch: { on: false } },
    });
    expect(store.getState().motion.omegas.shaft_1).toBe(0);
    expect(store.getState().motion.angles.shaft_1).toBeCloseTo(1, 12);
  });

  it('失敗したコマンドと戻せない undo は状態を変えず、購読者に知らせない', () => {
    const store = createStore(demoScene);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getState();
    store.dispatch({ type: 'command', command: { type: 'deleteParts', ids: ['gear_99'] } });
    store.dispatch({ type: 'undo' });
    store.dispatch({ type: 'redo' });
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('loadScene は履歴を空にする', () => {
    const store = createStore(emptyScene(), { ids: createSequentialIdGenerator() });
    store.dispatch(addRoot);
    store.dispatch({ type: 'loadScene', scene: demoScene });
    expect(store.getState().history.past).toEqual([]);
    expect(store.getState().history.future).toEqual([]);
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
