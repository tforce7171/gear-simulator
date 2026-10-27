import { describe, expect, it } from 'vitest';
import { parseScene } from './parse';
import type { Scene } from './types';

// 生の値の形の確認（S1-28）。意味の確認は validate.test.ts

const demoScene: Scene = {
  shafts: {
    shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
    shaft_2: {
      id: 'shaft_2',
      placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: 1 },
    },
  },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'M', teeth: 20, offset: 0 },
    gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'M', teeth: 30, offset: 0 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'M', rpm: 30, direction: 1, on: true },
  },
};

// demoScene を生データにして、点区切りの場所の値を書き換えたものを返す
function sceneWith(edits: Record<string, unknown> = {}): unknown {
  const raw: unknown = JSON.parse(JSON.stringify(demoScene));
  for (const [path, value] of Object.entries(edits)) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    let target = raw as Record<string, unknown>;
    for (const key of keys) target = target[key] as Record<string, unknown>;
    target[last] = value;
  }
  return raw;
}

function firstPath(raw: unknown): string | undefined {
  const result = parseScene(raw);
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.errors[0]?.path;
}

describe('parseScene', () => {
  it('型どおりのシーンはそのまま（別の参照で等しい）', () => {
    const result = parseScene(sceneWith());
    expect(result).toEqual({ ok: true, scene: demoScene });
  });

  it('shafts・gears・motors が通常のオブジェクトでない', () => {
    expect(firstPath({ shafts: {}, gears: [], motors: {} })).toBe('gears');
    expect(firstPath({ shafts: {}, gears: {} })).toBe('motors');
    expect(firstPath(null)).toBe('');
  });

  it('ID の接頭辞が種類に合わない', () => {
    const raw = { shafts: { gear_1: { id: 'gear_1' } }, gears: {}, motors: {} };
    expect(firstPath(raw)).toBe('shafts.gear_1');
    const raw2 = { shafts: {}, gears: {}, motors: { motor_1: { id: 'gear_1' } } };
    expect(firstPath(raw2)).toBe('motors.motor_1.id');
  });

  it('__proto__ のキーは接頭辞の確認で弾く', () => {
    const raw = JSON.parse('{"shafts":{"__proto__":{"id":"shaft_1"}},"gears":{},"motors":{}}');
    expect(firstPath(raw)).toBe('shafts.__proto__');
  });

  it('知らない placement の kind', () => {
    const raw = sceneWith({ 'shafts.shaft_1.placement': { kind: 'floating' } });
    expect(firstPath(raw)).toBe('shafts.shaft_1.placement.kind');
  });

  it('歯車の kind・size、モーターの on', () => {
    expect(firstPath(sceneWith({ 'gears.gear_1.kind': 'helical' }))).toBe('gears.gear_1.kind');
    expect(firstPath(sceneWith({ 'gears.gear_1.size': 'XL' }))).toBe('gears.gear_1.size');
    expect(firstPath(sceneWith({ 'motors.motor_1.on': 1 }))).toBe('motors.motor_1.on');
  });

  it('数の代わりに文字列', () => {
    expect(firstPath(sceneWith({ 'gears.gear_1.teeth': '12' }))).toBe('gears.gear_1.teeth');
  });
});
