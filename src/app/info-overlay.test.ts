import { describe, expect, it, vi } from 'vitest';
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
};

function setup() {
  const store = createStore(sceneA);
  const setValues = vi.fn();
  const setPosition = vi.fn();
  const setArrows = vi.fn();
  const overlay = createInfoOverlay({
    getState: () => store.getState(),
    layoutOf: createLayoutMemo(),
    getLanguage: () => 'ja',
    labels: { setValues, setPosition },
    setArrows,
    arrowSpec: infoArrowSpec,
    project: (world) => ({ x: world[0], y: world[2], visible: true }),
  });
  return { store, overlay, setValues, setPosition, setArrows };
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
