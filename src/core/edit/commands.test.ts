import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../layout/resolve';
import type { Vec3 } from '../math/vec3';
import { createSequentialIdGenerator } from '../scene/ids';
import { emptyScene } from '../scene/scene';
import type { Axis, Scene, SizeKey } from '../scene/types';
import { validateScene } from '../scene/validate';
import { applyCommand, type Command, type CommandContext, type CommandResult } from './commands';

// 基本のシーン（資料のテストケース）を作る 5 コマンド
const BASIC_COMMANDS: readonly Command[] = [
  { type: 'addRootShaft', axis: 'y', origin: [0, 20, 0], gear: { size: 'S', teeth: 12 } },
  { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: Math.PI / 2, teeth: 24 },
  { type: 'growGear', mode: 'coaxial', shaftId: 'shaft_2', offset: 4, size: 'S', teeth: 24 },
  { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_3', angle: 0, teeth: 12 },
  { type: 'addMotor', shaftId: 'shaft_1', size: 'S' },
];

function ok(result: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!result.ok) throw new Error(`command failed: ${result.error.code} ${result.error.message}`);
  return result;
}

function errorCode(result: CommandResult): string {
  if (result.ok) throw new Error('command unexpectedly succeeded');
  return result.error.code;
}

// 基本のシーンと、続けて使う ID の生成関数
function basic(): { scene: Scene; ctx: CommandContext } {
  const ctx: CommandContext = { ids: createSequentialIdGenerator() };
  let scene = emptyScene();
  for (const command of BASIC_COMMANDS) scene = ok(applyCommand(scene, command, ctx)).scene;
  return { scene, ctx };
}

function apply(scene: Scene, command: Command, ctx?: CommandContext): CommandResult {
  return applyCommand(scene, command, ctx ?? { ids: createSequentialIdGenerator() });
}

function expectVec(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined();
  expected.forEach((e, i) => {
    expect(actual?.[i]).toBeCloseTo(e, 9);
  });
}

function center(scene: Scene, gearId: string): Vec3 | undefined {
  return resolveLayout(scene).gears[gearId]?.center;
}

function hasPair(scene: Scene, a: string, b: string): boolean {
  return resolveLayout(scene).interferences.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe('基本のシーン', () => {
  it('各コマンドの created', () => {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    const expected = [
      ['shaft_1', 'gear_1'],
      ['shaft_2', 'gear_2'],
      ['gear_3'],
      ['shaft_3', 'gear_4'],
      ['motor_1'],
    ];
    let scene = emptyScene();
    BASIC_COMMANDS.forEach((command, i) => {
      const result = ok(applyCommand(scene, command, ctx));
      expect(result.created).toEqual(expected[i]);
      scene = result.scene;
    });
  });

  it('placement・offset・モーター・位置、validateScene が ok、干渉なし', () => {
    const { scene } = basic();
    expect(scene.shafts.shaft_2?.placement).toEqual({
      kind: 'mesh',
      parentGearId: 'gear_1',
      childGearId: 'gear_2',
      angle: Math.PI / 2,
    });
    expect(scene.shafts.shaft_2?.placement).not.toHaveProperty('axis');
    const layout = resolveLayout(scene);
    expect(layout.shafts.shaft_2?.axis).toBe('y');
    expect(scene.gears.gear_3?.offset).toBe(4);
    expect(scene.motors.motor_1).toMatchObject({ size: 'S', rpm: 60, direction: 1, on: true });
    expect(validateScene(scene)).toEqual({ ok: true });
    expectVec(center(scene, 'gear_1'), [0, 22, 0]);
    expectVec(layout.shafts.shaft_2?.origin, [18, 20, 0]);
    expectVec(center(scene, 'gear_2'), [18, 22, 0]);
    expectVec(center(scene, 'gear_3'), [18, 26, 0]);
    expectVec(layout.shafts.shaft_3?.origin, [18, 24, 18]);
    expectVec(center(scene, 'gear_4'), [18, 26, 18]);
    expect(layout.interferences).toEqual([]);
  });
});

describe('干渉しても成功する', () => {
  it('外周に生やした歯車が gear_2 と重なる', () => {
    const { scene, ctx } = basic();
    const result = ok(
      applyCommand(
        scene,
        {
          type: 'growGear',
          mode: 'perimeter',
          parentGearId: 'gear_1',
          angle: Math.PI / 2,
          teeth: 12,
        },
        ctx,
      ),
    );
    expect(result.created).toEqual(['shaft_4', 'gear_5']);
    expectVec(center(result.scene, 'gear_5'), [12, 22, 0]);
    expect(resolveLayout(result.scene).interferences).toContainEqual(['gear_2', 'gear_5']);
    expect(validateScene(result.scene)).toEqual({ ok: true });
  });

  it('起点を gear_1 と重なる位置に置く', () => {
    const { scene, ctx } = basic();
    const result = ok(
      applyCommand(
        scene,
        { type: 'addRootShaft', axis: 'y', origin: [5, 20, 0], gear: { size: 'S', teeth: 12 } },
        ctx,
      ),
    );
    const newGear = result.created[1] as string;
    expect(hasPair(result.scene, 'gear_1', newGear)).toBe(true);
  });

  it('歯数の変更で gear_2 が新しい起点の歯車と重なる', () => {
    const { scene, ctx } = basic();
    const added = ok(
      applyCommand(
        scene,
        { type: 'addRootShaft', axis: 'y', origin: [40, 20, 0], gear: { size: 'S', teeth: 12 } },
        ctx,
      ),
    );
    const newGear = added.created[1] as string;
    expect(resolveLayout(added.scene).interferences).toEqual([]);
    expectVec(center(added.scene, newGear), [40, 22, 0]);
    const result = ok(apply(added.scene, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 30 }));
    expectVec(center(result.scene, 'gear_2'), [27, 22, 0]);
    expect(hasPair(result.scene, 'gear_2', newGear)).toBe(true);
  });
});

describe('範囲外・存在しない', () => {
  it('growGear の失敗', () => {
    const { scene } = basic();
    const perimeter = (parentGearId: string, teeth: number): Command => ({
      type: 'growGear',
      mode: 'perimeter',
      parentGearId,
      angle: 0,
      teeth,
    });
    expect(errorCode(apply(scene, perimeter('gear_1', 81)))).toBe('invalidValue');
    expect(errorCode(apply(scene, perimeter('gear_99', 12)))).toBe('notFound');
    expect(
      errorCode(
        apply(scene, {
          type: 'growGear',
          mode: 'coaxial',
          shaftId: 'shaft_2',
          offset: 2,
          size: 'S',
          teeth: 12,
        }),
      ),
    ).toBe('invalidValue');
  });
});

describe('deleteParts', () => {
  it('途中の子の歯車: shaft_2 が detached、その先は残る', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'deleteParts', ids: ['gear_2'] })).scene;
    const p = next.shafts.shaft_2?.placement;
    expect(p?.kind).toBe('detached');
    if (p?.kind !== 'detached') throw new Error('not detached');
    expectVec(p.origin, [18, 20, 0]);
    expect(p.axis).toBe('y');
    expect(next.gears.gear_3?.offset).toBe(4);
    expect(next.shafts.shaft_3?.placement.kind).toBe('mesh');
    expectVec(center(next, 'gear_4'), [18, 26, 18]);
    expect(validateScene(next)).toEqual({ ok: true });
  });

  it('親の歯車: shaft_1 と motor_1 も消え、shaft_2 が detached', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'deleteParts', ids: ['gear_1'] })).scene;
    expect(next.shafts.shaft_1).toBeUndefined();
    expect(next.motors.motor_1).toBeUndefined();
    const p = next.shafts.shaft_2?.placement;
    if (p?.kind !== 'detached') throw new Error('not detached');
    expectVec(p.origin, [18, 20, 0]);
    expect(p.axis).toBe('y');
    expectVec(center(next, 'gear_2'), [18, 22, 0]);
    expect(validateScene(next)).toEqual({ ok: true });
  });

  it('シャフト: 載っている歯車も消え、shaft_3 が detached', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'deleteParts', ids: ['shaft_2'] })).scene;
    expect(next.gears.gear_2).toBeUndefined();
    expect(next.gears.gear_3).toBeUndefined();
    const p = next.shafts.shaft_3?.placement;
    if (p?.kind !== 'detached') throw new Error('not detached');
    expectVec(p.origin, [18, 24, 18]);
    expect(p.axis).toBe('y');
    expect(validateScene(next)).toEqual({ ok: true });
  });

  it('複数・重複は無視、無い ID は notFound でシーンは変わらない', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'deleteParts', ids: ['shaft_2', 'gear_3'] })).scene;
    expect(next.gears.gear_3).toBeUndefined();
    expect(validateScene(next)).toEqual({ ok: true });
    const failed = apply(scene, { type: 'deleteParts', ids: ['gear_99'] });
    expect(errorCode(failed)).toBe('notFound');
    expect(scene.gears.gear_2).toBeDefined();
  });

  it('モーター: deleteParts と removeMotor が同じ結果', () => {
    const { scene } = basic();
    const a = ok(apply(scene, { type: 'deleteParts', ids: ['motor_1'] })).scene;
    const b = ok(apply(scene, { type: 'removeMotor', motorId: 'motor_1' })).scene;
    expect(a).toEqual(b);
    expect(a.motors).toEqual({});
    expect(a.shafts).toBe(scene.shafts);
    expect(a.gears).toBe(scene.gears);
  });
});

describe('setGearTeeth', () => {
  it('その先がついてくる、範囲外、同じ値', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 20 })).scene;
    expectVec(center(next, 'gear_2'), [22, 22, 0]);
    expectVec(center(next, 'gear_4'), [22, 26, 18]);
    expect(errorCode(apply(scene, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 81 }))).toBe(
      'invalidValue',
    );
    expect(ok(apply(scene, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 12 })).scene).toBe(
      scene,
    );
  });

  it('参照の使い回し', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 20 })).scene;
    expect(next.gears.gear_2).toBe(scene.gears.gear_2);
    expect(next.shafts).toBe(scene.shafts);
    expect(next.motors).toBe(scene.motors);
    expect(next.gears.gear_1).not.toBe(scene.gears.gear_1);
  });
});

describe('setMeshAngle', () => {
  it('角度を変える、正規化、root は notAllowed', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'setMeshAngle', shaftId: 'shaft_2', angle: 0 })).scene;
    expectVec(center(next, 'gear_2'), [0, 22, 18]);
    expectVec(center(next, 'gear_4'), [0, 26, 36]);
    const negative = ok(
      apply(scene, { type: 'setMeshAngle', shaftId: 'shaft_2', angle: -Math.PI / 2 }),
    ).scene;
    const p = negative.shafts.shaft_2?.placement;
    if (p?.kind !== 'mesh') throw new Error('not mesh');
    expect(p.angle).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(errorCode(apply(scene, { type: 'setMeshAngle', shaftId: 'shaft_1', angle: 0 }))).toBe(
      'notAllowed',
    );
  });
});

describe('setGearOffset', () => {
  it('位置を変える、吸着していない値、mesh の子', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'setGearOffset', gearId: 'gear_3', offset: 8 })).scene;
    expectVec(center(next, 'gear_3'), [18, 30, 0]);
    expectVec(center(next, 'gear_4'), [18, 30, 18]);
    expect(errorCode(apply(scene, { type: 'setGearOffset', gearId: 'gear_3', offset: 6 }))).toBe(
      'invalidValue',
    );
    expect(errorCode(apply(scene, { type: 'setGearOffset', gearId: 'gear_2', offset: 8 }))).toBe(
      'notAllowed',
    );
  });
});

describe('モーター', () => {
  it('addMotor: 既にあれば notAllowed、L は rpm 15', () => {
    const { scene, ctx } = basic();
    expect(errorCode(apply(scene, { type: 'addMotor', shaftId: 'shaft_1', size: 'S' }))).toBe(
      'notAllowed',
    );
    const result = ok(
      applyCommand(scene, { type: 'addMotor', shaftId: 'shaft_2', size: 'L' }, ctx),
    );
    expect(result.created).toEqual(['motor_2']);
    expect(result.scene.motors.motor_2).toMatchObject({
      size: 'L',
      rpm: 15,
      direction: 1,
      on: true,
    });
  });

  it('updateMotor', () => {
    const { scene } = basic();
    const a = ok(
      apply(scene, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 120, direction: -1 } }),
    ).scene;
    expect(a.motors.motor_1).toMatchObject({ rpm: 120, direction: -1 });
    expect(
      errorCode(apply(scene, { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 0 } })),
    ).toBe('invalidValue');
    const b = ok(
      apply(scene, { type: 'updateMotor', motorId: 'motor_1', patch: { size: 'M' } }),
    ).scene;
    expect(b.motors.motor_1).toMatchObject({ size: 'M', rpm: 60 });
    const c = ok(
      apply(scene, { type: 'updateMotor', motorId: 'motor_1', patch: { on: false } }),
    ).scene;
    expect(c.motors.motor_1?.on).toBe(false);
  });
});

describe('moveShaft', () => {
  it('その先がついてくる、mesh は notAllowed、detached は動かせる', () => {
    const { scene } = basic();
    const next = ok(
      apply(scene, { type: 'moveShaft', shaftId: 'shaft_1', origin: [100, 20, 0] }),
    ).scene;
    expectVec(center(next, 'gear_2'), [118, 22, 0]);
    expect(
      errorCode(apply(scene, { type: 'moveShaft', shaftId: 'shaft_2', origin: [0, 0, 0] })),
    ).toBe('notAllowed');
    const detachedScene = ok(apply(scene, { type: 'deleteParts', ids: ['gear_2'] })).scene;
    const moved = ok(
      apply(detachedScene, { type: 'moveShaft', shaftId: 'shaft_2', origin: [50, 20, 0] }),
    ).scene;
    expectVec(center(moved, 'gear_3'), [50, 26, 0]);
    expect(validateScene(moved)).toEqual({ ok: true });
  });
});

describe('setShaftAxis', () => {
  it('root の向きだけを書き換え、その先は導かれる', () => {
    const { scene } = basic();
    const next = ok(apply(scene, { type: 'setShaftAxis', shaftId: 'shaft_1', axis: 'x' })).scene;
    const p = next.shafts.shaft_1?.placement;
    if (p?.kind !== 'root') throw new Error('not root');
    expect(p.axis).toBe('x');
    expect(next.shafts.shaft_2).toBe(scene.shafts.shaft_2);
    expect(next.shafts.shaft_3).toBe(scene.shafts.shaft_3);
    const layout = resolveLayout(next);
    for (const id of ['shaft_1', 'shaft_2', 'shaft_3']) expect(layout.shafts[id]?.axis).toBe('x');
    expectVec(center(next, 'gear_1'), [2, 20, 0]);
    expectVec(center(next, 'gear_2'), [2, 20, 18]);
    expect(errorCode(apply(scene, { type: 'setShaftAxis', shaftId: 'shaft_2', axis: 'x' }))).toBe(
      'notAllowed',
    );
  });
});

describe('reattachShaft', () => {
  function detachedState(): { scene: Scene; ctx: CommandContext } {
    const { scene, ctx } = basic();
    return {
      scene: ok(applyCommand(scene, { type: 'deleteParts', ids: ['gear_2'] }, ctx)).scene,
      ctx,
    };
  }

  it('付け直すと offset がずれ、その先ごとついてくる', () => {
    const { scene } = detachedState();
    const next = ok(
      apply(scene, {
        type: 'reattachShaft',
        shaftId: 'shaft_2',
        childGearId: 'gear_3',
        parentGearId: 'gear_1',
        angle: Math.PI / 2,
      }),
    ).scene;
    expect(next.shafts.shaft_2?.placement).toEqual({
      kind: 'mesh',
      parentGearId: 'gear_1',
      childGearId: 'gear_3',
      angle: Math.PI / 2,
    });
    expect(next.gears.gear_3?.offset).toBe(0);
    expectVec(center(next, 'gear_3'), [18, 22, 0]);
    expectVec(center(next, 'gear_4'), [18, 22, 18]);
    expect(validateScene(next)).toEqual({ ok: true });
  });

  it('失敗: 循環、mesh、別のシャフトの歯車、大きさ違い', () => {
    const { scene, ctx } = detachedState();
    const reattach = (over: Partial<Extract<Command, { type: 'reattachShaft' }>>): Command => ({
      type: 'reattachShaft',
      shaftId: 'shaft_2',
      childGearId: 'gear_3',
      parentGearId: 'gear_1',
      angle: Math.PI / 2,
      ...over,
    });
    expect(errorCode(apply(scene, reattach({ parentGearId: 'gear_4' })))).toBe('notAllowed');
    expect(errorCode(apply(scene, reattach({ shaftId: 'shaft_3', childGearId: 'gear_4' })))).toBe(
      'notAllowed',
    );
    expect(errorCode(apply(scene, reattach({ childGearId: 'gear_4' })))).toBe('notAllowed');
    const withM = ok(
      applyCommand(
        scene,
        { type: 'addRootShaft', axis: 'y', origin: [0, 20, 100], gear: { size: 'M', teeth: 20 } },
        ctx,
      ),
    );
    const mGear = withM.created[1] as string;
    expect(errorCode(apply(withM.scene, reattach({ parentGearId: mGear })))).toBe('notAllowed');
    expect(errorCode(apply(scene, reattach({ parentGearId: 'gear_99' })))).toBe('notFound');
  });
});

describe('replaceScene', () => {
  it('検証を通らないシーンは invalidValue、通れば置き換える', () => {
    const { scene } = basic();
    const gear1 = scene.gears.gear_1;
    if (gear1 === undefined) throw new Error('no gear_1');
    const bad: Scene = { ...scene, gears: { ...scene.gears, gear_1: { ...gear1, teeth: 11 } } };
    expect(errorCode(apply(scene, { type: 'replaceScene', scene: bad }))).toBe('invalidValue');
    const empty = emptyScene();
    expect(ok(apply(scene, { type: 'replaceScene', scene: empty })).scene).toBe(empty);
  });
});

// 基本のシーンと、それに対するいろいろなコマンド（成功も失敗も含む）
function sampleCommands(): Command[] {
  return [
    ...BASIC_COMMANDS,
    { type: 'deleteParts', ids: ['gear_2'] },
    { type: 'deleteParts', ids: ['shaft_2', 'gear_3'] },
    { type: 'deleteParts', ids: ['gear_99'] },
    { type: 'removeMotor', motorId: 'motor_1' },
    { type: 'setGearTeeth', gearId: 'gear_1', teeth: 20 },
    { type: 'setMeshAngle', shaftId: 'shaft_2', angle: -1 },
    { type: 'setGearOffset', gearId: 'gear_3', offset: 8 },
    { type: 'addMotor', shaftId: 'shaft_2', size: 'L' },
    { type: 'updateMotor', motorId: 'motor_1', patch: { rpm: 100 } },
    { type: 'moveShaft', shaftId: 'shaft_1', origin: [1, 2, 3] },
    { type: 'setShaftAxis', shaftId: 'shaft_1', axis: 'z' },
    {
      type: 'reattachShaft',
      shaftId: 'shaft_2',
      childGearId: 'gear_3',
      parentGearId: 'gear_1',
      angle: 0,
    },
    { type: 'replaceScene', scene: emptyScene() },
  ];
}

describe('不変', () => {
  it('深く freeze した入力のシーンでも、全てのコマンドが例外にならない', () => {
    const { scene } = basic();
    const frozen = deepFreeze(scene);
    for (const command of sampleCommands()) {
      expect(() => apply(frozen, deepFreeze(command))).not.toThrow();
    }
    const detached = deepFreeze(ok(apply(scene, { type: 'deleteParts', ids: ['gear_2'] })).scene);
    for (const command of sampleCommands()) {
      expect(() => apply(detached, command)).not.toThrow();
    }
  });

  it('失敗したコマンドの後も入力のシーンは変わらない', () => {
    const { scene } = basic();
    const snapshot = JSON.stringify(scene);
    for (const command of sampleCommands()) apply(scene, command);
    expect(JSON.stringify(scene)).toBe(snapshot);
  });
});

// 種を固定した乱数（線形合同法）
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('ランダムな操作列', () => {
  it('500 回適用して、成功したものの後は毎回 validateScene が ok', () => {
    const random = seededRandom(20261028);
    const pick = <T>(items: readonly T[]): T | undefined =>
      items[Math.floor(random() * items.length)];
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    const AXES: readonly Axis[] = ['x', 'y', 'z'];
    const SIZES: readonly SizeKey[] = ['S', 'M', 'L'];
    const teeth = (): number => 12 + Math.floor(random() * 30);
    const offset = (): number => (Math.floor(random() * 9) - 4) * 4 + (random() < 0.1 ? 2 : 0);
    const vec = (): Vec3 => [
      Math.round((random() - 0.5) * 200),
      Math.round(random() * 50),
      Math.round((random() - 0.5) * 200),
    ];

    let scene = emptyScene();
    let successes = 0;
    const kinds = new Set<string>();
    for (let step = 0; step < 500; step++) {
      const shaftIds = Object.keys(scene.shafts);
      const gearIds = Object.keys(scene.gears);
      const motorIds = Object.keys(scene.motors);
      const anyShaft = pick(shaftIds) ?? 'shaft_none';
      const anyGear = pick(gearIds) ?? 'gear_none';
      const anyMotor = pick(motorIds) ?? 'motor_none';
      const detachedIds = shaftIds.filter((id) => scene.shafts[id]?.placement.kind === 'detached');
      const roll = Object.keys(scene.gears).length < 4 ? random() * 0.3 : random();
      let command: Command;
      if (roll < 0.1) {
        command = {
          type: 'addRootShaft',
          axis: pick(AXES) ?? 'y',
          origin: vec(),
          gear: { size: pick(SIZES) ?? 'S', teeth: teeth() },
        };
      } else if (roll < 0.25) {
        command = {
          type: 'growGear',
          mode: 'perimeter',
          parentGearId: anyGear,
          angle: (random() - 0.5) * 20,
          teeth: teeth(),
        };
      } else if (roll < 0.33) {
        command = {
          type: 'growGear',
          mode: 'coaxial',
          shaftId: anyShaft,
          offset: offset(),
          size: pick(SIZES) ?? 'S',
          teeth: teeth(),
        };
      } else if (roll < 0.43) {
        const ids = [anyGear, anyShaft, anyMotor].filter(() => random() < 0.5);
        command = { type: 'deleteParts', ids: ids.length > 0 ? ids : [anyGear] };
      } else if (roll < 0.48) {
        command = { type: 'setGearTeeth', gearId: anyGear, teeth: teeth() };
      } else if (roll < 0.53) {
        command = { type: 'setMeshAngle', shaftId: anyShaft, angle: (random() - 0.5) * 20 };
      } else if (roll < 0.58) {
        command = { type: 'setGearOffset', gearId: anyGear, offset: offset() };
      } else if (roll < 0.63) {
        command = { type: 'addMotor', shaftId: anyShaft, size: pick(SIZES) ?? 'S' };
      } else if (roll < 0.66) {
        command = { type: 'removeMotor', motorId: anyMotor };
      } else if (roll < 0.71) {
        command = {
          type: 'updateMotor',
          motorId: anyMotor,
          patch: { rpm: Math.floor(random() * 130), direction: random() < 0.5 ? 1 : -1 },
        };
      } else if (roll < 0.76) {
        command = { type: 'moveShaft', shaftId: anyShaft, origin: vec() };
      } else if (roll < 0.81) {
        command = { type: 'setShaftAxis', shaftId: anyShaft, axis: pick(AXES) ?? 'y' };
      } else {
        const shaftId = pick(detachedIds) ?? anyShaft;
        const onShaft = gearIds.filter((id) => scene.gears[id]?.shaftId === shaftId);
        command = {
          type: 'reattachShaft',
          shaftId,
          childGearId: pick(onShaft) ?? anyGear,
          parentGearId: anyGear,
          angle: (random() - 0.5) * 20,
        };
      }
      const result = applyCommand(scene, command, ctx);
      if (!result.ok) continue;
      expect(validateScene(result.scene), `step ${step} ${command.type}`).toEqual({ ok: true });
      if (result.scene !== scene) kinds.add(command.type);
      successes++;
      scene = result.scene;
    }
    expect(successes).toBeGreaterThan(100);
    expect(kinds).toContain('reattachShaft');
    expect(kinds).toContain('deleteParts');
  });
});

// S1-17: A（起点）→ B → C の木で、向きと原点を変える
describe('起点のシャフトの向きと原点（S1-17）', () => {
  function chain(): Scene {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    let scene = emptyScene();
    const commands: Command[] = [
      { type: 'addRootShaft', axis: 'y', origin: [0, 20, 0], gear: { size: 'M', teeth: 20 } },
      { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: 0, teeth: 20 },
      { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_2', angle: 0, teeth: 20 },
    ];
    for (const command of commands) scene = ok(applyCommand(scene, command, ctx)).scene;
    return scene;
  }

  it('A を x にすると A の axis だけが変わり、3 本とも x でかみ合いのまま', () => {
    const scene = chain();
    const next = ok(apply(scene, { type: 'setShaftAxis', shaftId: 'shaft_1', axis: 'x' })).scene;
    const p = next.shafts.shaft_1?.placement;
    if (p?.kind !== 'root') throw new Error('not root');
    expect(p.axis).toBe('x');
    expect(next.shafts.shaft_2?.placement).toBe(scene.shafts.shaft_2?.placement);
    expect(next.shafts.shaft_3?.placement).toBe(scene.shafts.shaft_3?.placement);
    const layout = resolveLayout(next);
    for (const id of ['shaft_1', 'shaft_2', 'shaft_3']) expect(layout.shafts[id]?.axis).toBe('x');
    const pairs = layout.meshes.map((m) => [m.a, m.b]);
    expect(pairs).toContainEqual(['gear_1', 'gear_2']);
    expect(pairs).toContainEqual(['gear_2', 'gear_3']);
    const dist = (a: string, b: string): number => {
      const ca = layout.gears[a]?.center;
      const cb = layout.gears[b]?.center;
      if (ca === undefined || cb === undefined) throw new Error('missing gear');
      return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
    };
    const pitchSum = (layout.gears.gear_1?.pitchRadius ?? 0) * 2; // 同じ大きさ・歯数
    expect(dist('gear_1', 'gear_2')).toBeCloseTo(pitchSum, 9);
    expect(dist('gear_2', 'gear_3')).toBeCloseTo(pitchSum, 9);
  });

  it('A を [10, 0, 0] 動かすと B と C の中心も [10, 0, 0] 動く', () => {
    const scene = chain();
    const before = resolveLayout(scene);
    const next = ok(
      apply(scene, { type: 'moveShaft', shaftId: 'shaft_1', origin: [10, 20, 0] }),
    ).scene;
    const after = resolveLayout(next);
    for (const id of ['gear_2', 'gear_3']) {
      const b = before.gears[id]?.center;
      const a = after.gears[id]?.center;
      if (a === undefined || b === undefined) throw new Error('missing gear');
      expectVec(a, [b[0] + 10, b[1], b[2]]);
    }
  });
});

describe('ハスバ歯車（S2-01）', () => {
  const ROOT_HELICAL: Command = {
    type: 'addRootShaft',
    axis: 'y',
    origin: [0, 35, 0],
    gear: { size: 'M', teeth: 20, kind: 'helical' },
  };

  it("addRootShaft で kind 'helical' → hand 'right'。省くと平歯車", () => {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    const helical = ok(applyCommand(emptyScene(), ROOT_HELICAL, ctx));
    expect(helical.scene.gears.gear_1).toMatchObject({ kind: 'helical', hand: 'right' });
    const spur = ok(
      apply(emptyScene(), {
        type: 'addRootShaft',
        axis: 'y',
        origin: [0, 35, 0],
        gear: { size: 'M', teeth: 20 },
      }),
    );
    expect(spur.scene.gears.gear_1).toEqual({
      id: 'gear_1',
      kind: 'spur',
      shaftId: 'shaft_1',
      size: 'M',
      teeth: 20,
      offset: 0,
    });
  });

  it("growGear perimeter: ハスバ歯車の外周の子は逆の hand（'right' → 'left' → 'right'）", () => {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    let scene = ok(applyCommand(emptyScene(), ROOT_HELICAL, ctx)).scene;
    scene = ok(
      applyCommand(
        scene,
        { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: 0, teeth: 40 },
        ctx,
      ),
    ).scene;
    expect(scene.gears.gear_2).toMatchObject({ kind: 'helical', hand: 'left', size: 'M' });
    scene = ok(
      applyCommand(
        scene,
        { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_2', angle: 0, teeth: 20 },
        ctx,
      ),
    ).scene;
    expect(scene.gears.gear_3).toMatchObject({ kind: 'helical', hand: 'right' });
    expect(validateScene(scene)).toEqual({ ok: true });
  });

  it("growGear coaxial: kind 'helical' → hand 'right'、省くと平歯車、知らない種類は invalidValue", () => {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    const scene = ok(applyCommand(emptyScene(), ROOT_HELICAL, ctx)).scene;
    const coaxial = (kind?: unknown): Command =>
      ({
        type: 'growGear',
        mode: 'coaxial',
        shaftId: 'shaft_1',
        offset: 8,
        size: 'S',
        teeth: 12,
        ...(kind === undefined ? {} : { kind }),
      }) as Command;
    const helical = ok(apply(scene, coaxial('helical')));
    expect(helical.scene.gears[helical.created[0] as string]).toMatchObject({
      kind: 'helical',
      hand: 'right',
      size: 'S',
    });
    const spur = ok(apply(scene, coaxial()));
    expect(spur.scene.gears[spur.created[0] as string]?.kind).toBe('spur');
    expect(errorCode(apply(scene, coaxial('gearbox')))).toBe('invalidValue');
  });

  it('reattachShaft: かみ合えない組（平歯車とハスバ歯車、同じ hand）は notAllowed', () => {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    let scene = ok(applyCommand(emptyScene(), ROOT_HELICAL, ctx)).scene; // gear_1 right
    scene = ok(
      applyCommand(
        scene,
        { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: 0, teeth: 20 },
        ctx,
      ),
    ).scene; // shaft_2 / gear_2 left
    scene = ok(
      applyCommand(
        scene,
        {
          type: 'addRootShaft',
          axis: 'y',
          origin: [200, 35, 0],
          gear: { size: 'M', teeth: 20, kind: 'helical' },
        },
        ctx,
      ),
    ).scene; // shaft_3 / gear_3 right
    scene = ok(
      applyCommand(
        scene,
        {
          type: 'addRootShaft',
          axis: 'y',
          origin: [-200, 35, 0],
          gear: { size: 'M', teeth: 20 },
        },
        ctx,
      ),
    ).scene; // shaft_4 / gear_4 spur
    scene = ok(applyCommand(scene, { type: 'deleteParts', ids: ['gear_1'] }, ctx)).scene;
    expect(scene.shafts.shaft_2?.placement.kind).toBe('detached');
    const reattach = (parentGearId: string): Command => ({
      type: 'reattachShaft',
      shaftId: 'shaft_2',
      childGearId: 'gear_2',
      parentGearId,
      angle: 0,
    });
    // gear_2（left）は gear_3（right）には付け直せる
    expect(ok(apply(scene, reattach('gear_3'))).scene.shafts.shaft_2?.placement.kind).toBe('mesh');
    // 平歯車には付け直せない
    expect(errorCode(apply(scene, reattach('gear_4')))).toBe('notAllowed');
    // 同じ hand（left）には付け直せない
    const sameHand = ok(
      applyCommand(
        scene,
        { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_3', angle: Math.PI, teeth: 20 },
        ctx,
      ),
    );
    const leftGear = sameHand.created[1] as string;
    expect(sameHand.scene.gears[leftGear]).toMatchObject({ hand: 'left' });
    expect(errorCode(apply(sameHand.scene, reattach(leftGear)))).toBe('notAllowed');
  });
});

describe('かさ歯車（S2-02）', () => {
  const ROOT_BEVEL: Command = {
    type: 'addRootShaft',
    axis: 'y',
    origin: [0, 35, 0],
    gear: { size: 'M', teeth: 20, kind: 'bevel' },
  };

  // gear_1（起点、apex 1）と、その bevel の子 gear_2（axisStep 2、side −1）
  function bevelPair(): { scene: Scene; ctx: CommandContext } {
    const ctx: CommandContext = { ids: createSequentialIdGenerator() };
    let scene = ok(applyCommand(emptyScene(), ROOT_BEVEL, ctx)).scene;
    scene = ok(
      applyCommand(
        scene,
        { type: 'growGear', mode: 'bevel', parentGearId: 'gear_1', axisStep: 2, side: -1 },
        ctx,
      ),
    ).scene;
    return { scene, ctx };
  }

  it('addRootShaft で kind bevel → apex 1。growGear bevel → 同じ大きさ・歯数、apex −side、offset 0、bevel のシャフト', () => {
    const { scene } = bevelPair();
    expect(scene.gears.gear_1).toMatchObject({ kind: 'bevel', apex: 1 });
    expect(scene.gears.gear_2).toEqual({
      id: 'gear_2',
      kind: 'bevel',
      apex: 1,
      shaftId: 'shaft_2',
      size: 'M',
      teeth: 20,
      offset: 0,
    });
    expect(scene.shafts.shaft_2?.placement).toEqual({
      kind: 'bevel',
      parentGearId: 'gear_1',
      childGearId: 'gear_2',
      axisStep: 2,
      side: -1,
    });
    expect(validateScene(scene)).toEqual({ ok: true });
    const side1 = ok(
      apply(scene, {
        type: 'growGear',
        mode: 'bevel',
        parentGearId: 'gear_1',
        axisStep: 1,
        side: 1,
      }),
    );
    expect(side1.scene.gears[side1.created[1] as string]).toMatchObject({ apex: -1 });
  });

  it('growGear bevel: 親がかさ歯車でない → notAllowed、axisStep・side が不正 → invalidValue、親が無い → notFound', () => {
    const { scene } = basic();
    expect(
      errorCode(
        apply(scene, {
          type: 'growGear',
          mode: 'bevel',
          parentGearId: 'gear_1',
          axisStep: 1,
          side: 1,
        }),
      ),
    ).toBe('notAllowed');
    const pair = bevelPair().scene;
    const bad = (patch: Record<string, unknown>) =>
      ({
        type: 'growGear',
        mode: 'bevel',
        parentGearId: 'gear_1',
        axisStep: 1,
        side: 1,
        ...patch,
      }) as Command;
    expect(errorCode(apply(pair, bad({ axisStep: 0 })))).toBe('invalidValue');
    expect(errorCode(apply(pair, bad({ side: 0 })))).toBe('invalidValue');
    expect(errorCode(apply(pair, bad({ parentGearId: 'gear_x' })))).toBe('notFound');
  });

  it('growGear perimeter: かさ歯車の親 → notAllowed', () => {
    const { scene } = bevelPair();
    expect(
      errorCode(
        apply(scene, {
          type: 'growGear',
          mode: 'perimeter',
          parentGearId: 'gear_1',
          angle: 0,
          teeth: 20,
        }),
      ),
    ).toBe('notAllowed');
  });

  it('setGearTeeth: bevel の木の親子でつながったかさ歯車すべてが同じ歯数になる（同じ軸の平歯車は変わらない）', () => {
    const { scene: pair, ctx } = bevelPair();
    let scene = ok(
      applyCommand(
        pair,
        { type: 'growGear', mode: 'bevel', parentGearId: 'gear_2', axisStep: 1, side: 1 },
        ctx,
      ),
    ).scene; // gear_3
    // gear_4（平歯車）。S4-03 から干渉を生む位置にはコマンドで置けないので、シーンに直接足す
    scene = {
      ...scene,
      gears: {
        ...scene.gears,
        gear_4: {
          id: 'gear_4',
          kind: 'spur',
          shaftId: 'shaft_2',
          size: 'M',
          teeth: 30,
          offset: -8,
        },
      },
    };
    const result = ok(apply(scene, { type: 'setGearTeeth', gearId: 'gear_3', teeth: 16 }));
    expect(result.scene.gears.gear_1?.teeth).toBe(16);
    expect(result.scene.gears.gear_2?.teeth).toBe(16);
    expect(result.scene.gears.gear_3?.teeth).toBe(16);
    expect(result.scene.gears.gear_4?.teeth).toBe(30);
    expect(validateScene(result.scene)).toEqual({ ok: true });
    // 範囲外は invalidValue
    expect(errorCode(apply(scene, { type: 'setGearTeeth', gearId: 'gear_1', teeth: 61 }))).toBe(
      'invalidValue',
    );
  });

  it('flipBevelApex: 起点のかさ歯車は反転する（子はついてくる）。子・平歯車は notAllowed、無い歯車は notFound', () => {
    const { scene } = bevelPair();
    const flipped = ok(apply(scene, { type: 'flipBevelApex', gearId: 'gear_1' }));
    expect(flipped.scene.gears.gear_1).toMatchObject({ apex: -1 });
    expect(flipped.scene.gears.gear_2).toBe(scene.gears.gear_2);
    expect(validateScene(flipped.scene)).toEqual({ ok: true });
    const back = ok(apply(flipped.scene, { type: 'flipBevelApex', gearId: 'gear_1' }));
    expect(back.scene.gears.gear_1).toMatchObject({ apex: 1 });
    expect(errorCode(apply(scene, { type: 'flipBevelApex', gearId: 'gear_2' }))).toBe('notAllowed');
    expect(errorCode(apply(basic().scene, { type: 'flipBevelApex', gearId: 'gear_1' }))).toBe(
      'notAllowed',
    );
    expect(errorCode(apply(scene, { type: 'flipBevelApex', gearId: 'gear_x' }))).toBe('notFound');
  });

  it('bevel の子の setGearOffset・bevel のシャフトの moveShaft は notAllowed。親を消すと子のシャフトは detached', () => {
    const { scene } = bevelPair();
    expect(errorCode(apply(scene, { type: 'setGearOffset', gearId: 'gear_2', offset: 4 }))).toBe(
      'notAllowed',
    );
    expect(
      errorCode(apply(scene, { type: 'moveShaft', shaftId: 'shaft_2', origin: [0, 0, 0] })),
    ).toBe('notAllowed');
    expect(errorCode(apply(scene, { type: 'setMeshAngle', shaftId: 'shaft_2', angle: 1 }))).toBe(
      'notAllowed',
    );
    const before = resolveLayout(scene).shafts.shaft_2;
    const deleted = ok(apply(scene, { type: 'deleteParts', ids: ['gear_1'] })).scene;
    expect(deleted.shafts.shaft_2?.placement).toEqual({
      kind: 'detached',
      origin: before?.origin,
      axis: 'x',
    });
    expect(validateScene(deleted)).toEqual({ ok: true });
  });

  it('reattachShaft: かさ歯車の組は付け直せない（notAllowed）', () => {
    const { scene: pair, ctx } = bevelPair();
    let scene = ok(
      applyCommand(
        pair,
        {
          type: 'addRootShaft',
          axis: 'y',
          origin: [200, 35, 0],
          gear: { size: 'M', teeth: 20, kind: 'bevel' },
        },
        ctx,
      ),
    ).scene; // gear_3
    scene = ok(applyCommand(scene, { type: 'deleteParts', ids: ['gear_1'] }, ctx)).scene;
    expect(
      errorCode(
        apply(scene, {
          type: 'reattachShaft',
          shaftId: 'shaft_2',
          childGearId: 'gear_2',
          parentGearId: 'gear_3',
          angle: 0,
        }),
      ),
    ).toBe('notAllowed');
  });
});
