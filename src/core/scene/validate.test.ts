import { describe, expect, it } from 'vitest';
import { emptyScene } from './scene';
import type { Gear, Motor, Scene, Shaft } from './types';
import { type SceneError, validateScene } from './validate';

function errorsOf(scene: Scene): SceneError[] {
  const result = validateScene(scene);
  return result.ok ? [] : result.errors;
}

const rootShaft: Shaft = {
  id: 'shaft_1',
  placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' },
};
const rootGear: Gear = {
  id: 'gear_1',
  kind: 'spur',
  shaftId: 'shaft_1',
  size: 'S',
  teeth: 12,
  offset: 0,
};
const motor: Motor = {
  id: 'motor_1',
  shaftId: 'shaft_1',
  size: 'S',
  rpm: 60,
  direction: 1,
  on: true,
};

// 起点のシャフト 1 本と S・12 歯の歯車 1 枚、S のモーター（60rpm）
const base: Scene = {
  shafts: { shaft_1: rootShaft },
  gears: { gear_1: rootGear },
  motors: { motor_1: motor },
};

const meshShaft: Shaft = {
  id: 'shaft_2',
  placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: Math.PI / 2 },
};
const childGear: Gear = {
  id: 'gear_2',
  kind: 'spur',
  shaftId: 'shaft_2',
  size: 'S',
  teeth: 24,
  offset: 0,
};

// 上に mesh のシャフト（親 = gear_1、子 = S・24 歯、offset 0、angle π/2）を足したもの
const withChild: Scene = {
  shafts: { ...base.shafts, shaft_2: meshShaft },
  gears: { ...base.gears, gear_2: childGear },
  motors: base.motors,
};

function withGear(scene: Scene, gear: Gear): Scene {
  return { ...scene, gears: { ...scene.gears, [gear.id]: gear } };
}

function withMotor(scene: Scene, m: Motor): Scene {
  return { ...scene, motors: { ...scene.motors, [m.id]: m } };
}

// 2 本の mesh のシャフトが互いを親にする
const cyclic: Scene = {
  shafts: {
    shaft_a: {
      id: 'shaft_a',
      placement: { kind: 'mesh', parentGearId: 'gear_b', childGearId: 'gear_a', angle: 0 },
    },
    shaft_b: {
      id: 'shaft_b',
      placement: { kind: 'mesh', parentGearId: 'gear_a', childGearId: 'gear_b', angle: 0 },
    },
  },
  gears: {
    gear_a: { id: 'gear_a', kind: 'spur', shaftId: 'shaft_a', size: 'S', teeth: 12, offset: 0 },
    gear_b: { id: 'gear_b', kind: 'spur', shaftId: 'shaft_b', size: 'S', teeth: 12, offset: 0 },
  },
  motors: {},
};

describe('validateScene: 正しいシーン', () => {
  it('emptyScene() → ok', () => {
    expect(validateScene(emptyScene())).toEqual({ ok: true });
  });

  it('起点のシャフト・歯車・モーター → ok', () => {
    expect(validateScene(base)).toEqual({ ok: true });
  });

  it('mesh のシャフトを足す → ok', () => {
    expect(validateScene(withChild)).toEqual({ ok: true });
  });

  it('歯車の offset −8 → ok', () => {
    expect(validateScene(withGear(withChild, { ...rootGear, offset: -8 }))).toEqual({ ok: true });
  });

  it('歯数 40（L）→ ok', () => {
    expect(validateScene(withGear(base, { ...rootGear, size: 'L', teeth: 40 }))).toEqual({
      ok: true,
    });
  });

  it('歯車が 1 枚も載っていないシャフト → ok', () => {
    const scene: Scene = {
      shafts: {
        shaft_9: { id: 'shaft_9', placement: { kind: 'detached', origin: [1, 2, 3], axis: 'x' } },
      },
      gears: {},
      motors: {},
    };
    expect(validateScene(scene)).toEqual({ ok: true });
  });
});

describe('validateScene: 不正なシーン', () => {
  it('子の歯車の offset が 4 → エラー（childGearId）', () => {
    const errors = errorsOf(withGear(withChild, { ...childGear, offset: 4 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('meshChildOffset');
    expect(errors[0]?.id).toBe('gear_2');
    expect(errors[0]?.path).toBe('gears.gear_2.offset');
  });

  it('子の大きさが M → エラー', () => {
    const errors = errorsOf(withGear(withChild, { ...childGear, size: 'M' }));
    expect(errors.map((e) => e.code)).toEqual(['meshSizeMismatch']);
  });

  it('子の歯車が別のシャフトにある → エラー', () => {
    const errors = errorsOf(withGear(withChild, { ...childGear, shaftId: 'shaft_1' }));
    expect(errors.map((e) => e.code)).toContain('meshChildNotOnShaft');
  });

  it('親の歯車が同じシャフトにある → エラー', () => {
    const scene = withGear(withChild, { ...rootGear, shaftId: 'shaft_2' });
    expect(errorsOf(scene).map((e) => e.code)).toContain('meshParentOnSameShaft');
  });

  it('歯車の offset が 2 → エラー', () => {
    const errors = errorsOf(withGear(base, { ...rootGear, offset: 2 }));
    expect(errors.map((e) => e.code)).toEqual(['offsetNotSnapped']);
    expect(errors[0]?.path).toBe('gears.gear_1.offset');
  });

  it("root の axis が 'w' → エラー", () => {
    const scene: Scene = {
      ...base,
      shafts: {
        shaft_1: {
          id: 'shaft_1',
          placement: { kind: 'root', origin: [0, 0, 0], axis: 'w' as unknown as 'x' },
        },
      },
    };
    const errors = errorsOf(scene);
    expect(errors.map((e) => e.code)).toEqual(['invalidAxis']);
    expect(errors[0]?.path).toBe('shafts.shaft_1.placement.axis');
  });

  for (const [size, teeth, code] of [
    ['S', 11, 'teethOutOfRange'],
    ['S', 81, 'teethOutOfRange'],
    ['S', 12.5, 'teethNotInteger'],
    ['L', 41, 'teethOutOfRange'],
  ] as const) {
    it(`歯数 ${teeth}（${size}）→ エラー`, () => {
      const errors = errorsOf(withGear(base, { ...rootGear, size, teeth }));
      expect(errors.map((e) => e.code)).toEqual([code]);
      expect(errors[0]?.path).toBe('gears.gear_1.teeth');
    });
  }

  for (const rpm of [0, 121]) {
    it(`rpm ${rpm} → エラー`, () => {
      const errors = errorsOf(withMotor(base, { ...motor, rpm }));
      expect(errors.map((e) => e.code)).toEqual(['rpmOutOfRange']);
    });
  }

  it('direction 0 → エラー', () => {
    const errors = errorsOf(withMotor(base, { ...motor, direction: 0 as unknown as 1 }));
    expect(errors.map((e) => e.code)).toEqual(['invalidDirection']);
  });

  it('1 本のシャフトにモーター 2 個 → エラー', () => {
    const errors = errorsOf(withMotor(base, { ...motor, id: 'motor_2' }));
    expect(errors.map((e) => e.code)).toEqual(['multipleMotors']);
    expect(errors[0]?.id).toBe('shaft_1');
  });

  it('存在しない shaftId を持つ歯車 → エラー', () => {
    const errors = errorsOf(withGear(base, { ...rootGear, id: 'gear_3', shaftId: 'shaft_x' }));
    expect(errors.map((e) => e.code)).toEqual(['missingRef']);
    expect(errors[0]?.path).toBe('gears.gear_3.shaftId');
  });

  it('存在しない親・子の歯車 → エラー', () => {
    const scene: Scene = {
      ...withChild,
      shafts: {
        ...withChild.shafts,
        shaft_3: {
          id: 'shaft_3',
          placement: { kind: 'mesh', parentGearId: 'gear_x', childGearId: 'gear_y', angle: 0 },
        },
      },
    };
    const paths = errorsOf(scene).map((e) => e.path);
    expect(paths).toContain('shafts.shaft_3.placement.parentGearId');
    expect(paths).toContain('shafts.shaft_3.placement.childGearId');
  });

  it('存在しない shaftId を持つモーター → エラー', () => {
    const errors = errorsOf(withMotor(base, { ...motor, id: 'motor_2', shaftId: 'shaft_x' }));
    expect(errors.map((e) => e.code)).toEqual(['missingRef']);
  });

  it('2 本の mesh のシャフトが互いを親にする（循環）→ エラー', () => {
    const errors = errorsOf(cyclic);
    expect(errors.map((e) => e.code)).toEqual(['meshCycle', 'meshCycle']);
  });

  it("キー 'gear_1' に id: 'gear_2' の歯車 → エラー", () => {
    const scene: Scene = { ...base, gears: { gear_1: { ...rootGear, id: 'gear_2' } } };
    const errors = errorsOf(scene);
    expect(errors.map((e) => e.code)).toEqual(['idMismatch']);
    expect(errors[0]?.path).toBe('gears.gear_1.id');
  });

  it('有限でない数値 → エラー', () => {
    const scene: Scene = {
      shafts: {
        ...withChild.shafts,
        shaft_1: {
          id: 'shaft_1',
          placement: { kind: 'root', origin: [0, Number.NaN, 0], axis: 'y' },
        },
        shaft_2: {
          ...meshShaft,
          placement: { ...meshShaft.placement, angle: Number.POSITIVE_INFINITY },
        },
      } as Scene['shafts'],
      gears: { ...withChild.gears, gear_1: { ...rootGear, offset: Number.NaN } },
      motors: { motor_1: { ...motor, rpm: Number.NaN } },
    };
    const paths = errorsOf(scene)
      .filter((e) => e.code === 'notFinite')
      .map((e) => e.path);
    expect(paths.sort()).toEqual(
      [
        'gears.gear_1.offset',
        'motors.motor_1.rpm',
        'shafts.shaft_1.placement.origin',
        'shafts.shaft_2.placement.angle',
      ].sort(),
    );
  });

  it('エラーは全部列挙する（循環とキーの不一致を同時に含む → 2 件以上）', () => {
    const gearB = cyclic.gears.gear_b as Gear;
    const scene: Scene = {
      ...cyclic,
      shafts: { ...cyclic.shafts, ...base.shafts },
      gears: { ...cyclic.gears, gear_1: { ...rootGear, id: 'gear_2' }, gear_b: gearB },
    };
    const codes = errorsOf(scene).map((e) => e.code);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    expect(codes).toContain('meshCycle');
    expect(codes).toContain('idMismatch');
  });
});
