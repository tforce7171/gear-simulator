// e2e から移した、window.__gearSim 経由で純粋なロジックだけを確かめていたテスト。
// __gearSim（main.ts の installGearSim）と同じ経路で、createStore・createLayoutMemo・runFrame を直接使う。
// 実時間を待つ代わりに、runFrame を一定の dt で決まった回数呼んで運動を進める

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Command } from '../core/edit/commands';
import { emptyScene } from '../core/scene/scene';
import type { Scene } from '../core/scene/types';
import type { SceneView } from '../render/scene-view';
import { runFrame } from './loop';
import { createLayoutMemo, createStore } from './store';

function fixture(name: string): Scene {
  const url = new URL(`../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

// 描画は何もしない（運動の更新だけを確かめる）
const view: SceneView = {
  sync() {},
  update() {},
  render() {},
  projectToScreen: () => ({ x: 0, y: 0 }),
};

// 1 フレームの経過時間（秒）と、e2e で待っていた 500ms に当たるフレーム数
const FRAME_DT = 1 / 60;
const HALF_SECOND_FRAMES = 30;

// main.ts の __gearSim と同じ配線（ストアとレイアウトのメモ）を、描画なしで組み立てる
function createSim() {
  const store = createStore(emptyScene());
  const layoutOf = createLayoutMemo();
  return {
    getScene: () => store.getState().scene,
    getLayout: () => layoutOf(store.getState().scene),
    getMotion: () => store.getState().motion,
    loadScene: (scene: Scene) => store.dispatch({ type: 'loadScene', scene }),
    dispatch: (command: Command) => store.dispatch({ type: 'command', command }),
    undo: () => store.dispatch({ type: 'undo' }),
    // e2e で実時間を待っていた代わりに、アプリのループと同じ runFrame で運動を進める
    advance(frames: number, dt = FRAME_DT) {
      for (let i = 0; i < frames; i++) runFrame({ store, view, layoutOf }, dt);
    },
  };
}

describe('collision.spec', () => {
  it('overlap: 重なる 2 枚の歯車 → interferences が [gear_1, gear_2]', () => {
    const sim = createSim();
    sim.loadScene(fixture('overlap'));
    expect(sim.getLayout().interferences).toEqual([['gear_1', 'gear_2']]);
  });

  it('two-spur: かみ合っている組は干渉にならない → []', () => {
    const sim = createSim();
    sim.loadScene(fixture('two-spur'));
    expect(sim.getLayout().interferences).toEqual([]);
  });
});

describe('layout-tree.spec', () => {
  it('square-loop: 四角形の閉じる組が contact のかみ合いになる', () => {
    const sim = createSim();
    sim.loadScene(fixture('square-loop'));
    const layout = sim.getLayout();
    expect(layout.meshes.filter((m) => m.source === 'contact')).toHaveLength(1);
  });

  it('triangle: 正三角形の閉じる組が contact、干渉なし', () => {
    const sim = createSim();
    sim.loadScene(fixture('triangle'));
    const layout = sim.getLayout();
    expect(layout.meshes.filter((m) => m.source === 'contact')).toHaveLength(1);
    expect(layout.interferences).toEqual([]);
  });
});

describe('force-balance.spec', () => {
  it('逆向きのモーター: 強い M が勝ち、±30rpm になる', () => {
    const sim = createSim();
    sim.loadScene(fixture('opposing-motors'));
    const { omegas } = sim.getMotion();
    expect(omegas.shaft_1 ?? Number.NaN).toBeCloseTo(-Math.PI, 6);
    expect(omegas.shaft_2 ?? Number.NaN).toBeCloseTo(Math.PI, 6);
  });
});

describe('lock-detection.spec', () => {
  it('stalemate: 12 歯どうしに同じ向きの S 60rpm → ロックし、角度が変わらない', () => {
    const sim = createSim();
    sim.loadScene(fixture('stalemate'));
    const before = sim.getMotion();
    expect(before.locks[0]?.reason).toBe('stalemate');
    expect(before.locks[0]?.shaftIds).toEqual(['shaft_1', 'shaft_2']);
    expect(before.locks[0]?.gearIds).toEqual(['gear_1', 'gear_2']);
    sim.advance(HALF_SECOND_FRAMES);
    const after = sim.getMotion();
    expect(after.locks[0]?.reason).toBe('stalemate');
    expect(after.angles).toEqual(before.angles);
  });

  it('two-spur.json: ロックなし、ω の比は −0.5', () => {
    const sim = createSim();
    sim.loadScene(fixture('two-spur'));
    const motion = sim.getMotion();
    expect(motion.locks).toEqual([]);
    expect(motion.backDriven).toEqual([]);
    const w1 = motion.omegas.shaft_1 ?? Number.NaN;
    const w2 = motion.omegas.shaft_2 ?? Number.NaN;
    expect(w2 / w1).toBeCloseTo(-0.5, 6);
  });
});

describe('edit-history.spec', () => {
  it('dispatch で基本のシーンを作ると回り、undo 5 回で空に戻る', () => {
    const sim = createSim();
    sim.loadScene({
      shafts: {},
      gears: {},
      motors: {},
      anchors: {},
      carriers: {},
      racks: {},
    });

    // 基本のシーン（S1-11 の資料）を作る 5 コマンド。アプリの ID はランダムなので、
    // 前のコマンドで増えた部品の ID を次のコマンドに埋める。起点のシャフト（資料の shaft_1）を覚えておく
    const added = (before: object, after: object): string =>
      Object.keys(after).find((id) => !(id in before)) ?? '';
    const s0 = sim.getScene();
    sim.dispatch({
      type: 'addRootShaft',
      axis: 'y',
      origin: [0, 20, 0],
      gear: { size: 'S', teeth: 12 },
    });
    const s1 = sim.getScene();
    const rootShaft = added(s0.shafts, s1.shafts);
    const gear1 = added(s0.gears, s1.gears);
    sim.dispatch({
      type: 'growGear',
      mode: 'perimeter',
      parentGearId: gear1,
      angle: Math.PI / 2,
      teeth: 24,
    });
    const s2 = sim.getScene();
    const shaft2 = added(s1.shafts, s2.shafts);
    sim.dispatch({
      type: 'growGear',
      mode: 'coaxial',
      shaftId: shaft2,
      offset: 4,
      size: 'S',
      teeth: 24,
    });
    const s3 = sim.getScene();
    const gear3 = added(s2.gears, s3.gears);
    sim.dispatch({ type: 'growGear', mode: 'perimeter', parentGearId: gear3, angle: 0, teeth: 12 });
    sim.dispatch({ type: 'addMotor', shaftId: rootShaft, size: 'S' });

    const scene = sim.getScene();
    expect(Object.keys(scene.gears)).toHaveLength(4);
    expect(Object.keys(scene.motors)).toHaveLength(1);

    const angle = () => sim.getMotion().angles[rootShaft] ?? Number.NaN;
    const before = angle();
    sim.advance(HALF_SECOND_FRAMES);
    expect(angle()).toBeGreaterThan(before);

    for (let i = 0; i < 5; i++) sim.undo();
    expect(sim.getScene()).toEqual({
      shafts: {},
      gears: {},
      motors: {},
      anchors: {}, // S3-01
      carriers: {},
      racks: {}, // S3-03
    });
  });
});
