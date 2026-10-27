import { describe, expect, it } from 'vitest';
import type { Scene } from '../scene/types';
import { parseSaveFileObject, toSaveFile } from './save-file';

const sceneA: Scene = {
  shafts: {
    shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
    shaft_2: {
      id: 'shaft_2',
      placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: 0 },
    },
  },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
    gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 36, offset: 0 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'S', rpm: 60, direction: 1, on: true },
  },
};

describe('toSaveFile', () => {
  it('format・version 1・同じシーンの参照', () => {
    const file = toSaveFile(sceneA);
    expect(file).toEqual({ format: 'gear-simulator', version: 1, scene: sceneA });
    expect(file.scene).toBe(sceneA);
  });
});

describe('parseSaveFileObject', () => {
  it('toSaveFile の結果は ok で同じシーン', () => {
    const result = parseSaveFileObject(toSaveFile(sceneA));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.scene).toEqual(sceneA);
  });

  it('空のシーンも ok', () => {
    expect(parseSaveFileObject(toSaveFile({ shafts: {}, gears: {}, motors: {} })).ok).toBe(true);
  });

  const gear1 = sceneA.gears.gear_1;
  if (gear1 === undefined) throw new Error('sceneA が想定と違う');
  const bad: Array<[string, unknown]> = [
    ['undefined', undefined],
    ["format: 'other'", { format: 'other' }],
    ['version: 2', { format: 'gear-simulator', version: 2, scene: sceneA }],
    ['scene: { shafts: 1 }', { format: 'gear-simulator', version: 1, scene: { shafts: 1 } }],
    [
      '歯数 81 の歯車',
      toSaveFile({ ...sceneA, gears: { ...sceneA.gears, gear_1: { ...gear1, teeth: 81 } } }),
    ],
    // 部品の形が崩れていて validateScene が例外を投げうる値
    [
      '歯車が null',
      {
        format: 'gear-simulator',
        version: 1,
        scene: { shafts: {}, gears: { g: null }, motors: {} },
      },
    ],
    ['null', null],
    ['配列', []],
  ];
  for (const [name, raw] of bad) {
    it(`${name} は ok: false（例外を投げない）`, () => {
      expect(() => parseSaveFileObject(raw)).not.toThrow();
      expect(parseSaveFileObject(raw).ok).toBe(false);
    });
  }
});
