import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applyCommand, type Command } from '../edit/commands';
import { gearWidth } from '../geometry/dimensions';
import { requiredShaftSpans, resolveLayout, withShaftSpans } from '../layout/resolve';
import { createSequentialIdGenerator } from '../scene/ids';
import { emptyScene } from '../scene/scene';
import type { Scene } from '../scene/types';
import { validateScene } from '../scene/validate';
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

// シャフトの範囲（S4-03）は、小（歯幅 4）の歯車の両面から SHAFT_END_MARGIN ずつ
const sceneA: Scene = {
  shafts: {
    shaft_1: {
      id: 'shaft_1',
      placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' },
      span: [-4, 8],
    },
    shaft_2: {
      id: 'shaft_2',
      placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: 0 },
      span: [-4, 8],
    },
  },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
    gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 36, offset: 0 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'S', rpm: 60, direction: 1, on: true },
  },
  anchors: {},
  carriers: {},
  racks: {},
};

describe('toSaveFile', () => {
  it('format・version 4（S4-03）・同じシーンの参照', () => {
    const file = toSaveFile(sceneA);
    expect(file).toEqual({ format: 'gear-simulator', version: 4, scene: sceneA });
    expect(file.scene).toBe(sceneA);
  });

  it('範囲を省いたシャフトには、載っている部品から求めた範囲を入れて書く（S4-03）', () => {
    const { span: _s1, ...shaft1 } = sceneA.shafts.shaft_1 as Scene['shafts'][string];
    const bare: Scene = { ...sceneA, shafts: { ...sceneA.shafts, shaft_1: shaft1 } };
    expect(toSaveFile(bare).scene).toEqual(sceneA);
  });
});

describe('parseSaveFileObject', () => {
  it('toSaveFile の結果は ok で同じシーン', () => {
    const result = parseSaveFileObject(toSaveFile(sceneA));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.scene).toEqual(sceneA);
  });

  it('空のシーンも ok', () => {
    expect(
      parseSaveFileObject(
        toSaveFile({ shafts: {}, gears: {}, motors: {}, anchors: {}, carriers: {}, racks: {} }),
      ).ok,
    ).toBe(true);
  });

  const gear1 = sceneA.gears.gear_1;
  if (gear1 === undefined) throw new Error('sceneA が想定と違う');
  const bad: Array<[string, unknown]> = [
    ['undefined', undefined],
    ["format: 'other'", { format: 'other' }],
    ['version: 5', { format: 'gear-simulator', version: 5, scene: sceneA }],
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
    shaft_1: {
      id: 'shaft_1',
      placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' },
      span: [-4, 8],
    },
    shaft_2: {
      id: 'shaft_2',
      placement: { kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: 0.5 },
      span: [-4, 8],
    },
    shaft_3: {
      id: 'shaft_3',
      placement: { kind: 'detached', origin: [40, 8, -4], axis: 'x' },
      span: [4, 20],
    },
  },
  gears: {
    gear_1: { id: 'gear_1', kind: 'spur', shaftId: 'shaft_1', size: 'S', teeth: 12, offset: 0 },
    gear_2: { id: 'gear_2', kind: 'spur', shaftId: 'shaft_2', size: 'S', teeth: 36, offset: 0 },
    gear_3: { id: 'gear_3', kind: 'spur', shaftId: 'shaft_3', size: 'M', teeth: 20, offset: 8 },
  },
  motors: {
    motor_1: { id: 'motor_1', shaftId: 'shaft_1', size: 'S', rpm: 60, direction: -1, on: false },
  },
  anchors: {},
  carriers: {},
  racks: {},
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
    const empty: Scene = {
      shafts: {},
      gears: {},
      motors: {},
      anchors: {},
      carriers: {},
      racks: {},
    };
    const result = parseSaveFile(serializeSaveFile(toSaveFile(empty)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.scene).toEqual(empty);
    expect(result.migratedFrom).toBeNull();
  });

  it('歯車の無い起点のシャフト（S4-04）とそのモーター・固定具。検証を通り、往復で変わらない', () => {
    const ctx = { ids: createSequentialIdGenerator() };
    let scene = emptyScene();
    const commands: Command[] = [
      { type: 'addRootShaft', axis: 'x', origin: [10, 35, -5] },
      { type: 'addMotor', shaftId: 'shaft_1', size: 'M' },
      { type: 'addAnchor', shaftId: 'shaft_1' },
    ];
    for (const command of commands) {
      const applied = applyCommand(scene, command, ctx);
      if (!applied.ok) throw new Error(applied.error.message);
      scene = applied.scene;
    }
    expect(Object.keys(scene.gears)).toEqual([]);
    expect(scene.shafts.shaft_1?.span).toEqual([-10, 10]);
    expect(validateScene(scene)).toEqual({ ok: true });
    const file = toSaveFile(scene);
    expect(file.scene).toEqual(scene);
    const result = parseSaveFile(serializeSaveFile(file));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.scene).toEqual(scene);
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

  it('移行は 1 → 2（S2-05）、2 → 3（S3-05）、3 → 4（S4-03）で、最新は 4', () => {
    expect(Object.keys(MIGRATIONS)).toEqual(['1', '2', '3']);
    expect(CURRENT_SAVE_VERSION).toBe(4);
  });

  it('1 → 2 の移行は中身をそのままにする（version は migrate が書き換える）', () => {
    const raw = {
      format: 'gear-simulator',
      version: 1,
      scene: { shafts: {}, gears: {}, motors: {} },
    };
    const step = MIGRATIONS[1];
    expect(step).toBeDefined();
    expect(step?.(raw)).toEqual(raw);
    // 続けて 2 → 3（S3-05）が anchors・carriers・racks を足す（シャフトが無いので 3 → 4 は何も足さない）
    expect(migrate(raw)).toEqual({
      ok: true,
      raw: { ...raw, version: 4, scene: { ...raw.scene, anchors: {}, carriers: {}, racks: {} } },
      from: 1,
    });
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

// S2-05: 保存形式の version 2
function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf8'));
}

describe('version 1 → 2 の移行（S2-05）', () => {
  // 段階 1 で保存した version 1 のファイル（平歯車 3 枚・モーター 1 つ。シーンは e2e/fixtures/scene-a.json）
  const v1Url = new URL('./save-file-v1.json', import.meta.url);
  const v1Text = readFileSync(v1Url, 'utf8');
  const v1 = readJson(v1Url) as { version: number; scene: Scene };

  it('version 1 のファイルは平歯車 3 枚・モーター 1 つ', () => {
    expect(v1.version).toBe(1);
    expect(Object.values(v1.scene.gears).map((g) => g.kind)).toEqual(['spur', 'spur', 'spur']);
    expect(Object.keys(v1.scene.motors)).toHaveLength(1);
  });

  // 2 → 3 の移行（S3-05）が anchors・carriers・racks を {} で足し、3 → 4（S4-03）がシャフトの範囲を足す
  const migratedV1 = withShaftSpans({ ...v1.scene, anchors: {}, carriers: {}, racks: {} });
  it('parseSaveFile → ok、migratedFrom === 1、file.version === 4、scene は元のまま（anchors などは {}、シャフトに範囲）', () => {
    const result = parseSaveFile(v1Text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.file.version).toBe(4);
    expect(result.file.scene).toEqual(migratedV1);
  });

  it('IndexedDB から読んだ値（parseSaveFileObject）も同じ', () => {
    const result = parseSaveFileObject(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.file.version).toBe(4);
    expect(result.file.scene).toEqual(migratedV1);
  });
});

describe('段階 2 の部品の往復（S2-05）', () => {
  const showcase = readJson(
    new URL('../../../e2e/fixtures/stage2-showcase.json', import.meta.url),
  ) as Scene;

  it('stage2-showcase は平歯車・ハスバ・かさ・ウォーム・ホイール・ねじ歯車を含む', () => {
    const kinds = new Set(Object.values(showcase.gears).map((g) => g.kind));
    expect([...kinds].sort()).toEqual([
      'bevel',
      'crossedHelical',
      'helical',
      'spur',
      'worm',
      'wormWheel',
    ]);
  });

  it('serializeSaveFile → parseSaveFile → 元と toEqual、migratedFrom === null', () => {
    const text = serializeSaveFile(toSaveFile(showcase));
    const result = parseSaveFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toEqual({ format: 'gear-simulator', version: 4, scene: showcase });
    expect(result.migratedFrom).toBeNull();
  });
});

describe('version 2 の検証（S2-05）', () => {
  const helical = readJson(new URL('../../../e2e/fixtures/helical-pair.json', import.meta.url));
  const worm = readJson(new URL('../../../e2e/fixtures/worm-basic.json', import.meta.url));
  const bevel = readJson(new URL('../../../e2e/fixtures/bevel-pair.json', import.meta.url));
  const crossed = readJson(new URL('../../../e2e/fixtures/crossed-pair.json', import.meta.url));

  // scene の点区切りの場所を書き換えた version 2 のファイル（undefined はフィールドを消す）
  function v2With(scene: unknown, path: string, value: unknown): string {
    const copy = structuredClone(scene) as Record<string, unknown>;
    const keys = path.split('.');
    const last = keys.pop() as string;
    let target = copy;
    for (const key of keys) target = target[key] as Record<string, unknown>;
    if (value === undefined) delete target[last];
    else target[last] = value;
    return JSON.stringify({ format: 'gear-simulator', version: 2, scene: copy });
  }

  it('書き換える前のフィクスチャはどれも ok', () => {
    for (const scene of [helical, worm, bevel, crossed]) {
      expect(
        parseSaveFile(JSON.stringify({ format: 'gear-simulator', version: 2, scene })).ok,
      ).toBe(true);
    }
  });

  const cases: Array<[string, unknown, string, unknown]> = [
    ['ハスバに hand がない', helical, 'gears.gear_a.hand', undefined],
    ['ウォームの teeth: 2', worm, 'gears.gear_w.teeth', 2],
    ["'bevel' の子の apex === side", bevel, 'gears.gear_b.apex', -1],
    ["'skew' の axisStep: 0", crossed, 'shafts.shaft_b.placement.axisStep', 0],
  ];
  for (const [name, scene, path, value] of cases) {
    it(`${name} → ok: false（例外にしない）`, () => {
      const text = v2With(scene, path, value);
      expect(() => parseSaveFile(text)).not.toThrow();
      const result = parseSaveFile(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid-scene');
    });
  }

  it('version 5 のファイル → unsupported-version（S4-03 で最新は 4）', () => {
    const text = JSON.stringify({ format: 'gear-simulator', version: 5, scene: helical });
    expect(parseSaveFile(text)).toEqual({ ok: false, error: { code: 'unsupported-version' } });
  });

  it('段階 2 の部品を含む version 2 のファイルは、version 1 までしか読めないアプリでは unsupported-version', () => {
    const raw: Record<string, unknown> = { format: 'gear-simulator', version: 2, scene: worm };
    // 段階 1 のアプリ = 移行の登録なし・最新 1
    expect(migrate(raw, {}, 1)).toEqual({ ok: false, error: { code: 'unsupported-version' } });
  });
});

// S3-05: 保存形式の version 3（anchors・carriers・racks を必須にし、段階 3 の部品の検証を足した）
describe('version 2 → 3 の移行（S3-05）', () => {
  // S2-05 の時点の version 2 のファイル（stage2-showcase。anchors・carriers・racks を持たない）
  const v2Url = new URL('./save-file-v2.json', import.meta.url);
  const v2 = readJson(v2Url) as { version: number; scene: Record<string, unknown> };

  it('version 2 のファイル → ok、migratedFrom === 2、version === 4、anchors・carriers・racks が {}、他は元と同じ（シャフトに範囲）', () => {
    expect(v2.version).toBe(2);
    expect(v2.scene.anchors).toBeUndefined();
    const result = parseSaveFile(readFileSync(v2Url, 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(2);
    expect(result.file.version).toBe(4);
    const { anchors, carriers, racks, ...rest } = result.file.scene;
    expect(anchors).toEqual({});
    expect(carriers).toEqual({});
    expect(racks).toEqual({});
    const v3Scene = { ...(v2.scene as unknown as Scene), anchors: {}, carriers: {}, racks: {} };
    const { anchors: _a, carriers: _c, racks: _r, ...expected } = withShaftSpans(v3Scene);
    expect(rest).toEqual(expected);
  });

  it('version 1 のファイル → version 4 まで順に移行される（migratedFrom === 1）', () => {
    const v1 = readJson(new URL('./save-file-v1.json', import.meta.url));
    const result = parseSaveFileObject(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.file.version).toBe(4);
    for (const shaft of Object.values(result.file.scene.shafts)) {
      expect(shaft.span).toBeDefined();
    }
  });

  it('S3-01〜S3-04 の間に version 2 のまま保存された段階 3 の部品は、移行で残る', () => {
    const scene = readJson(
      new URL('../../../e2e/fixtures/planetary-ring-fixed.json', import.meta.url),
    );
    const result = parseSaveFileObject({ format: 'gear-simulator', version: 2, scene });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(2);
    expect(result.file.scene).toEqual(scene);
  });
});

describe('段階 3 の部品の往復（S3-05）', () => {
  const showcase = readJson(
    new URL('../../../e2e/fixtures/stage3-showcase.json', import.meta.url),
  ) as Scene;

  it('stage3-showcase は遊星歯車機構（リングを固定）・内歯車の組・ラック・固定具を含み、モーターは 2 つ', () => {
    expect(Object.keys(showcase.carriers)).toHaveLength(1);
    expect(Object.values(showcase.gears).filter((g) => g.kind === 'internal')).toHaveLength(2);
    expect(Object.keys(showcase.racks)).toHaveLength(1);
    expect(Object.keys(showcase.anchors)).toHaveLength(1);
    expect(Object.keys(showcase.motors)).toHaveLength(2);
  });

  it('保存 → 読み込み → 元と toEqual、migratedFrom === null', () => {
    const result = parseSaveFile(serializeSaveFile(toSaveFile(showcase)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toEqual({ format: 'gear-simulator', version: 4, scene: showcase });
    expect(result.migratedFrom).toBeNull();
  });
});

describe('version 3 の検証（S3-05）', () => {
  const ringFixed = readJson(
    new URL('../../../e2e/fixtures/planetary-ring-fixed.json', import.meta.url),
  ) as Scene;
  const rackBasic = readJson(new URL('../../../e2e/fixtures/rack-basic.json', import.meta.url));

  // scene の点区切りの場所を書き換えた version 3 のファイル（undefined はフィールドを消す）
  function v3With(scene: unknown, edits: Array<[string, unknown]>): string {
    const copy = structuredClone(scene) as Record<string, unknown>;
    for (const [path, value] of edits) {
      const keys = path.split('.');
      const last = keys.pop() as string;
      let target = copy;
      for (const key of keys) target = target[key] as Record<string, unknown>;
      if (value === undefined) delete target[last];
      else target[last] = value;
    }
    return JSON.stringify({ format: 'gear-simulator', version: 3, scene: copy });
  }

  it('書き換える前のフィクスチャはどれも ok', () => {
    for (const scene of [ringFixed, rackBasic]) {
      expect(parseSaveFile(v3With(scene, [])).ok).toBe(true);
    }
  });

  const cases: Array<[string, unknown, Array<[string, unknown]>, string]> = [
    ['anchors がない', ringFixed, [['anchors', undefined]], 'anchors'],
    [
      '遊星のシャフトにモーターがある',
      ringFixed,
      [
        [
          'motors.motor_p',
          { id: 'motor_p', shaftId: 'shaft_p0', size: 'M', rpm: 30, direction: 1, on: true },
        ],
      ],
      'motors.motor_p.shaftId',
    ],
    [
      '遊星のシャフトに固定具がある',
      ringFixed,
      [['anchors.anchor_p', { id: 'anchor_p', target: { kind: 'shaft', id: 'shaft_p1' } }]],
      'anchors.anchor_p.target.id',
    ],
    [
      'concentric が自分自身を親にする（循環）',
      ringFixed,
      [['shafts.shaft_k.placement.parentShaftId', 'shaft_k']],
      'shafts.shaft_k.placement.parentShaftId',
    ],
    [
      'detached のラックの direction と normal が同じ',
      rackBasic,
      [
        [
          'racks.rack_r.placement',
          { kind: 'detached', origin: [0, 40, 4], direction: 'x', normal: 'x', normalSign: 1 },
        ],
      ],
      'racks.rack_r.placement.normal',
    ],
    [
      'pinion のラックの axisStep: 3',
      rackBasic,
      [['racks.rack_r.placement.axisStep', 3]],
      'racks.rack_r.placement.axisStep',
    ],
    [
      '(z_s + z_r)/n が整数でない遊星の機構（太陽 20・遊星 12・リング 44・3 個）',
      ringFixed,
      [
        ['gears.gear_s.teeth', 20],
        ['gears.gear_r.teeth', 44],
      ],
      'carriers.carrier_k',
    ],
    [
      '同心でない遊星の機構（リング 46）',
      ringFixed,
      [['gears.gear_r.teeth', 46]],
      'carriers.carrier_k',
    ],
  ];
  for (const [name, scene, edits, path] of cases) {
    it(`${name} → ok: false（例外にしない）`, () => {
      const text = v3With(scene, edits);
      expect(() => parseSaveFile(text)).not.toThrow();
      const result = parseSaveFile(text);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({ code: 'invalid-scene', path });
    });
  }

  it('暫定処理の削除: version 3 と書かれていて racks がないファイル → ok: false', () => {
    const result = parseSaveFile(v3With(rackBasic, [['racks', undefined]]));
    expect(result).toEqual({ ok: false, error: { code: 'invalid-scene', path: 'racks' } });
  });

  it('version 5 のファイル → unsupported-version', () => {
    const text = JSON.stringify({ format: 'gear-simulator', version: 5, scene: ringFixed });
    expect(parseSaveFile(text)).toEqual({ ok: false, error: { code: 'unsupported-version' } });
  });
});

// S4-03: 保存形式の version 4（シャフトの範囲 span を必須にし、歯車の省略できる厚さ width を足した）
describe('version 3 → 4 の移行（S4-03）', () => {
  // S3-05 の時点の version 3 のファイル（stage3-showcase。シャフトは範囲を持たない）
  const v3Url = new URL('./save-file-v3.json', import.meta.url);
  const v3 = readJson(v3Url) as { version: number; scene: Scene };

  it('version 3 のファイルは範囲の無いシャフトだけ', () => {
    expect(v3.version).toBe(3);
    for (const shaft of Object.values(v3.scene.shafts)) expect(shaft.span).toBeUndefined();
  });

  it('移行 → 各シャフトの範囲が、移行前のシャフトの長さ（範囲の無いシーンのレイアウト）と同じ', () => {
    const before = resolveLayout(v3.scene);
    const result = parseSaveFile(readFileSync(v3Url, 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(3);
    expect(result.file.version).toBe(4);
    const shafts = Object.values(result.file.scene.shafts);
    expect(shafts.length).toBeGreaterThan(0);
    for (const shaft of shafts) {
      expect(shaft.span).toEqual(before.shafts[shaft.id]?.span);
    }
    // 読み込んだシーンのレイアウトのシャフトの長さも変わらない
    const after = resolveLayout(result.file.scene);
    for (const [id, at] of Object.entries(before.shafts)) {
      expect(after.shafts[id]?.span).toEqual(at.span);
    }
  });

  it('かさ歯車（頂点側を切る）・ウォーム・ねじ歯車の version 2 のファイル → 4 まで移行して長さが同じ', () => {
    const v2 = readJson(new URL('./save-file-v2.json', import.meta.url)) as { scene: Scene };
    const before = resolveLayout({ ...v2.scene, anchors: {}, carriers: {}, racks: {} });
    const result = parseSaveFileObject(v2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const shaft of Object.values(result.file.scene.shafts)) {
      expect(shaft.span).toEqual(before.shafts[shaft.id]?.span);
    }
  });

  it('version 1 のファイル → 1 → 2 → 3 → 4 と順に移行でき、長さが同じ', () => {
    const v1 = readJson(new URL('./save-file-v1.json', import.meta.url)) as { scene: Scene };
    const before = resolveLayout({ ...v1.scene, anchors: {}, carriers: {}, racks: {} });
    const result = parseSaveFileObject(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.file.version).toBe(4);
    for (const shaft of Object.values(result.file.scene.shafts)) {
      expect(shaft.span).toEqual(before.shafts[shaft.id]?.span);
    }
  });

  it('移行した範囲は、載っている部品の範囲を含む', () => {
    const result = parseSaveFileObject(v3);
    if (!result.ok) throw new Error('読めない');
    const required = requiredShaftSpans(result.file.scene);
    for (const shaft of Object.values(result.file.scene.shafts)) {
      const need = required[shaft.id];
      if (need === null || need === undefined || shaft.span === undefined) continue;
      expect(shaft.span[0]).toBeLessThanOrEqual(need[0]);
      expect(shaft.span[1]).toBeGreaterThanOrEqual(need[1]);
    }
  });
});

describe('version 4 の検証（S4-03）', () => {
  const v4 = (scene: unknown): string =>
    JSON.stringify({ format: 'gear-simulator', version: 4, scene });
  // 生の値（シャフト・歯車の欄を書き換えるため）
  type RawScene = {
    shafts: Record<string, Record<string, unknown>>;
    gears: Record<string, Record<string, unknown>>;
  };
  const raw = JSON.parse(serializeSaveFile(toSaveFile(sceneA))).scene as RawScene;

  it('width の無い歯車を読む → 厚さは大きさごとの値（gearWidth）', () => {
    const result = parseSaveFile(v4(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gear = result.file.scene.gears.gear_1;
    expect(gear?.width).toBeUndefined();
    expect(gearWidth(gear as NonNullable<typeof gear>)).toBe(4);
  });

  it('width のある歯車を読む → その値のまま、往復でも保たれる', () => {
    const copy = structuredClone(raw);
    (copy.gears.gear_1 as Record<string, unknown>).width = 12;
    const result = parseSaveFile(v4(copy));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.scene.gears.gear_1?.width).toBe(12);
    expect(gearWidth(result.file.scene.gears.gear_1 as NonNullable<Scene['gears'][string]>)).toBe(
      12,
    );
    const again = parseSaveFile(serializeSaveFile(result.file));
    expect(again.ok && again.file.scene.gears.gear_1?.width).toBe(12);
  });

  const shaft1 = (s: RawScene) => s.shafts.shaft_1 as Record<string, unknown>;
  const gear1 = (s: RawScene) => s.gears.gear_1 as Record<string, unknown>;
  const cases: Array<[string, (scene: RawScene) => void, string]> = [
    ['シャフトの span が無い', (s) => delete shaft1(s).span, 'shafts.shaft_1.span'],
    ['span が数 1 つ', (s) => (shaft1(s).span = [0]), 'shafts.shaft_1.span'],
    ['span が逆向き', (s) => (shaft1(s).span = [8, -4]), 'shafts.shaft_1.span'],
    ['span が歯車より短い', (s) => (shaft1(s).span = [0, 8]), 'shafts.shaft_1.span'],
    ['width が 4 の倍数でない', (s) => (gear1(s).width = 6), 'gears.gear_1.width'],
    ['width が 0', (s) => (gear1(s).width = 0), 'gears.gear_1.width'],
    ['width が文字列', (s) => (gear1(s).width = '8'), 'gears.gear_1.width'],
  ];
  for (const [name, edit, path] of cases) {
    it(`${name} → invalid-scene（${path}）`, () => {
      const copy = structuredClone(raw);
      edit(copy);
      expect(parseSaveFile(v4(copy))).toEqual({
        ok: false,
        error: { code: 'invalid-scene', path },
      });
    });
  }
});
