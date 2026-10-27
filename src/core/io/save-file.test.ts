import { describe, expect, it, vi } from 'vitest';
import type { Scene } from '../scene/types';
import {
  CURRENT_SAVE_VERSION,
  exportFileName,
  MIGRATIONS,
  type Migration,
  migrate,
  parseSaveFile,
  parseSaveFileObject,
  serializeSaveFile,
  toSaveFile,
} from './save-file';

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

// ---- S1-28: JSON のエクスポートとインポート ----

const scene3: Scene = {
  shafts: {
    shaft_1: { id: 'shaft_1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
    shaft_2: {
      id: 'shaft_2',
      placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: 0.5 },
    },
    shaft_3: { id: 'shaft_3', placement: { kind: 'detached', origin: [40, 8, -4], axis: 'x' } },
  },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
    gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 36, offset: 0 },
    gear_3: { id: 'gear_3', kind: 'spur', shaftId: 'shaft_3', size: 'M', teeth: 20, offset: 8 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'S', rpm: 60, direction: -1, on: false },
  },
};

// sceneA を JSON の生データにして、点区切りの場所の値を書き換えたものを返す（JSON の文字列）
function rawWith(edits: Record<string, unknown>): string {
  const raw: unknown = JSON.parse(serializeSaveFile(toSaveFile(sceneA)));
  for (const [path, value] of Object.entries(edits)) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    let target = raw as Record<string, unknown>;
    for (const key of keys) target = target[key] as Record<string, unknown>;
    target[last] = value;
  }
  // JSON.stringify は NaN を null にする
  return JSON.stringify(raw);
}

function errorOf(text: string) {
  const result = parseSaveFile(text);
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result.error;
}

describe('serializeSaveFile と parseSaveFile の往復', () => {
  it('歯車 3 枚・モーター 1 つのシーン', () => {
    const result = parseSaveFile(serializeSaveFile(toSaveFile(scene3)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.scene).toEqual(scene3);
    expect(result.migratedFrom).toBeNull();
  });

  it('空のシーン', () => {
    const empty: Scene = { shafts: {}, gears: {}, motors: {} };
    const result = parseSaveFile(serializeSaveFile(toSaveFile(empty)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.scene).toEqual(empty);
    expect(result.migratedFrom).toBeNull();
  });

  it('出力は 2 スペースの字下げで、末尾が改行', () => {
    const text = serializeSaveFile(toSaveFile(sceneA));
    expect(text).toBe(`${JSON.stringify(toSaveFile(sceneA), null, 2)}\n`);
    expect(text.split('\n')[1]).toBe('  "format": "gear-simulator",');
    expect(text.endsWith('}\n')).toBe(true);
  });
});

describe('parseSaveFile のエラー', () => {
  it("'{' は invalid-json", () => {
    expect(errorOf('{')?.code).toBe('invalid-json');
  });

  for (const text of ['null', '1', '[]', '{}', '{"format":"other","version":1}']) {
    it(`${text} は not-gear-simulator`, () => {
      expect(errorOf(text)?.code).toBe('not-gear-simulator');
    });
  }

  for (const version of ['0', '1.5', '"1"', undefined]) {
    it(`version ${version ?? 'なし'} は invalid-version`, () => {
      const v = version === undefined ? '' : `,"version":${version}`;
      expect(errorOf(`{"format":"gear-simulator"${v},"scene":{}}`)?.code).toBe('invalid-version');
    });
  }

  it('version 99 は unsupported-version', () => {
    expect(errorOf(rawWith({ version: 99 }))?.code).toBe('unsupported-version');
  });

  it('6 MB の文字列は too-large（JSON の解析をしない）', () => {
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const text = `"${'a'.repeat(6 * 1024 * 1024)}"`;
      expect(errorOf(text)?.code).toBe('too-large');
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});

describe('invalid-scene と path', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['S の歯車の teeth: 81', { 'scene.gears.gear_1.teeth': 81 }, 'gears.gear_1.teeth'],
    ['teeth: 12.5', { 'scene.gears.gear_1.teeth': 12.5 }, 'gears.gear_1.teeth'],
    ['存在しない shaftId', { 'scene.gears.gear_1.shaftId': 'shaft_x' }, 'gears.gear_1.shaftId'],
    ['rpm: 0', { 'scene.motors.motor_1.rpm': 0 }, 'motors.motor_1.rpm'],
    ['rpm: 121', { 'scene.motors.motor_1.rpm': 121 }, 'motors.motor_1.rpm'],
    ['direction: 0', { 'scene.motors.motor_1.direction': 0 }, 'motors.motor_1.direction'],
    [
      "root の axis: 'w'",
      { 'scene.shafts.shaft_1.placement.axis': 'w' },
      'shafts.shaft_1.placement.axis',
    ],
    [
      'origin: [0, NaN, 0]（JSON では null）',
      { 'scene.shafts.shaft_1.placement.origin': [0, Number.NaN, 0] },
      'shafts.shaft_1.placement.origin',
    ],
    ['キーと id の不一致', { 'scene.gears.gear_1.id': 'gear_other' }, 'gears.gear_1.id'],
  ];
  for (const [name, edits, path] of cases) {
    it(`${name} → ${path}`, () => {
      expect(errorOf(rawWith(edits))).toEqual({ code: 'invalid-scene', path });
    });
  }

  it('2 本の mesh のシャフトが互いを親にする閉路', () => {
    const raw = {
      format: 'gear-simulator',
      version: 1,
      scene: {
        shafts: {
          shaft_1: {
            id: 'shaft_1',
            placement: { kind: 'mesh', parentGearId: 'gear_2', childGearId: 'gear_1', angle: 0 },
          },
          shaft_2: {
            id: 'shaft_2',
            placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: 0 },
          },
        },
        gears: {
          gear_1: {
            id: 'gear_1',
            kind: 'spur',
            shaftId: 'shaft_1',
            size: 'S',
            teeth: 12,
            offset: 0,
          },
          gear_2: {
            id: 'gear_2',
            kind: 'spur',
            shaftId: 'shaft_2',
            size: 'S',
            teeth: 12,
            offset: 0,
          },
        },
        motors: {},
      },
    };
    const error = errorOf(JSON.stringify(raw));
    expect(error?.code).toBe('invalid-scene');
    expect(error?.path).toMatch(/^shafts\.shaft_[12](\.|$)/);
  });
});

describe('知らないフィールドは捨てる', () => {
  it('ルートの extra、歯車の color、mesh の placement の axis', () => {
    const text = rawWith({
      extra: 1,
      'scene.extra': 2,
      'scene.gears.gear_1.color': 'red',
      'scene.shafts.shaft_2.placement.axis': 'x',
    });
    expect(text).toContain('"color":"red"');
    const result = parseSaveFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toEqual(toSaveFile(sceneA));
    expect(result.file).not.toHaveProperty('extra');
    expect(result.file.scene).not.toHaveProperty('extra');
    expect(result.file.scene.gears.gear_1).not.toHaveProperty('color');
    expect(result.file.scene.shafts.shaft_2?.placement).not.toHaveProperty('axis');
  });
});

describe('migrate', () => {
  const fake: Readonly<Record<number, Migration>> = {
    1: (raw) => ({ ...raw, version: 2, steps: [...((raw.steps as number[]) ?? []), 1] }),
    2: (raw) => ({ ...raw, version: 3, steps: [...((raw.steps as number[]) ?? []), 2] }),
  };

  it('version 1 のデータに順に適用する', () => {
    const result = migrate({ format: 'gear-simulator', version: 1 }, fake, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toBe(1);
    expect(result.raw.version).toBe(3);
    expect(result.raw.steps).toEqual([1, 2]);
  });

  it('version 3 なら何もしない', () => {
    const input = { format: 'gear-simulator', version: 3 };
    const result = migrate(input, fake, 3);
    expect(result).toEqual({ ok: true, raw: input, from: 3 });
  });

  it('移行が途中で抜けている → unsupported-version', () => {
    const partial: Readonly<Record<number, Migration>> = { 1: fake[1] as Migration };
    const result = migrate({ format: 'gear-simulator', version: 1 }, partial, 3);
    expect(result).toEqual({ ok: false, error: { code: 'unsupported-version' } });
  });

  it('いまは移行の登録がなく、最新は 1', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
    expect(CURRENT_SAVE_VERSION).toBe(1);
  });
});

describe('どんな入力でも例外を投げない', () => {
  const inputs: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['0', 0],
    ["'x'", 'x'],
    ['[]', []],
    ["{ format: 'gear-simulator' }", { format: 'gear-simulator' }],
    ['shafts: null', { format: 'gear-simulator', version: 1, scene: { shafts: null } }],
  ];
  for (const [name, raw] of inputs) {
    it(name, () => {
      expect(() => parseSaveFileObject(raw)).not.toThrow();
      expect(parseSaveFileObject(raw).ok).toBe(false);
    });
  }
});

describe('exportFileName', () => {
  const now = new Date(2026, 9, 27, 9, 5, 3);
  it('作品が無ければ日時の名前', () => {
    expect(exportFileName(now, null)).toBe('gear-simulator-20261027-090503.json');
  });
  it('使えない文字は _ に置き換える', () => {
    expect(exportFileName(now, 'a/b:c')).toBe('a_b_c.json');
  });
  it("' . ' は空になるので日時の名前", () => {
    expect(exportFileName(now, ' . ')).toBe('gear-simulator-20261027-090503.json');
  });
  it('前後の空白と末尾の . を取る。制御文字も _ にする', () => {
    expect(exportFileName(now, '  歯車\t*?"<>|\\ の作品.. ')).toBe('歯車________ の作品.json');
  });
});
