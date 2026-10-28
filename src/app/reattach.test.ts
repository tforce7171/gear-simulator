import { describe, expect, it } from 'vitest';
import { applyCommand } from '../core/edit/commands';
import { resolveLayout } from '../core/layout/resolve';
import type { Vec3 } from '../core/math/vec3';
import { createSequentialIdGenerator } from '../core/scene/ids';
import type { Scene } from '../core/scene/types';
import { applyReattach, reattachCandidates, reattachCommand } from './reattach';

// reattach.json 相当: 縦軸の起点のシャフト A（原点 [0, 35, 0]、中・20 歯、中のモーター）と、
// detached のシャフト D（origin [100, 35, 0]、axis y）に中・20 歯の P（offset 0）。
// P の外周に子 Q（中・20 歯、angle 0）
function reattachScene(aSize: 'S' | 'M' = 'M'): Scene {
  return {
    shafts: {
      shaft_a: { id: 'shaft_a', placement: { kind: 'root', origin: [0, 35, 0], axis: 'y' } },
      shaft_d: {
        id: 'shaft_d',
        placement: { kind: 'detached', origin: [100, 35, 0], axis: 'y' },
      },
      shaft_q: {
        id: 'shaft_q',
        placement: { kind: 'mesh', parentGearId: 'gear_p', childGearId: 'gear_q', angle: 0 },
      },
    },
    gears: {
      gear_a: {
        id: 'gear_a',
        kind: 'spur',
        shaftId: 'shaft_a',
        size: aSize,
        teeth: aSize === 'M' ? 20 : 30,
        offset: 0,
      },
      gear_p: { id: 'gear_p', kind: 'spur', shaftId: 'shaft_d', size: 'M', teeth: 20, offset: 0 },
      gear_q: { id: 'gear_q', kind: 'spur', shaftId: 'shaft_q', size: 'M', teeth: 20, offset: 0 },
    },
    motors: {
      motor_a: {
        id: 'motor_a',
        shaftId: 'shaft_a',
        size: 'M',
        rpm: 30,
        direction: 1,
        on: true,
      },
    },
    anchors: {},
    carriers: {},
    racks: {},
  };
}

function distance(a: Vec3 | undefined, b: Vec3 | undefined): number {
  if (a === undefined || b === undefined) throw new Error('位置が無い');
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('reattachCandidates', () => {
  it('D → parentGearId が A の候補があり、P・Q の候補は無い（循環）。新たな干渉のある角度は除く', () => {
    const scene = reattachScene();
    const layout = resolveLayout(scene);
    const list = reattachCandidates(scene, layout, 'shaft_d');
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.parentGearId === 'gear_a' && c.childGearId === 'gear_p')).toBe(true);
    // 8 方向のうち、付け直したシーンで新たな干渉ができないものだけ
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4;
      const found = list.find((c) => Math.abs(c.angle - angle) < 1e-12);
      const result = applyCommand(
        scene,
        {
          type: 'reattachShaft',
          shaftId: 'shaft_d',
          childGearId: 'gear_p',
          parentGearId: 'gear_a',
          angle,
        },
        { ids: createSequentialIdGenerator() },
      );
      if (!result.ok) throw new Error(result.error.message);
      const clean = resolveLayout(result.scene).interferences.length === 0;
      expect(found !== undefined).toBe(clean);
    }
  });

  it('A の外周の候補のうち、Q が A に重なる角度（3π/4・π・5π/4）のものは無い', () => {
    const scene = reattachScene();
    const list = reattachCandidates(scene, resolveLayout(scene), 'shaft_d');
    const angles = list.map((c) => c.angle);
    for (const k of [3, 4, 5]) {
      expect(angles.some((a) => Math.abs(a - (k * Math.PI) / 4) < 1e-9)).toBe(false);
    }
    expect(angles.some((a) => Math.abs(a - Math.PI / 2) < 1e-9)).toBe(true);
    // 表示とポインターの判定に使う、付け直した後の P の中心
    const plusX = list.find((c) => Math.abs(c.angle - Math.PI / 2) < 1e-9);
    expect(plusX?.childCenter[0]).toBeCloseTo(40, 9);
    expect(plusX?.childCenter[1]).toBeCloseTo(39, 9);
    expect(plusX?.childCenter[2]).toBeCloseTo(0, 9);
  });

  it('A を小の歯車にしたシーン → []（同じ大きさの歯車が無い）', () => {
    const scene = reattachScene('S');
    expect(reattachCandidates(scene, resolveLayout(scene), 'shaft_d')).toEqual([]);
  });

  it('root のシャフトを渡す → []', () => {
    const scene = reattachScene();
    expect(reattachCandidates(scene, resolveLayout(scene), 'shaft_a')).toEqual([]);
  });

  it('候補を reattachShaft で適用 → D が mesh（親 A、子 P）、A-P と P-Q の中心距離 40 のまま', () => {
    const scene = reattachScene();
    const candidate = reattachCandidates(scene, resolveLayout(scene), 'shaft_d')[0];
    if (candidate === undefined) throw new Error('候補が無い');
    expect(reattachCommand('shaft_d', candidate)).toEqual({
      type: 'reattachShaft',
      shaftId: 'shaft_d',
      childGearId: 'gear_p',
      parentGearId: 'gear_a',
      angle: candidate.angle,
    });
    const next = applyReattach(scene, 'shaft_d', candidate);
    if (next === null) throw new Error('付け直せない');
    expect(next.shafts.shaft_d?.placement).toEqual({
      kind: 'mesh',
      parentGearId: 'gear_a',
      childGearId: 'gear_p',
      angle: candidate.angle,
    });
    const layout = resolveLayout(next);
    expect(distance(layout.gears.gear_a?.center, layout.gears.gear_p?.center)).toBeCloseTo(40, 9);
    expect(distance(layout.gears.gear_p?.center, layout.gears.gear_q?.center)).toBeCloseTo(40, 9);
    expect(layout.gears.gear_p?.center).toEqual(candidate.childCenter);
  });
});
