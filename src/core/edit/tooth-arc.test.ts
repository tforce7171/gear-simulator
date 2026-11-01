import { describe, expect, it } from 'vitest';
import { parseSaveFile, serializeSaveFile, toSaveFile } from '../io/save-file';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Gear, Scene, SpurGear } from '../scene/types';
import { validateScene } from '../scene/validate';
import { applyCommand, type Command, type CommandResult } from './commands';
import { emptyHistory, execute, redo, undo } from './history';

// S5-05: 欠け歯車の欄（SpurGear.toothCount・toothStart）と、その検証・コマンド（setToothCount・setToothStart）

function sceneWith(gears: Gear[]): Scene {
  return {
    shafts: {
      shaft_a: { id: 'shaft_a', placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } },
    },
    gears: Object.fromEntries(gears.map((g) => [g.id, g])),
    motors: {},
    anchors: {},
    carriers: {},
    racks: {},
  };
}

function spur(extra: Partial<SpurGear> = {}): SpurGear {
  return {
    id: 'gear_a',
    kind: 'spur',
    shaftId: 'shaft_a',
    size: 'M',
    teeth: 30,
    offset: 0,
    ...extra,
  };
}

const ctx = { ids: createSequentialIdGenerator() };

function apply(s: Scene, command: Command): CommandResult {
  return applyCommand(s, command, ctx);
}

function ok(result: CommandResult): Scene {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.scene;
}

function code(result: CommandResult): string | null {
  return result.ok ? null : result.error.code;
}

function gearA(s: Scene): SpurGear {
  const g = s.gears.gear_a;
  if (g?.kind !== 'spur') throw new Error('gear_a が平歯車でない');
  return g;
}

describe('validateScene の欠け歯車の欄', () => {
  it('範囲内なら通る', () => {
    expect(validateScene(sceneWith([spur({ toothCount: 1, toothStart: 29 })]))).toEqual({
      ok: true,
    });
    expect(validateScene(sceneWith([spur({ toothCount: 30, toothStart: 0 })]))).toEqual({
      ok: true,
    });
  });

  it('toothCount・toothStart の範囲外・整数でない → invalidToothArc', () => {
    const cases: Array<[Partial<SpurGear>, string]> = [
      [{ toothCount: 0 }, 'gears.gear_a.toothCount'],
      [{ toothCount: 31 }, 'gears.gear_a.toothCount'],
      [{ toothCount: 2.5 }, 'gears.gear_a.toothCount'],
      [{ toothStart: -1 }, 'gears.gear_a.toothStart'],
      [{ toothStart: 30 }, 'gears.gear_a.toothStart'],
      [{ toothStart: 0.5 }, 'gears.gear_a.toothStart'],
    ];
    for (const [extra, path] of cases) {
      const result = validateScene(sceneWith([spur(extra)]));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([['invalidToothArc', path]]);
    }
  });

  it('保存して読み直しても 2 つの欄が残る（version は上げない）', () => {
    const scene = sceneWith([spur({ toothCount: 8, toothStart: 3 })]);
    const parsed = parseSaveFile(serializeSaveFile(toSaveFile(scene)));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    expect(parsed.file.scene.gears.gear_a).toMatchObject({ toothCount: 8, toothStart: 3 });
  });
});

describe('setToothCount', () => {
  const base = sceneWith([spur()]);

  it('1〜歯数の整数にできる。歯数と同じなら欄を消す', () => {
    const next = ok(apply(base, { type: 'setToothCount', gearId: 'gear_a', toothCount: 8 }));
    expect(gearA(next).toothCount).toBe(8);
    expect(validateScene(next)).toEqual({ ok: true });
    const back = ok(apply(next, { type: 'setToothCount', gearId: 'gear_a', toothCount: 30 }));
    expect('toothCount' in gearA(back)).toBe(false);
  });

  it('今と同じ値なら同じシーンの参照を返す', () => {
    expect(ok(apply(base, { type: 'setToothCount', gearId: 'gear_a', toothCount: 30 }))).toBe(base);
  });

  it('範囲外・整数でない → invalidValue、無い歯車 → notFound', () => {
    for (const toothCount of [0, 31, 1.5, Number.NaN]) {
      expect(code(apply(base, { type: 'setToothCount', gearId: 'gear_a', toothCount }))).toBe(
        'invalidValue',
      );
    }
    expect(code(apply(base, { type: 'setToothCount', gearId: 'gear_x', toothCount: 5 }))).toBe(
      'notFound',
    );
  });

  it('平歯車以外 → notAllowed', () => {
    const helical = sceneWith([
      {
        id: 'gear_a',
        kind: 'helical',
        hand: 'right',
        shaftId: 'shaft_a',
        size: 'M',
        teeth: 30,
        offset: 0,
      },
    ]);
    expect(code(apply(helical, { type: 'setToothCount', gearId: 'gear_a', toothCount: 5 }))).toBe(
      'notAllowed',
    );
    expect(code(apply(helical, { type: 'setToothStart', gearId: 'gear_a', toothStart: 5 }))).toBe(
      'notAllowed',
    );
  });

  it('Undo/Redo', () => {
    const state = { scene: base, history: emptyHistory() };
    const result = execute(state, { type: 'setToothCount', gearId: 'gear_a', toothCount: 8 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(gearA(result.state.scene).toothCount).toBe(8);
    const back = undo(result.state);
    expect(back?.scene).toBe(base);
    const again = back === null ? null : redo(back);
    expect(again === null ? undefined : gearA(again.scene).toothCount).toBe(8);
  });
});

describe('setToothStart', () => {
  const base = sceneWith([spur({ toothCount: 8 })]);

  it('0〜歯数 − 1 の整数にできる。0 なら欄を消す', () => {
    const next = ok(apply(base, { type: 'setToothStart', gearId: 'gear_a', toothStart: 29 }));
    expect(gearA(next).toothStart).toBe(29);
    const back = ok(apply(next, { type: 'setToothStart', gearId: 'gear_a', toothStart: 0 }));
    expect('toothStart' in gearA(back)).toBe(false);
    expect(ok(apply(base, { type: 'setToothStart', gearId: 'gear_a', toothStart: 0 }))).toBe(base);
  });

  it('範囲外 → invalidValue', () => {
    for (const toothStart of [-1, 30, 0.5]) {
      expect(code(apply(base, { type: 'setToothStart', gearId: 'gear_a', toothStart }))).toBe(
        'invalidValue',
      );
    }
  });

  it('Undo/Redo', () => {
    const state = { scene: base, history: emptyHistory() };
    const result = execute(state, { type: 'setToothStart', gearId: 'gear_a', toothStart: 4 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    const back = undo(result.state);
    expect(back?.scene).toBe(base);
    const again = back === null ? null : redo(back);
    expect(again === null ? undefined : gearA(again.scene).toothStart).toBe(4);
  });
});

describe('setGearTeeth と欠け歯車の欄', () => {
  it('歯数を減らすと、toothCount と toothStart が新しい歯数の範囲に収まる', () => {
    const base = sceneWith([spur({ toothCount: 25, toothStart: 28 })]);
    const next = ok(apply(base, { type: 'setGearTeeth', gearId: 'gear_a', teeth: 20 }));
    expect(gearA(next)).toMatchObject({ teeth: 20, toothCount: 20, toothStart: 19 });
    expect(validateScene(next)).toEqual({ ok: true });
  });

  it('全部の歯を残していた欄は、歯数を増やしても普通の平歯車のまま', () => {
    const base = sceneWith([spur({ toothCount: 30 })]);
    const next = ok(apply(base, { type: 'setGearTeeth', gearId: 'gear_a', teeth: 40 }));
    expect('toothCount' in gearA(next)).toBe(false);
  });

  it('欠けた歯車の歯数を増やしても、残す歯数はそのまま', () => {
    const base = sceneWith([spur({ toothCount: 8, toothStart: 3 })]);
    const next = ok(apply(base, { type: 'setGearTeeth', gearId: 'gear_a', teeth: 40 }));
    expect(gearA(next)).toMatchObject({ teeth: 40, toothCount: 8, toothStart: 3 });
  });
});
