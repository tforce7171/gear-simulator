import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { initialMotionState, solveMotion } from '../core/kinematics/motion';
import { resolveLayout } from '../core/layout/resolve';
import type { Scene } from '../core/scene/types';
import { infoArrowSpec } from '../render/info-arrows';
import { createInfoOverlay, INFO_REFRESH_MS } from './info-overlay';
import { createLayoutMemo, createStore } from './store';

// S1-23: 情報表示の組み立て（出す歯車、10 Hz の書き換え、毎フレームの位置）

// シーン A（資料のテストケース）
const sceneA: Scene = {
  shafts: {
    shaft_s1: { id: 'shaft_s1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
    shaft_s2: {
      id: 'shaft_s2',
      placement: { kind: 'mesh', parentGearId: 'gear_g1', childGearId: 'gear_g2', angle: 0 },
    },
    shaft_s3: {
      id: 'shaft_s3',
      placement: { kind: 'mesh', parentGearId: 'gear_g2', childGearId: 'gear_g3', angle: 0 },
    },
  },
  gears: {
    gear_g1: { id: 'gear_g1', kind: 'spur', shaftId: 'shaft_s1', size: 'S', teeth: 12, offset: 0 },
    gear_g2: { id: 'gear_g2', kind: 'spur', shaftId: 'shaft_s2', size: 'S', teeth: 36, offset: 0 },
    gear_g3: { id: 'gear_g3', kind: 'spur', shaftId: 'shaft_s3', size: 'S', teeth: 24, offset: 0 },
  },
  motors: {
    motor_m1: { id: 'motor_m1', shaftId: 'shaft_s1', size: 'S', rpm: 60, direction: 1, on: true },
  },
  anchors: {},
  carriers: {},
  racks: {},
};

function setup(scene: Scene = sceneA) {
  const store = createStore(scene);
  const setValues = vi.fn();
  const setPosition = vi.fn();
  const setArrowAngle = vi.fn();
  const setArrows = vi.fn();
  const overlay = createInfoOverlay({
    getState: () => store.getState(),
    layoutOf: createLayoutMemo(),
    getLanguage: () => 'ja',
    labels: { setValues, setPosition, setArrowAngle },
    setArrows,
    arrowSpec: infoArrowSpec,
    project: (world) => ({ x: world[0], y: world[2], visible: true }),
  });
  return { store, overlay, setValues, setPosition, setArrowAngle, setArrows };
}

describe('createInfoOverlay', () => {
  it('OFF で選択なし: ラベルも矢印も出さない', () => {
    const { overlay, setValues, setArrows } = setup();
    overlay.frame(0);
    expect(setValues).toHaveBeenLastCalledWith(new Map());
    expect(setArrows).toHaveBeenLastCalledWith([]);
    expect(overlay.arrows()).toEqual([]);
  });

  it('OFF で g2 を選択: g2 だけ（20 rpm、3.00、向き −1）', () => {
    const { store, overlay, setValues, setPosition } = setup();
    store.dispatch({ type: 'select', id: 'gear_g2' });
    overlay.frame(0);
    const values = setValues.mock.lastCall?.[0] as Map<string, { rpm: number; ratio: number }>;
    expect([...values.keys()]).toEqual(['gear_g2']);
    expect(values.get('gear_g2')?.rpm).toBeCloseTo(20, 9);
    expect(values.get('gear_g2')?.ratio).toBeCloseTo(3, 9);
    expect(overlay.arrows()).toEqual([{ gearId: 'gear_g2', direction: -1 }]);
    expect(setPosition).toHaveBeenCalledWith(
      'gear_g2',
      expect.any(Number),
      expect.any(Number),
      true,
    );
  });

  it('ON: 全歯車。一時停止すると矢印は消え、ラベルは残る', () => {
    const { store, overlay, setValues } = setup();
    store.dispatch({ type: 'setInfoOverlay', on: true });
    overlay.frame(0);
    expect(overlay.arrows().map((a) => a.gearId)).toEqual(['gear_g1', 'gear_g2', 'gear_g3']);
    store.dispatch({ type: 'togglePause' });
    overlay.frame(1);
    expect(overlay.arrows()).toEqual([]);
    const values = setValues.mock.lastCall?.[0] as Map<string, unknown>;
    expect(values.size).toBe(3);
  });

  it('前提が変わらなければ値の書き換えは 10 Hz、位置は毎フレーム', () => {
    const { store, overlay, setValues, setPosition } = setup();
    store.dispatch({ type: 'select', id: 'gear_g2' });
    overlay.frame(1000);
    overlay.frame(1000 + INFO_REFRESH_MS / 2);
    expect(setValues).toHaveBeenCalledTimes(1);
    expect(setPosition).toHaveBeenCalledTimes(2);
    overlay.frame(1000 + INFO_REFRESH_MS);
    expect(setValues).toHaveBeenCalledTimes(2);
    // 選択が変わったらすぐ
    store.dispatch({ type: 'select', id: 'gear_g3' });
    overlay.frame(1000 + INFO_REFRESH_MS + 1);
    expect(setValues).toHaveBeenCalledTimes(3);
  });
});

// S3-05: キャリアの rpm とラックの速度・向き
function fixture(name: string): Scene {
  const url = new URL(`../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

describe('キャリアとラックの情報（S3-05）', () => {
  it('ON: planetary-ring-fixed のキャリアは 20 rpm（太陽 60 rpm、リング固定）', () => {
    const scene = fixture('planetary-ring-fixed');
    const { store, overlay, setValues, setPosition } = setup(scene);
    store.setMotion(solveMotion(scene, resolveLayout(scene), initialMotionState()));
    store.dispatch({ type: 'setInfoOverlay', on: true });
    overlay.frame(0);
    const values = setValues.mock.lastCall?.[0] as Map<string, { kind?: string; rpm: number }>;
    expect(values.get('carrier_k')?.kind).toBe('carrier');
    expect(values.get('carrier_k')?.rpm).toBeCloseTo(20, 9);
    // 遊星は自転の rpm（シャフトの ω。60 rpm の逆向き）
    expect(values.get('gear_p0')?.rpm).toBeCloseTo(60, 9);
    expect(setPosition).toHaveBeenCalledWith(
      'carrier_k',
      expect.any(Number),
      expect.any(Number),
      true,
    );
  });

  it('OFF でラックを選択: ラックだけ。rack-basic の速さは 40π mm/s、向きの矢印の角度を毎フレーム渡す', () => {
    const scene = fixture('rack-basic');
    const { store, overlay, setValues, setArrowAngle } = setup(scene);
    store.setMotion(solveMotion(scene, resolveLayout(scene), initialMotionState()));
    store.dispatch({ type: 'select', id: 'rack_r' });
    overlay.frame(0);
    const values = setValues.mock.lastCall?.[0] as Map<
      string,
      { kind?: string; speed: number; direction: number }
    >;
    expect([...values.keys()]).toEqual(['rack_r']);
    expect(values.get('rack_r')?.kind).toBe('rack');
    expect(values.get('rack_r')?.speed).toBeCloseTo(40 * Math.PI, 9);
    expect(Math.abs(values.get('rack_r')?.direction ?? 0)).toBe(1);
    // project は (x, z) を画面にするので、x 向きのラックの矢印は 0 か π
    const angle = setArrowAngle.mock.lastCall?.[1] as number;
    expect(Math.abs(Math.cos(angle))).toBeCloseTo(1, 9);
  });
});
