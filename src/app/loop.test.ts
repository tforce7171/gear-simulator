import { describe, expect, it } from 'vitest';
import type { SceneView } from '../render/scene-view';
import { demoScene } from './demo-scene';
import { frameDt, MAX_FRAME_DT, runFrame } from './loop';
import { createLayoutMemo, createStore } from './store';

describe('frameDt', () => {
  it('最初のフレームは 0', () => {
    expect(frameDt(null, 1234)).toBe(0);
  });

  it('前のフレームからの経過時間（秒）', () => {
    expect(frameDt(1000, 1016)).toBeCloseTo(0.016, 9);
  });

  it('0.1 秒で頭打ちにする', () => {
    expect(MAX_FRAME_DT).toBe(0.1);
    expect(frameDt(0, 5000)).toBe(0.1);
  });
});

describe('runFrame の手の拘束（S1-21）', () => {
  const view: SceneView = {
    sync() {},
    update() {},
    render() {},
    projectToScreen: () => ({ x: 0, y: 0 }),
  };

  it('sim.hand があれば、つかんだシャフトが目標の角度になり、つながったシャフトが歯数比で動く', () => {
    // demoScene: shaft_1（12 歯、モーター）– shaft_2（24 歯）
    const store = createStore(demoScene);
    store.setHand({ shaftId: 'shaft_2', angle: 1 });
    runFrame({ store, view, layoutOf: createLayoutMemo() }, 0.1);
    const { motion } = store.getState();
    expect(motion.angles.shaft_2).toBeCloseTo(1, 9);
    expect(motion.angles.shaft_1).toBeCloseTo(-2, 9);
    expect(motion.omegas.shaft_2).toBeCloseTo(10, 9);
  });

  it('sim.hand が null ならモーターで回る', () => {
    const store = createStore(demoScene);
    runFrame({ store, view, layoutOf: createLayoutMemo() }, 0.1);
    expect(store.getState().motion.angles.shaft_1).toBeCloseTo(0.2 * Math.PI, 9);
  });
});

describe('runFrame の一時停止（S1-22）', () => {
  const view: SceneView = {
    sync() {},
    update() {},
    render() {},
    projectToScreen: () => ({ x: 0, y: 0 }),
  };

  it('sim.paused なら角度が進まず ω は 0', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'togglePause' });
    runFrame({ store, view, layoutOf: createLayoutMemo() }, 0.1);
    const { motion } = store.getState();
    expect(motion.angles.shaft_1).toBe(0);
    expect(motion.omegas.shaft_1).toBe(0);
  });

  it('一時停止中でも手で回せる', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'togglePause' });
    store.setHand({ shaftId: 'shaft_2', angle: 1 });
    runFrame({ store, view, layoutOf: createLayoutMemo() }, 0.1);
    expect(store.getState().motion.angles.shaft_2).toBeCloseTo(1, 9);
  });

  it('ロックと干渉の部品を描画に渡す', () => {
    const store = createStore(demoScene);
    const calls: Array<{ locked: string[]; interfering: string[] }> = [];
    runFrame(
      {
        store,
        view: {
          ...view,
          setWarnings(w) {
            calls.push({ locked: [...w.locked], interfering: [...w.interfering] });
          },
        },
        layoutOf: createLayoutMemo(),
      },
      0.1,
    );
    expect(calls).toEqual([{ locked: [], interfering: [] }]);
  });
});
