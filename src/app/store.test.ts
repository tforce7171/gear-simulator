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

describe('設定と表示の状態（S1-14）', () => {
  it('初期値: inputDevice auto・trackpadScroll pan・theme brass・quality high・muted false・watchMode false・infoOverlay false', () => {
    const { settings, view } = createStore(demoScene).getState();
    expect(settings).toEqual({
      inputDevice: 'auto',
      trackpadScroll: 'pan',
      theme: 'brass',
      quality: 'high',
      muted: false,
    });
    expect(view).toEqual({ watchMode: false, infoOverlay: false });
  });

  it('updateSettings は指定した項目だけ変え、シーンと履歴はそのまま', () => {
    const store = createStore(demoScene);
    const before = store.getState();
    store.dispatch({ type: 'updateSettings', patch: { trackpadScroll: 'orbit' } });
    const after = store.getState();
    expect(after.settings).toEqual({
      inputDevice: 'auto',
      trackpadScroll: 'orbit',
      theme: 'brass',
      quality: 'high',
      muted: false,
    });
    expect(after.scene).toBe(before.scene);
    expect(after.history).toBe(before.history);
  });

  it('updateSettings でテーマと品質を変えられる（S1-24）', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'updateSettings', patch: { theme: 'wood', quality: 'low' } });
    expect(store.getState().settings.theme).toBe('wood');
    expect(store.getState().settings.quality).toBe('low');
  });

  it('updateSettings でミュートを切り替えられる（S1-25）', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'updateSettings', patch: { muted: true } });
    expect(store.getState().settings.muted).toBe(true);
    store.dispatch({ type: 'updateSettings', patch: { muted: false } });
    expect(store.getState().settings.muted).toBe(false);
  });

  it('値が変わらない updateSettings・setWatchMode は購読者に知らせない', () => {
    const store = createStore(demoScene);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'updateSettings', patch: { inputDevice: 'auto' } });
    store.dispatch({ type: 'setWatchMode', on: false });
    expect(listener).not.toHaveBeenCalled();
    store.dispatch({ type: 'setWatchMode', on: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().view.watchMode).toBe(true);
  });

  it('loadScene と編集コマンドは設定と表示の状態を保つ', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'updateSettings', patch: { inputDevice: 'trackpad' } });
    store.dispatch({ type: 'setWatchMode', on: true });
    store.dispatch({ type: 'loadScene', scene: offScene });
    expect(store.getState().settings.inputDevice).toBe('trackpad');
    expect(store.getState().view.watchMode).toBe(true);
  });
});

describe('選択（S1-16）', () => {
  it('最初は未選択。select で選び、null で外す。同じ値なら知らせない', () => {
    const store = createStore(demoScene);
    expect(store.getState().selection).toBeNull();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'select', id: 'gear_2' });
    expect(store.getState().selection).toBe('gear_2');
    store.dispatch({ type: 'select', id: 'gear_2' });
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'select', id: null });
    expect(store.getState().selection).toBeNull();
  });

  it('シーンに無い ID は選ばない', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'select', id: 'gear_99' });
    expect(store.getState().selection).toBeNull();
  });

  it('削除で選択中の部品が無くなったら外れ、Undo で戻っても外れたまま', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'select', id: 'gear_2' });
    store.dispatch({ type: 'command', command: { type: 'deleteParts', ids: ['gear_2'] } });
    expect(store.getState().scene.gears.gear_2).toBeUndefined();
    expect(store.getState().selection).toBeNull();
    store.dispatch({ type: 'undo' });
    expect(store.getState().scene.gears.gear_2).toBeDefined();
    expect(store.getState().selection).toBeNull();
  });

  it('残っている部品の選択は、ほかの部品の削除や loadScene でも保つ', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'select', id: 'gear_1' });
    store.dispatch({ type: 'command', command: { type: 'deleteParts', ids: ['gear_2'] } });
    expect(store.getState().selection).toBe('gear_1');
    store.dispatch({ type: 'loadScene', scene: offScene });
    expect(store.getState().selection).toBe('gear_1');
    store.dispatch({ type: 'loadScene', scene: emptyScene() });
    expect(store.getState().selection).toBeNull();
  });
});

describe('パレットと、作った部品の選択（S1-17）', () => {
  it('パレットの大きさの初期値は中。setPaletteSize で変わり、同じ値なら知らせない', () => {
    const store = createStore(emptyScene());
    expect(store.getState().palette.size).toBe('M');
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'setPaletteSize', size: 'S' });
    expect(store.getState().palette.size).toBe('S');
    store.dispatch({ type: 'setPaletteSize', size: 'S' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('selectCreated なら最後に作った部品（起点では歯車）を選び、Undo 1 回で両方消えて選択も外れる', () => {
    const store = createStore(emptyScene(), { ids: createSequentialIdGenerator() });
    store.dispatch({
      type: 'command',
      command: {
        type: 'addRootShaft',
        axis: 'y',
        origin: [0, 35, 0],
        gear: { size: 'M', teeth: 20 },
      },
      selectCreated: true,
    });
    expect(store.getState().selection).toBe('gear_1');
    store.dispatch({ type: 'undo' });
    expect(store.getState().scene.shafts).toEqual({});
    expect(store.getState().scene.gears).toEqual({});
    expect(store.getState().selection).toBeNull();
  });

  it('selectCreated が無ければ選択は変えない', () => {
    const store = createStore(emptyScene(), { ids: createSequentialIdGenerator() });
    store.dispatch({
      type: 'command',
      command: {
        type: 'addRootShaft',
        axis: 'y',
        origin: [0, 35, 0],
        gear: { size: 'M', teeth: 20 },
      },
    });
    expect(store.getState().selection).toBeNull();
  });
});

describe('手の拘束（S1-21）', () => {
  it('最初は null。setHand で入り、購読者には知らせない', () => {
    const store = createStore(demoScene);
    expect(store.getState().sim.hand).toBe(null);
    const listener = vi.fn();
    store.subscribe(listener);
    const hand = { shaftId: 'shaft_1', angle: 0.5 };
    store.setHand(hand);
    expect(store.getState().sim.hand).toBe(hand);
    expect(listener).not.toHaveBeenCalled();
    store.setHand(null);
    expect(store.getState().sim.hand).toBe(null);
  });

  it('loadScene で外れる', () => {
    const store = createStore(demoScene);
    store.setHand({ shaftId: 'shaft_1', angle: 0.5 });
    store.dispatch({ type: 'loadScene', scene: offScene });
    expect(store.getState().sim.hand).toBe(null);
  });
});

describe('一時停止（S1-22）', () => {
  it('最初は false。togglePause で切り替わり、購読者に知らせる', () => {
    const store = createStore(demoScene);
    expect(store.getState().sim.paused).toBe(false);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'togglePause' });
    expect(store.getState().sim.paused).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'togglePause' });
    expect(store.getState().sim.paused).toBe(false);
  });

  it('一時停止すると ω がすぐ 0 になり、戻すとつり合いの解に戻る。シーンと履歴は変わらない', () => {
    const store = createStore(demoScene);
    const { scene, history } = store.getState();
    const running = store.getState().motion.omegas.shaft_1 ?? 0;
    store.dispatch({ type: 'togglePause' });
    expect(store.getState().motion.omegas).toEqual({ shaft_1: 0, shaft_2: 0 });
    expect(store.getState().scene).toBe(scene);
    expect(store.getState().history).toBe(history);
    store.dispatch({ type: 'togglePause' });
    expect(store.getState().motion.omegas.shaft_1).toBeCloseTo(running, 9);
  });

  it('一時停止中の Undo は一時停止を変えない', () => {
    const store = createStore(demoScene);
    store.dispatch({ type: 'togglePause' });
    store.dispatch({ type: 'undo' });
    expect(store.getState().sim.paused).toBe(true);
    expect(store.getState().scene).toBe(demoScene);
  });

  it('一時停止中に編集・読み込みをしても止まったまま解く', () => {
    const store = createStore(emptyScene(), { ids: createSequentialIdGenerator() });
    store.dispatch({ type: 'togglePause' });
    store.dispatch({ type: 'loadScene', scene: demoScene });
    expect(store.getState().sim.paused).toBe(true);
    expect(store.getState().motion.omegas).toEqual({ shaft_1: 0, shaft_2: 0 });
    store.dispatch({
      type: 'command',
      command: {
        type: 'addRootShaft',
        axis: 'y',
        origin: [100, 35, 0],
        gear: { size: 'M', teeth: 20 },
      },
    });
    expect(Object.values(store.getState().motion.omegas).every((w) => w === 0)).toBe(true);
  });
});

describe('情報表示（S1-23）', () => {
  it('最初は OFF。setInfoOverlay で切り替わり、値が変わらなければ知らせない', () => {
    const store = createStore(demoScene);
    expect(store.getState().view.infoOverlay).toBe(false);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'setInfoOverlay', on: false });
    expect(listener).not.toHaveBeenCalled();
    store.dispatch({ type: 'setInfoOverlay', on: true });
    expect(store.getState().view.infoOverlay).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'setInfoOverlay', on: false });
    expect(store.getState().view.infoOverlay).toBe(false);
  });

  it('シーン・履歴・眺めるモードを変えず、loadScene と Undo で保つ', () => {
    const store = createStore(demoScene);
    const { scene, history } = store.getState();
    store.dispatch({ type: 'setInfoOverlay', on: true });
    expect(store.getState().scene).toBe(scene);
    expect(store.getState().history).toBe(history);
    expect(store.getState().view.watchMode).toBe(false);
    store.dispatch({ type: 'loadScene', scene: offScene });
    store.dispatch({ type: 'undo' });
    expect(store.getState().view.infoOverlay).toBe(true);
  });
});

describe('いま開いている作品（S1-27）', () => {
  it('最初は null。setCurrentWork で変わり、同じ値なら知らせない。シーンと履歴は変えない', () => {
    const store = createStore(demoScene);
    expect(store.getState().currentWork).toBeNull();
    const { scene, history } = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'setCurrentWork', work: { id: 'w1', name: 'a' } });
    expect(store.getState().currentWork).toEqual({ id: 'w1', name: 'a' });
    expect(store.getState().scene).toBe(scene);
    expect(store.getState().history).toBe(history);
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'setCurrentWork', work: { id: 'w1', name: 'a' } });
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispatch({ type: 'setCurrentWork', work: null });
    expect(store.getState().currentWork).toBeNull();
  });
});
