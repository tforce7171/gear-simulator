import { describe, expect, it } from 'vitest';
import type { Scene } from '../../core/scene/types';
import {
  buildContextMenuItems,
  type ContextTarget,
  placeMenu,
  targetAnchorId,
  targetShaftId,
} from './items';

// シャフト s1（モーターあり）に歯車 g1、シャフト s2（モーターなし）に歯車 g2
const scene: Scene = {
  shafts: {
    shaft_s1: { id: 'shaft_s1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
    shaft_s2: { id: 'shaft_s2', placement: { kind: 'root', origin: [100, 20, 0], axis: 'y' } },
  },
  gears: {
    gear_g1: { id: 'gear_g1', kind: 'spur', shaftId: 'shaft_s1', size: 'S', teeth: 12, offset: 0 },
    gear_g2: { id: 'gear_g2', kind: 'spur', shaftId: 'shaft_s2', size: 'S', teeth: 36, offset: 0 },
  },
  motors: {
    motor_m1: { id: 'motor_m1', shaftId: 'shaft_s1', size: 'S', rpm: 60, direction: 1, on: true },
  },
  anchors: {},
  carriers: {},
};

const state = (watchMode: boolean, infoOverlay: boolean) => ({
  scene,
  view: { watchMode, infoOverlay },
});
const part = (partId: string): ContextTarget => ({ kind: 'part', partId, point: [0, 0, 0] });

describe('targetShaftId', () => {
  it('シャフト → 自身', () => {
    expect(targetShaftId(scene, 'shaft_s2')).toBe('shaft_s2');
  });
  it('歯車 → その shaftId', () => {
    expect(targetShaftId(scene, 'gear_g2')).toBe('shaft_s2');
  });
  it('存在しない ID → null', () => {
    expect(targetShaftId(scene, 'gear_nope')).toBeNull();
    expect(targetShaftId(scene, 'motor_m1')).toBeNull();
  });
});

describe('buildContextMenuItems', () => {
  const actions = (items: ReturnType<typeof buildContextMenuItems>) => items.map((i) => i.action);

  it('歯車（シャフトにモーターなし）→ delete・attachMotor・anchor・focusHere', () => {
    expect(actions(buildContextMenuItems(part('gear_g2'), state(false, false)))).toEqual([
      'delete',
      'attachMotor',
      'anchor',
      'focusHere',
    ]);
  });
  it('歯車（シャフトにモーターあり）→ delete・detachMotor・anchor・focusHere', () => {
    expect(actions(buildContextMenuItems(part('gear_g1'), state(false, false)))).toEqual([
      'delete',
      'detachMotor',
      'anchor',
      'focusHere',
    ]);
  });
  it('モーターの付いたシャフト → delete・detachMotor・anchor・focusHere', () => {
    expect(actions(buildContextMenuItems(part('shaft_s1'), state(false, false)))).toEqual([
      'delete',
      'detachMotor',
      'anchor',
      'focusHere',
    ]);
  });
  it('固定したシャフト・その歯車 → anchor の代わりに unanchor（S3-01）', () => {
    const anchored: Scene = {
      ...scene,
      anchors: { anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 'shaft_s2' } } },
    };
    const view = { watchMode: false, infoOverlay: false };
    for (const id of ['shaft_s2', 'gear_g2']) {
      expect(actions(buildContextMenuItems(part(id), { scene: anchored, view }))).toEqual([
        'delete',
        'attachMotor',
        'unanchor',
        'focusHere',
      ]);
      expect(targetAnchorId(anchored, id)).toBe('anchor_1');
    }
    expect(targetAnchorId(anchored, 'gear_g1')).toBeNull();
  });
  it('何もない所、眺めるモード OFF・情報表示 ON → frameAll・toggleWatch・toggleInfo とチェックの印', () => {
    const items = buildContextMenuItems({ kind: 'empty' }, state(false, true));
    expect(actions(items)).toEqual(['frameAll', 'toggleWatch', 'toggleInfo']);
    expect(items.find((i) => i.action === 'toggleWatch')?.checked).toBe(false);
    expect(items.find((i) => i.action === 'toggleInfo')?.checked).toBe(true);
    expect(items.find((i) => i.action === 'frameAll')?.checked).toBeUndefined();
  });
  it('部品の項目にはチェックの印が無く、表示名のキーは contextMenu.<action>', () => {
    for (const item of buildContextMenuItems(part('gear_g2'), state(true, true))) {
      expect(item.checked).toBeUndefined();
      expect(item.labelKey).toBe(`contextMenu.${item.action}`);
    }
  });
});

describe('placeMenu（viewport 1000×800、menu 200×150）', () => {
  const viewport = { width: 1000, height: 800 };
  const menu = { width: 200, height: 150 };
  it('収まるならカーソルの右下', () => {
    expect(placeMenu({ x: 100, y: 100 }, menu, viewport)).toEqual({ left: 100, top: 100 });
  });
  it('右にはみ出すなら左に反転', () => {
    expect(placeMenu({ x: 900, y: 100 }, menu, viewport)).toEqual({ left: 700, top: 100 });
  });
  it('下にはみ出すなら上に反転', () => {
    expect(placeMenu({ x: 100, y: 700 }, menu, viewport)).toEqual({ left: 100, top: 550 });
  });
  it('右下の隅では左上に反転', () => {
    expect(placeMenu({ x: 950, y: 750 }, menu, viewport)).toEqual({ left: 750, top: 600 });
  });
  it('反転しても足りなければ画面の端に寄せる（menu 200×900 → top 0）', () => {
    expect(placeMenu({ x: 100, y: 100 }, { width: 200, height: 900 }, viewport).top).toBe(0);
  });
});
