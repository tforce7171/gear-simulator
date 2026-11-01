import { describe, expect, it } from 'vitest';
import { gearWidth } from '../geometry/dimensions';
import { parseSaveFile, serializeSaveFile, toSaveFile } from '../io/save-file';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import { resolveLayout } from '../layout/resolve';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Gear, Motor, Rack, Scene, Shaft } from '../scene/types';
import { validateScene } from '../scene/validate';
import { applyCommand, type Command, type CommandResult } from './commands';
import { emptyHistory, execute, redo, undo } from './history';

// S4-05: 歯車の厚さ（GearBase.width）と、厚さを変えるコマンド（setGearWidth・setRackWidth）

function root(id: string, origin: [number, number, number], span?: [number, number]): Shaft {
  return {
    id,
    placement: { kind: 'root', origin, axis: 'y' },
    ...(span === undefined ? {} : { span }),
  };
}

function spur(id: string, shaftId: string, offset = 0, teeth = 20, width?: number): Gear {
  return {
    id,
    kind: 'spur',
    shaftId,
    size: 'M',
    teeth,
    offset,
    ...(width === undefined ? {} : { width }),
  };
}

function scene(shafts: Shaft[], gears: Gear[], motors: Motor[] = [], racks: Rack[] = []): Scene {
  return {
    shafts: Object.fromEntries(shafts.map((s) => [s.id, s])),
    gears: Object.fromEntries(gears.map((g) => [g.id, g])),
    motors: Object.fromEntries(motors.map((m) => [m.id, m])),
    anchors: {},
    carriers: {},
    racks: Object.fromEntries(racks.map((r) => [r.id, r])),
  };
}

function apply(s: Scene, command: Command): CommandResult {
  return applyCommand(s, command, { ids: createSequentialIdGenerator() });
}

function ok(result: CommandResult): Scene {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.scene;
}

function code(result: CommandResult): string | null {
  return result.ok ? null : result.error.code;
}

function pinionRack(): Rack {
  return {
    id: 'rack_a',
    size: 'M',
    teeth: 20,
    placement: { kind: 'pinion', gearId: 'gear_a', axisStep: 1, normalSign: 1 },
  };
}

// 縦の起点 shaft_a（範囲 [−4, 12]）に中・20 歯の gear_a（offset 0、厚さは省略 = 8）
const single = scene([root('shaft_a', [0, 0, 0], [-4, 12])], [spur('gear_a', 'shaft_a')]);

describe('setGearWidth', () => {
  it('4〜32 mm の 4 mm の倍数 → 通り、width がその値になる', () => {
    for (let width = 4; width <= 32; width += 4) {
      const next = ok(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width }));
      // 8 mm は省いたときの値と同じなので、シーンは変わらない（width を省いたまま）
      const gear = next.gears.gear_a;
      expect(gear === undefined ? undefined : gearWidth(gear)).toBe(width);
      if (width !== 8) expect(gear?.width).toBe(width);
      expect(validateScene(next)).toEqual({ ok: true });
    }
  });

  it('0.5・1・1.5・32 mm → 通る（S5-01: 0.5 mm 刻み）', () => {
    for (const width of [0.5, 1, 1.5, 32]) {
      const next = ok(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width }));
      expect(next.gears.gear_a?.width).toBe(width);
      expect(validateScene(next)).toEqual({ ok: true });
    }
  });

  it('0・0.25・0.7・32.5・36 mm → invalidValue', () => {
    for (const width of [0, 0.25, 0.7, 32.5, 36]) {
      expect(code(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width }))).toBe(
        'invalidValue',
      );
    }
  });

  it('かさ歯車・ウォーム・ウォームホイール → notAllowed', () => {
    const fixed: Gear[] = [
      {
        id: 'gear_b',
        kind: 'bevel',
        shaftId: 'shaft_a',
        size: 'M',
        teeth: 20,
        offset: 0,
        apex: 1,
      },
      { id: 'gear_w', kind: 'worm', shaftId: 'shaft_a', size: 'M', teeth: 1, offset: 0 },
      { id: 'gear_h', kind: 'wormWheel', shaftId: 'shaft_a', size: 'M', teeth: 30, offset: 0 },
    ];
    for (const gear of fixed) {
      const s = scene([root('shaft_a', [0, 0, 0])], [gear]);
      expect(code(apply(s, { type: 'setGearWidth', gearId: gear.id, width: 12 }))).toBe(
        'notAllowed',
      );
    }
  });

  it('ハスバ歯車・内歯車・ねじ歯車は変えられる。無い歯車 → notFound。同じ厚さ → 同じシーンの参照', () => {
    const kinds: Gear[] = [
      {
        id: 'g',
        kind: 'helical',
        shaftId: 'shaft_a',
        size: 'M',
        teeth: 20,
        offset: 0,
        hand: 'right',
      },
      {
        id: 'g',
        kind: 'internal',
        shaftId: 'shaft_a',
        size: 'M',
        teeth: 40,
        offset: 0,
        webSide: -1,
      },
      { id: 'g', kind: 'crossedHelical', shaftId: 'shaft_a', size: 'M', teeth: 20, offset: 0 },
    ];
    for (const gear of kinds) {
      const s = scene([root('shaft_a', [0, 0, 0])], [gear]);
      const next = ok(apply(s, { type: 'setGearWidth', gearId: 'g', width: 16 }));
      expect(next.gears.g?.width).toBe(16);
      expect(validateScene(next)).toEqual({ ok: true });
    }
    expect(code(apply(single, { type: 'setGearWidth', gearId: 'gear_x', width: 8 }))).toBe(
      'notFound',
    );
    expect(ok(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width: 8 }))).toBe(single);
  });

  it('厚くしてシャフトからはみ出す → シャフトの範囲が伸びる', () => {
    const next = ok(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width: 20 }));
    expect(next.shafts.shaft_a?.span).toEqual([-4, 24]);
    // 伸ばしたシャフト（範囲が部品より長い）も、はみ出す分だけ伸びる
    const stretched = scene([root('shaft_a', [0, 0, 0], [-20, 16])], [spur('gear_a', 'shaft_a')]);
    const grown = ok(apply(stretched, { type: 'setGearWidth', gearId: 'gear_a', width: 20 }));
    expect(grown.shafts.shaft_a?.span).toEqual([-20, 24]);
  });

  it('厚くして同じシャフトの歯車とぶつかる → notAllowed（接するまでは通る）', () => {
    // gear_a [0, 8] と gear_b [16, 24]（中・30 歯）が同じシャフトに並ぶ
    const s = scene(
      [root('shaft_a', [0, 0, 0], [-4, 28])],
      [spur('gear_a', 'shaft_a'), spur('gear_b', 'shaft_a', 16, 30)],
    );
    const touching = ok(apply(s, { type: 'setGearWidth', gearId: 'gear_a', width: 16 }));
    expect(touching.gears.gear_a?.width).toBe(16);
    expect(code(apply(s, { type: 'setGearWidth', gearId: 'gear_a', width: 20 }))).toBe(
      'notAllowed',
    );
  });

  it('厚くして伸びたシャフトがほかの部品にぶつかる → notAllowed', () => {
    // 真上の起点 B（範囲 [−4, 12]）。A を 32 mm にすると A のシャフトは y = 36 まで伸びる。
    // B の原点が y = 44 なら B のシャフトの下端 y = 40 に届かない → 通る。y = 36 なら B のシャフト（y = 32〜48）と
    // y = 32〜36 で重なる → ぶつかる
    const far = scene(
      [root('shaft_a', [0, 0, 0], [-4, 12]), root('shaft_b', [0, 44, 0], [-4, 12])],
      [spur('gear_a', 'shaft_a'), spur('gear_b', 'shaft_b')],
    );
    expect(code(apply(far, { type: 'setGearWidth', gearId: 'gear_a', width: 32 }))).toBe(null);
    const near = scene(
      [root('shaft_a', [0, 0, 0], [-4, 12]), root('shaft_b', [0, 36, 0], [-4, 12])],
      [spur('gear_a', 'shaft_a'), spur('gear_b', 'shaft_b')],
    );
    expect(code(apply(near, { type: 'setGearWidth', gearId: 'gear_a', width: 32 }))).toBe(
      'notAllowed',
    );
  });

  it('厚さの変更は 1 回の編集として Undo/Redo できる', () => {
    const ctx = { ids: createSequentialIdGenerator() };
    const state = { scene: single, history: emptyHistory() };
    const result = execute(state, { type: 'setGearWidth', gearId: 'gear_a', width: 16 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.scene.gears.gear_a?.width).toBe(16);
    const back = undo(result.state);
    expect(back?.scene.gears.gear_a?.width).toBeUndefined();
    expect(back?.scene.shafts.shaft_a?.span).toEqual([-4, 12]);
    const again = back === null ? null : redo(back);
    expect(again?.scene.gears.gear_a?.width).toBe(16);
  });
});

describe('厚さとかみ合い・干渉', () => {
  // 起点 A（原点 [0, 0, 0]）に中・20 歯（r = 20）、起点 B（原点 [60, 0, 0]）に中・40 歯（r = 40）。中心距離 60 でかみ合う。
  // A にモーター（30 rpm）
  const motor: Motor = {
    id: 'motor_a',
    shaftId: 'shaft_a',
    size: 'M',
    rpm: 30,
    direction: 1,
    on: true,
  };
  function pair(widthB: number | undefined, offsetB = 0): Scene {
    return scene(
      [root('shaft_a', [0, 0, 0]), root('shaft_b', [60, 0, 0])],
      [spur('gear_a', 'shaft_a', 0, 20, 8), spur('gear_b', 'shaft_b', offsetB, 40, widthB)],
      [motor],
    );
  }
  function omegas(s: Scene): Readonly<Record<string, number>> {
    return solveMotion(s, resolveLayout(s), initialMotionState()).omegas;
  }

  it('厚さ 8 mm と 20 mm の平歯車の組 → かみ合いとして認識され、速度比が厚さに関係しない', () => {
    const thin = pair(8);
    const thick = pair(20);
    for (const s of [thin, thick]) {
      const layout = resolveLayout(s);
      expect(layout.meshes.map((m) => [m.a, m.b])).toEqual([['gear_a', 'gear_b']]);
      expect(layout.interferences).toEqual([]);
    }
    const w1 = omegas(thin);
    const w2 = omegas(thick);
    expect(w2.shaft_a).toBeCloseTo(Math.PI, 10);
    expect(w2.shaft_b).toBeCloseTo(-Math.PI / 2, 10);
    expect(w2.shaft_b).toBeCloseTo(w1.shaft_b ?? Number.NaN, 10);
  });

  it('1 mm の平歯車どうし → かみ合いとして認識され、速度比が今と同じ（S5-01）', () => {
    const thin = scene(
      [root('shaft_a', [0, 0, 0]), root('shaft_b', [60, 0, 0])],
      [spur('gear_a', 'shaft_a', 0, 20, 1), spur('gear_b', 'shaft_b', 0, 40, 1)],
      [motor],
    );
    expect(validateScene(thin)).toEqual({ ok: true });
    const layout = resolveLayout(thin);
    expect(layout.meshes.map((m) => [m.a, m.b])).toEqual([['gear_a', 'gear_b']]);
    expect(layout.interferences).toEqual([]);
    const w = omegas(thin);
    const w8 = omegas(pair(8));
    expect(w.shaft_a).toBeCloseTo(Math.PI, 10);
    expect(w.shaft_b).toBeCloseTo(-Math.PI / 2, 10);
    expect(w.shaft_b).toBeCloseTo(w8.shaft_b ?? Number.NaN, 10);
  });

  it('1 mm と 8 mm の平歯車もかみ合う（S5-01）', () => {
    const s = scene(
      [root('shaft_a', [0, 0, 0]), root('shaft_b', [60, 0, 0])],
      [spur('gear_a', 'shaft_a', 0, 20, 1), spur('gear_b', 'shaft_b', 0, 40, 8)],
      [motor],
    );
    expect(resolveLayout(s).meshes.map((m) => [m.a, m.b])).toEqual([['gear_a', 'gear_b']]);
    expect(omegas(s).shaft_b).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('同じシャフトの、4 mm 離れた位置にある 1 mm の歯車 2 枚は干渉しない（S5-01）', () => {
    const s = scene(
      [root('shaft_a', [0, 0, 0], [-4, 12])],
      [spur('gear_a', 'shaft_a', 0, 20, 1), spur('gear_b', 'shaft_a', 4, 30, 1)],
    );
    expect(validateScene(s)).toEqual({ ok: true });
    expect(resolveLayout(s).interferences).toEqual([]);
  });

  it('厚さの方向に少しでも重なっていればかみ合う（B は [−16, 4]、A は [0, 8]）', () => {
    const layout = resolveLayout(pair(20, -16));
    expect(layout.meshes.map((m) => [m.a, m.b])).toEqual([['gear_a', 'gear_b']]);
    // 重ならなければ（B は [−20, 0]、面で接するだけ）かみ合わない
    expect(resolveLayout(pair(20, -20)).meshes).toEqual([]);
  });

  it('干渉判定が width を使う（厚くすると、前はぶつからなかった配置がぶつかる）', () => {
    // A（中・20 歯、歯先 22）[0, 8] と、x = 30 の起点 C に小・20 歯（歯先 11）[12, 16]。
    // 半径方向には重なるが、軸方向に離れている
    const c: Gear = {
      id: 'gear_c',
      kind: 'spur',
      shaftId: 'shaft_c',
      size: 'S',
      teeth: 20,
      offset: 12,
    };
    const s = scene(
      [root('shaft_a', [0, 0, 0]), root('shaft_c', [30, 0, 0])],
      [spur('gear_a', 'shaft_a'), c],
    );
    expect(resolveLayout(s).interferences).toEqual([]);
    const thick = { ...s, gears: { ...s.gears, gear_a: spur('gear_a', 'shaft_a', 0, 20, 16) } };
    expect(resolveLayout(thick).interferences).toEqual([['gear_a', 'gear_c']]);
    expect(code(apply(s, { type: 'setGearWidth', gearId: 'gear_a', width: 16 }))).toBe(
      'notAllowed',
    );
  });

  it('厚くすると歯車の中心は区画の中央（offset + width / 2）に移る', () => {
    const next = ok(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width: 20 }));
    expect(resolveLayout(next).gears.gear_a?.center).toEqual([0, 10, 0]);
  });
});

describe('薄い太陽歯車の遊星歯車機構（S5-01）', () => {
  it('厚さ 1.5 mm の太陽 → キャリアは 4 mm の区画の外に置かれ（offset が AXIAL_SNAP の倍数）、シーンが正しい', () => {
    const sun = scene([root('shaft_a', [0, 60, 0])], [spur('gear_a', 'shaft_a', 0, 24, 1.5)]);
    const next = ok(apply(sun, { type: 'growGear', mode: 'planetary', parentGearId: 'gear_a' }));
    const carrier = Object.values(next.carriers)[0];
    expect(carrier?.offset).toBe(8);
    expect(validateScene(next)).toEqual({ ok: true });
    expect(resolveLayout(next).interferences).toEqual([]);
  });
});

describe('検証', () => {
  it('width: 1.5 → 通る（S5-01）', () => {
    const s = scene([root('shaft_a', [0, 0, 0])], [spur('gear_a', 'shaft_a', 0, 20, 1.5)]);
    expect(validateScene(s)).toEqual({ ok: true });
  });

  it('width が 0.5〜32 の 0.5 の倍数でない → invalidWidth', () => {
    for (const width of [0, 0.3, 0.25, 32.5, 36]) {
      const s = scene([root('shaft_a', [0, 0, 0])], [spur('gear_a', 'shaft_a', 0, 20, width)]);
      const result = validateScene(s);
      expect(result.ok ? [] : result.errors.map((e) => e.code)).toContain('invalidWidth');
    }
  });

  it('かさ歯車・ウォーム・ホイールが大きさごとの歯幅と違う width を持つ → invalidWidth', () => {
    const bevel: Gear = {
      id: 'gear_b',
      kind: 'bevel',
      shaftId: 'shaft_a',
      size: 'M',
      teeth: 20,
      offset: 0,
      apex: 1,
      width: 12,
    };
    const result = validateScene(scene([root('shaft_a', [0, 0, 0])], [bevel]));
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toContain('invalidWidth');
    const same = { ...bevel, width: 8 };
    expect(validateScene(scene([root('shaft_a', [0, 0, 0])], [same]))).toEqual({ ok: true });
  });

  it('ラックの width が 0.5〜32 の 0.5 の倍数でない → invalidWidth', () => {
    const s = scene(
      [root('shaft_a', [0, 0, 0])],
      [spur('gear_a', 'shaft_a')],
      [],
      [{ ...pinionRack(), width: 36 }],
    );
    const result = validateScene(s);
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toContain('invalidWidth');
  });
});

describe('ラックの厚さ（setRackWidth）', () => {
  // A（中・20 歯）をピニオンにしたラック（中・20 歯）
  const base = scene([root('shaft_a', [0, 0, 0])], [spur('gear_a', 'shaft_a')], [], [pinionRack()]);

  it('0.5〜32 mm の 0.5 mm の倍数 → 通る。範囲外・0.5 の倍数でない → invalidValue。無いラック → notFound', () => {
    for (const width of [0.5, 1, 1.5, 20, 32]) {
      const next = ok(apply(base, { type: 'setRackWidth', rackId: 'rack_a', width }));
      expect(next.racks.rack_a?.width).toBe(width);
      expect(validateScene(next)).toEqual({ ok: true });
    }
    for (const width of [0, 0.25, 0.7, 32.5, 36]) {
      expect(code(apply(base, { type: 'setRackWidth', rackId: 'rack_a', width }))).toBe(
        'invalidValue',
      );
    }
    expect(code(apply(base, { type: 'setRackWidth', rackId: 'rack_x', width: 8 }))).toBe(
      'notFound',
    );
  });

  it('厚さの違うピニオンとラックもかみ合ったまま（木の組）', () => {
    const next = ok(apply(base, { type: 'setRackWidth', rackId: 'rack_a', width: 24 }));
    const layout = resolveLayout(next);
    expect(layout.rackMeshes.map((m) => [m.gear, m.rack])).toEqual([['gear_a', 'rack_a']]);
    expect(layout.interferences).toEqual([]);
  });
});

describe('保存と読み込み', () => {
  it('width を持つシーンを保存・読み込み → 同じ値', () => {
    const s = ok(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width: 20 }));
    const parsed = parseSaveFile(serializeSaveFile(toSaveFile(s)));
    if (!parsed.ok) throw new Error(parsed.error.code);
    expect(parsed.file.scene.gears.gear_a?.width).toBe(20);
    expect(parsed.file.scene.shafts.shaft_a?.span).toEqual([-4, 24]);
    const withRack = ok(
      apply(scene([root('shaft_a', [0, 0, 0])], [spur('gear_a', 'shaft_a')], [], [pinionRack()]), {
        type: 'setRackWidth',
        rackId: 'rack_a',
        width: 12,
      }),
    );
    const parsedRack = parseSaveFile(serializeSaveFile(toSaveFile(withRack)));
    if (!parsedRack.ok) throw new Error(parsedRack.error.code);
    expect(parsedRack.file.scene.racks.rack_a?.width).toBe(12);
  });

  it('厚さ 1.5 mm のシーンを保存・読み込み → 同じ値（S5-01）', () => {
    const s = ok(apply(single, { type: 'setGearWidth', gearId: 'gear_a', width: 1.5 }));
    const parsed = parseSaveFile(serializeSaveFile(toSaveFile(s)));
    if (!parsed.ok) throw new Error(parsed.error.code);
    expect(parsed.file.scene.gears.gear_a?.width).toBe(1.5);
    expect(parsed.file.scene).toEqual(s);
  });

  it('厚さを変えていない歯車・ラックは width を省いたまま書き、読み込むと大きさごとの値になる', () => {
    const withRack = scene(
      [root('shaft_a', [0, 0, 0])],
      [spur('gear_a', 'shaft_a')],
      [],
      [pinionRack()],
    );
    const parsed = parseSaveFile(serializeSaveFile(toSaveFile(withRack)));
    if (!parsed.ok) throw new Error(parsed.error.code);
    const gear = parsed.file.scene.gears.gear_a;
    expect(gear?.width).toBeUndefined();
    expect(gear === undefined ? undefined : gearWidth(gear)).toBe(8);
    expect(parsed.file.scene.racks.rack_a?.width).toBeUndefined();
  });
});
