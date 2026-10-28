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
    expect(firstPath(sceneWith({ 'gears.gear_1.kind': 'bogus' }))).toBe('gears.gear_1.kind');
    expect(firstPath(sceneWith({ 'gears.gear_1.size': 'XL' }))).toBe('gears.gear_1.size');
    expect(firstPath(sceneWith({ 'motors.motor_1.on': 1 }))).toBe('motors.motor_1.on');
  });

  it('数の代わりに文字列', () => {
    expect(firstPath(sceneWith({ 'gears.gear_1.teeth': '12' }))).toBe('gears.gear_1.teeth');
  });
});

describe('parseScene: ハスバ歯車（S2-01）', () => {
  const helical = {
    'gears.gear_1.kind': 'helical',
    'gears.gear_1.hand': 'right',
    'gears.gear_2.kind': 'helical',
    'gears.gear_2.hand': 'left',
  };

  it("'helical' と hand を読み、hand を残す（知らないフィールドは捨てる）", () => {
    const result = parseScene(sceneWith({ ...helical, 'gears.gear_1.extra': 1 }));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.scene.gears.gear_1).toEqual({
      id: 'gear_1',
      kind: 'helical',
      hand: 'right',
      shaftId: 'shaft_1',
      size: 'M',
      teeth: 20,
      offset: 0,
    });
    expect(result.scene.gears.gear_2).toMatchObject({ kind: 'helical', hand: 'left' });
  });

  it('平歯車の hand は捨てる', () => {
    const result = parseScene(sceneWith({ 'gears.gear_1.hand': 'right' }));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.scene.gears.gear_1).not.toHaveProperty('hand');
  });

  it('hand が無い・文字列でない → 形の誤り。値が違う → validateScene の invalidHand', () => {
    expect(firstPath(sceneWith({ ...helical, 'gears.gear_1.hand': undefined }))).toBe(
      'gears.gear_1.hand',
    );
    expect(firstPath(sceneWith({ ...helical, 'gears.gear_1.hand': 1 }))).toBe('gears.gear_1.hand');
    const result = parseScene(sceneWith({ ...helical, 'gears.gear_1.hand': 'up' }));
    expect(result.ok ? [] : result.errors.map((e) => [e.code, e.path])).toEqual([
      ['invalidHand', 'gears.gear_1.hand'],
    ]);
  });

  it('親子の hand が同じ → meshKindMismatch', () => {
    const result = parseScene(sceneWith({ ...helical, 'gears.gear_2.hand': 'right' }));
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['meshKindMismatch']);
  });
});

describe('parseScene: かさ歯車（S2-02）', () => {
  const bevel = {
    'shafts.shaft_2.placement': {
      kind: 'bevel',
      parentGearId: 'gear_1',
      childGearId: 'gear_2',
      axisStep: 2,
      side: -1,
      axis: 'x',
    },
    'gears.gear_1.kind': 'bevel',
    'gears.gear_1.apex': 1,
    'gears.gear_2.kind': 'bevel',
    'gears.gear_2.apex': 1,
    'gears.gear_2.teeth': 20,
  };

  it("'bevel' の歯車と配置を読む（配置の axis は捨てる）", () => {
    const result = parseScene(sceneWith(bevel));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.scene.shafts.shaft_2?.placement).toEqual({
      kind: 'bevel',
      parentGearId: 'gear_1',
      childGearId: 'gear_2',
      axisStep: 2,
      side: -1,
    });
    expect(result.scene.gears.gear_1).toEqual({
      id: 'gear_1',
      kind: 'bevel',
      apex: 1,
      shaftId: 'shaft_1',
      size: 'M',
      teeth: 20,
      offset: 0,
    });
  });

  it('apex・axisStep・side が数でない → 形の誤り。子の apex === side → bevelApexMismatch', () => {
    expect(firstPath(sceneWith({ ...bevel, 'gears.gear_1.apex': 'up' }))).toBe('gears.gear_1.apex');
    expect(
      firstPath(
        sceneWith({
          ...bevel,
          'shafts.shaft_2.placement': { ...bevel['shafts.shaft_2.placement'], axisStep: 'x' },
        }),
      ),
    ).toBe('shafts.shaft_2.placement.axisStep');
    const result = parseScene(sceneWith({ ...bevel, 'gears.gear_2.apex': -1 }));
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual(['bevelApexMismatch']);
  });
});
