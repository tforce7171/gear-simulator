import { describe, expect, it } from 'vitest';
import { samePhase } from '../geometry/mesh';
import type { Scene } from '../scene/types';
import { resolveLayout } from './resolve';

// S1-04 の固定シーン（src/app/demo-scene.ts と同じ）
const twoSpur: Scene = {
  shafts: {
    shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
    shaft_2: {
      id: 'shaft_2',
      placement: {
        kind: 'mesh',
        parentGearId: 'gear_1',
        childGearId: 'gear_2',
        angle: Math.PI / 2,
      },
    },
  },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
    gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 24, offset: 0 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'S', rpm: 60, direction: 1, on: true },
  },
};

function expectVec(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined();
  expected.forEach((e, i) => {
    expect(actual?.[i]).toBeCloseTo(e, 9);
  });
}

describe('resolveLayout（暫定）', () => {
  const layout = resolveLayout(twoSpur);

  it('歯車の中心', () => {
    expectVec(layout.gears.gear_1?.center, [0, 22, 0]);
    expectVec(layout.gears.gear_2?.center, [18, 22, 0]);
  });

  it('mesh のシャフトの原点と向き', () => {
    expectVec(layout.shafts.shaft_2?.origin, [18, 20, 0]);
    expect(layout.shafts.shaft_2?.axis).toBe('y');
    expect(layout.shafts.shaft_1?.axis).toBe('y');
  });

  it('位相: 根は 0、子は meshPhase（π/24 を 2π/24 を法として）', () => {
    expect(layout.gears.gear_1?.basePhase).toBe(0);
    const phase = layout.gears.gear_2?.basePhase ?? Number.NaN;
    expect(samePhase(phase, Math.PI / 24, 24)).toBe(true);
  });

  it('ピッチ円半径', () => {
    expect(layout.gears.gear_1?.pitchRadius).toBe(6);
    expect(layout.gears.gear_2?.pitchRadius).toBe(12);
  });

  it('meshes は木の親子だけ、かみ合っている組は干渉にしない', () => {
    expect(layout.meshes).toEqual([{ a: 'gear_1', b: 'gear_2', source: 'tree' }]);
    expect(layout.interferences).toEqual([]);
  });

  it('span は載っている歯車の両端', () => {
    expect(layout.shafts.shaft_1?.span).toEqual([0, 4]);
  });

  it('子の offset は 0 として、親の offset の面にそろう。子以外の歯車の位相は 0', () => {
    const scene: Scene = {
      ...twoSpur,
      gears: {
        ...twoSpur.gears,
        gear_1: { ...(twoSpur.gears.gear_1 as Scene['gears'][string]), offset: 8 },
        gear_3: { id: 'gear_3', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 20, offset: 4 },
      },
    };
    const l = resolveLayout(scene);
    expectVec(l.shafts.shaft_2?.origin, [18, 28, 0]);
    expectVec(l.gears.gear_2?.center, [18, 30, 0]);
    expectVec(l.gears.gear_3?.center, [18, 34, 0]);
    expect(l.gears.gear_3?.basePhase).toBe(0);
    expect(l.shafts.shaft_2?.span).toEqual([0, 8]);
  });

  it('根にたどり着かないシャフトと歯車は含めない', () => {
    const scene: Scene = {
      ...twoSpur,
      shafts: {
        ...twoSpur.shafts,
        shaft_9: {
          id: 'shaft_9',
          placement: { kind: 'mesh', parentGearId: 'gear_x', childGearId: 'gear_9', angle: 0 },
        },
      },
      gears: {
        ...twoSpur.gears,
        gear_9: { id: 'gear_9', kind: 'spur', shaftId: 'shaft_9', size: 'S', teeth: 12, offset: 0 },
      },
    };
    const l = resolveLayout(scene);
    expect(l.shafts.shaft_9).toBeUndefined();
    expect(l.gears.gear_9).toBeUndefined();
    expect(l.meshes).toHaveLength(1);
  });

  it('interferences: 重なる 2 枚の歯車（別々の根のシャフト）→ その組だけ', () => {
    const scene: Scene = {
      shafts: {
        shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
        shaft_2: { id: 'shaft_2', placement: { kind: 'root', origin: [10, 20, 0], axis: 'y' } },
      },
      gears: {
        gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
        gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 12, offset: 0 },
      },
      motors: {},
    };
    expect(resolveLayout(scene).interferences).toEqual([['gear_1', 'gear_2']]);
  });

  it('interferences: 他の歯車を貫くシャフトも組に入る', () => {
    const scene: Scene = {
      shafts: {
        shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
        shaft_2: { id: 'shaft_2', placement: { kind: 'root', origin: [3, 16, 0], axis: 'y' } },
      },
      gears: {
        gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
        // shaft_2 の span は [0, 12]（y 16〜28）で、gear_1（y 20〜24、半径 7）を貫く
        gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 12, offset: 0 },
        gear_3: { id: 'gear_3', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 12, offset: 8 },
      },
      motors: {},
    };
    // gear_2（y 16〜20）と gear_3（y 24〜28）は gear_1 と面で接するだけ
    expect(resolveLayout(scene).interferences).toEqual([['gear_1', 'shaft_2']]);
  });
});
