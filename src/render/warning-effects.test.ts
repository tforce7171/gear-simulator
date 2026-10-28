import { describe, expect, it } from 'vitest';
import { emptyMotion, type MotionState } from '../core/kinematics/types';
import { resolveLayout } from '../core/layout/resolve';
import type { Scene } from '../core/scene/types';
import {
  LOCK_SHAKE_AMPLITUDE,
  lockGlowIntensity,
  lockShakeAngle,
  warningParts,
} from './warning-effects';

describe('lockShakeAngle', () => {
  it('0〜10 秒のすべての点で |値| ≤ LOCK_SHAKE_AMPLITUDE', () => {
    expect(LOCK_SHAKE_AMPLITUDE).toBe(0.01);
    for (let i = 0; i <= 10000; i++) {
      const t = i / 1000;
      for (const seed of [0, 1, 7, 123]) {
        expect(Math.abs(lockShakeAngle(t, seed))).toBeLessThanOrEqual(LOCK_SHAKE_AMPLITUDE);
      }
    }
  });

  it('時間とともに値が変わる（定数でない）', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) values.add(lockShakeAngle(i * 0.013, 3));
    expect(values.size).toBeGreaterThan(50);
  });

  it('seed が違うと同じ時刻でも値が違う', () => {
    for (const t of [0.1, 0.37, 2.5]) {
      expect(lockShakeAngle(t, 1)).not.toBeCloseTo(lockShakeAngle(t, 2), 6);
    }
  });
});

describe('lockGlowIntensity', () => {
  it('値が 0〜1 に収まり、1 秒の間に最大と最小の差が 0.5 以上ある', () => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= 1000; i++) {
      const v = lockGlowIntensity(i / 1000);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(max - min).toBeGreaterThanOrEqual(0.5);
  });
});

describe('warningParts', () => {
  // ロックする成分（shaft_1・shaft_2、gear_1・gear_2、motor_1・motor_2）と、
  // 別の成分（shaft_3・gear_3・motor_3）と、干渉する成分（shaft_4・gear_4、shaft_5・gear_5）
  const scene: Scene = {
    shafts: {
      shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } },
      shaft_2: {
        id: 'shaft_2',
        placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: 0 },
      },
      shaft_3: { id: 'shaft_3', placement: { kind: 'root', origin: [200, 0, 0], axis: 'y' } },
      shaft_4: { id: 'shaft_4', placement: { kind: 'root', origin: [-200, 0, 0], axis: 'y' } },
      shaft_5: { id: 'shaft_5', placement: { kind: 'root', origin: [-190, 0, 0], axis: 'y' } },
    },
    gears: {
      gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'M', teeth: 20, offset: 0 },
      gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'M', teeth: 20, offset: 0 },
      gear_3: { id: 'gear_3', kind: 'spur', shaftId: 'shaft_3', size: 'M', teeth: 20, offset: 0 },
      gear_4: { id: 'gear_4', kind: 'spur', shaftId: 'shaft_4', size: 'S', teeth: 12, offset: 0 },
      gear_5: { id: 'gear_5', kind: 'spur', shaftId: 'shaft_5', size: 'S', teeth: 12, offset: 0 },
    },
    motors: {
      motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'S', rpm: 60, direction: 1, on: true },
      motor_2: { id: 'motor_2', shaftId: 'shaft_2', size: 'S', rpm: 60, direction: 1, on: true },
      motor_3: { id: 'motor_3', shaftId: 'shaft_3', size: 'S', rpm: 60, direction: 1, on: true },
    },
    anchors: {},
    carriers: {},
    racks: {},
  };
  const layout = resolveLayout(scene);
  const motion: MotionState = {
    ...emptyMotion(),
    locks: [
      { reason: 'stalemate', shaftIds: ['shaft_1', 'shaft_2'], gearIds: ['gear_1', 'gear_2'] },
    ],
  };

  it('ロックした成分の歯車・シャフト・モーターがすべて locked に入り、他の成分は入らない', () => {
    const { locked } = warningParts(scene, { ...layout, interferences: [] }, motion);
    expect([...locked].sort()).toEqual([
      'gear_1',
      'gear_2',
      'motor_1',
      'motor_2',
      'shaft_1',
      'shaft_2',
    ]);
  });

  it('干渉の組の部品は interfering に入る', () => {
    expect(layout.interferences).toContainEqual(['gear_4', 'gear_5']);
    const { interfering } = warningParts(scene, layout, emptyMotion());
    expect(interfering.has('gear_4')).toBe(true);
    expect(interfering.has('gear_5')).toBe(true);
    expect(interfering.has('gear_3')).toBe(false);
  });

  it('locked にも入っている部品は interfering から除く', () => {
    const { locked, interfering } = warningParts(
      scene,
      { ...layout, interferences: [['gear_2', 'gear_3']] },
      motion,
    );
    expect(locked.has('gear_2')).toBe(true);
    expect(interfering.has('gear_2')).toBe(false);
    expect(interfering.has('gear_3')).toBe(true);
  });

  it('ロックも干渉も無ければ空', () => {
    const { locked, interfering } = warningParts(
      scene,
      { ...layout, interferences: [] },
      emptyMotion(),
    );
    expect(locked.size).toBe(0);
    expect(interfering.size).toBe(0);
  });
});
