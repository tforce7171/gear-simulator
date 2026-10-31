import { describe, expect, it } from 'vitest';
import { PERIMETER_CANDIDATE_COUNT } from '../constants';
import { samePhase } from '../geometry/mesh';
import type { Vec3 } from '../math/vec3';
import type { Gear, Scene, Shaft, SizeKey } from '../scene/types';
import {
  candidateKind,
  type GrowCandidate,
  type GrowSpec,
  listGrowCandidates,
  meshableKinds,
  PALETTE_KIND_LIST,
  type PaletteKind,
} from './candidates';
import { resolveLayout } from './resolve';

// テスト用の小さな組み立て（resolve.test.ts と同じ形）
function root(id: string, origin: Vec3): Shaft {
  return { id, placement: { kind: 'root', origin, axis: 'y' } };
}
function meshShaft(id: string, parentGearId: string, childGearId: string, angle: number): Shaft {
  return { id, placement: { kind: 'mesh', parentGearId, childGearId, angle } };
}
function gear(id: string, shaftId: string, teeth: number, offset = 0, size: SizeKey = 'S'): Gear {
  return { id, kind: 'spur', shaftId, size, teeth, offset };
}
function scene(shafts: Shaft[], gears: Gear[]): Scene {
  return {
    shafts: Object.fromEntries(shafts.map((s) => [s.id, s])),
    gears: Object.fromEntries(gears.map((g) => [g.id, g])),
    motors: {},
    anchors: {},
    carriers: {},
    racks: {},
  };
}

function expectVec(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toBeDefined();
  expected.forEach((e, i) => {
    expect(actual?.[i]).toBeCloseTo(e, 9);
  });
}

type Perimeter = Extract<GrowCandidate, { kind: 'perimeter' }>;
type Coaxial = Extract<GrowCandidate, { kind: 'coaxial' }>;

function perimeters(list: readonly GrowCandidate[]): Perimeter[] {
  return list.filter((c): c is Perimeter => c.kind === 'perimeter');
}
function coaxials(list: readonly GrowCandidate[]): Coaxial[] {
  return list.filter((c): c is Coaxial => c.kind === 'coaxial');
}
// 角度を π/4 の何倍かで表す（比べやすくするため）
function angleSteps(list: readonly GrowCandidate[]): number[] {
  return perimeters(list).map((c) => Math.round(c.angle / (Math.PI / 4)));
}
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const SPEC: GrowSpec = {
  perimeterTeeth: 12,
  coaxialSize: 'S',
  coaxialTeeth: 12,
  kind: 'spur',
};

// 起点 A: axis 'y'、原点、12 歯 offset 0（中心 [0, 2, 0]）
const shaftA = root('shaft_a', [0, 0, 0]);
const gearA = gear('gear_a', 'shaft_a', 12);
const onlyA = scene([shaftA], [gearA]);

describe('外周の候補', () => {
  it('歯車 1 枚だけ、perimeterTeeth 12 → 8 方向、中心・大きさ・軸・位相', () => {
    const list = perimeters(listGrowCandidates(onlyA, 'gear_a', SPEC));
    expect(list).toHaveLength(8);
    list.forEach((c, k) => {
      expect(c.angle).toBeCloseTo((k * Math.PI) / 4, 12);
      expect(c.parentGearId).toBe('gear_a');
      expect(c.size).toBe('S');
      expect(c.teeth).toBe(12);
      expect(c.axis).toBe('y');
      expect(distance(c.center, [0, 2, 0])).toBeCloseTo(12, 9);
    });
    expectVec(list[0]?.center, [0, 2, 12]);
    expectVec(list[2]?.center, [12, 2, 0]);
    expect(samePhase(list[2]?.basePhase ?? Number.NaN, Math.PI / 12, 12)).toBe(true);
  });

  it('perimeterTeeth 40 → 8 個、中心距離 26', () => {
    const list = perimeters(listGrowCandidates(onlyA, 'gear_a', { ...SPEC, perimeterTeeth: 40 }));
    expect(list).toHaveLength(8);
    for (const c of list) {
      expect(c.teeth).toBe(40);
      expect(distance(c.center, [0, 2, 0])).toBeCloseTo(26, 9);
    }
  });

  it('親が M・20 歯、perimeterTeeth 20 → 8 個、中心距離 40、size M', () => {
    const s = scene([shaftA], [gear('gear_a', 'shaft_a', 20, 0, 'M')]);
    const list = perimeters(listGrowCandidates(s, 'gear_a', { ...SPEC, perimeterTeeth: 20 }));
    expect(list).toHaveLength(8);
    for (const c of list) {
      expect(c.size).toBe('M');
      expect(distance(c.center, [0, 4, 0])).toBeCloseTo(40, 9);
    }
  });

  describe('子があるときの絞り込み（A に子 B、angle π/2）', () => {
    const s = scene(
      [shaftA, meshShaft('shaft_b', 'gear_a', 'gear_b', Math.PI / 2)],
      [gearA, gear('gear_b', 'shaft_b', 12)],
    );

    it('B の中心は [12, 2, 0]', () => {
      expectVec(resolveLayout(s).gears.gear_b?.center, [12, 2, 0]);
    });

    it('A を選ぶ → 0, π, 5π/4, 3π/2, 7π/4', () => {
      expect(angleSteps(listGrowCandidates(s, 'gear_a', SPEC))).toEqual([0, 4, 5, 6, 7]);
    });

    it('B を選ぶ → 0, π/4, π/2, 3π/4, π', () => {
      expect(angleSteps(listGrowCandidates(s, 'gear_b', SPEC))).toEqual([0, 1, 2, 3, 4]);
    });
  });

  it('偶然のかみ合いは許す: A → B → C で C を選ぶ → angle 3π/2（中心 [0, 2, 12]）が出る', () => {
    const s = scene(
      [
        shaftA,
        meshShaft('shaft_b', 'gear_a', 'gear_b', Math.PI / 2),
        meshShaft('shaft_c', 'gear_b', 'gear_c', 0),
      ],
      [gearA, gear('gear_b', 'shaft_b', 12), gear('gear_c', 'shaft_c', 12)],
    );
    expectVec(resolveLayout(s).gears.gear_c?.center, [12, 2, 12]);
    const list = perimeters(listGrowCandidates(s, 'gear_c', SPEC));
    const c = list.find((x) => Math.round(x.angle / (Math.PI / 4)) === 6);
    expect(c).toBeDefined();
    expectVec(c?.center, [0, 2, 12]);
  });

  it('位相が合わなくても許す: 起点 F（[24.5, 0, 0]、13 歯）→ angle π/2 が出て、8 個のまま', () => {
    const s = scene(
      [shaftA, root('shaft_f', [24.5, 0, 0])],
      [gearA, gear('gear_f', 'shaft_f', 13)],
    );
    const list = perimeters(listGrowCandidates(s, 'gear_a', SPEC));
    expect(list).toHaveLength(8);
    const c = list[2];
    expect(c?.angle).toBeCloseTo(Math.PI / 2, 12);
    expectVec(c?.center, [12, 2, 0]);
    // F と中心距離 12.5（ピッチ円半径の和）
    expect(distance(c?.center ?? [0, 0, 0], [24.5, 2, 0])).toBeCloseTo(12.5, 9);
  });
});

describe('同じ軸の候補', () => {
  it('歯車 1 枚だけ、S・12 歯 → offset −4（中心 [0, −2, 0]）と offset 4（中心 [0, 6, 0]）', () => {
    const list = coaxials(listGrowCandidates(onlyA, 'gear_a', SPEC));
    expect(list.map((c) => c.offset)).toEqual([-4, 4]);
    expectVec(list[0]?.center, [0, -2, 0]);
    expectVec(list[1]?.center, [0, 6, 0]);
    for (const c of list) {
      expect(c.shaftId).toBe('shaft_a');
      expect(c.size).toBe('S');
      expect(c.teeth).toBe(12);
      expect(c.axis).toBe('y');
    }
  });

  it('違う大きさ: M・20 歯 → offset −8（中心 [0, −4, 0]）と offset 4（中心 [0, 8, 0]）', () => {
    const list = coaxials(
      listGrowCandidates(onlyA, 'gear_a', { ...SPEC, coaxialSize: 'M', coaxialTeeth: 20 }),
    );
    expect(list.map((c) => c.offset)).toEqual([-8, 4]);
    expectVec(list[0]?.center, [0, -4, 0]);
    expectVec(list[1]?.center, [0, 8, 0]);
    for (const c of list) {
      expect(c.size).toBe('M');
      expect(c.teeth).toBe(20);
    }
  });

  it('並びの両端: offset 0 と 4 の 2 枚、offset 0 の方を選ぶ → offset −4 と 8', () => {
    const s = scene([shaftA], [gearA, gear('gear_a2', 'shaft_a', 12, 4)]);
    expect(coaxials(listGrowCandidates(s, 'gear_a', SPEC)).map((c) => c.offset)).toEqual([-4, 8]);
  });

  it('片側がふさがる: 起点 E（[13.5, 4, 0]）→ offset −4 だけ', () => {
    const s = scene(
      [shaftA, root('shaft_e', [13.5, 4, 0])],
      [gearA, gear('gear_e', 'shaft_e', 12)],
    );
    expect(resolveLayout(s).interferences).toEqual([]);
    expect(coaxials(listGrowCandidates(s, 'gear_a', SPEC)).map((c) => c.offset)).toEqual([-4]);
  });
});

describe('既存の干渉は関係しない', () => {
  it('A から離れた所で重なった起点 2 本を足しても、A の候補は変わらない', () => {
    const shaftE = root('shaft_e', [13.5, 4, 0]);
    const gearE = gear('gear_e', 'shaft_e', 12);
    const base = scene([shaftA, shaftE], [gearA, gearE]);
    const withOverlap = scene(
      [shaftA, shaftE, root('shaft_p', [200, 0, 0]), root('shaft_q', [205, 0, 0])],
      [gearA, gearE, gear('gear_p', 'shaft_p', 12), gear('gear_q', 'shaft_q', 12)],
    );
    expect(resolveLayout(withOverlap).interferences.length).toBeGreaterThan(0);
    expect(listGrowCandidates(withOverlap, 'gear_a', SPEC)).toEqual(
      listGrowCandidates(base, 'gear_a', SPEC),
    );
  });

  it('伸びるシャフトが元から干渉していても、それだけでは同じ軸の候補を減らさない', () => {
    // 起点 G を A の真上に置く（同じ直線上の別のシャフト）。G の歯車は y 6〜10
    const s = scene(
      [shaftA, root('shaft_g', [0, 30, 0])],
      [gearA, gear('gear_g', 'shaft_g', 12, -24)],
    );
    // A のシャフトの線分（y −4〜8）が G の歯車を貫く（元からある干渉）
    expect(resolveLayout(s).interferences).toContainEqual(['gear_g', 'shaft_a']);
    // offset 4（y 4〜8）は G の歯車と重なるので出ない。offset −4 は A のシャフトが伸びるが、
    // A のシャフトを含む干渉は元からある組だけなので出る
    expect(coaxials(listGrowCandidates(s, 'gear_a', SPEC)).map((c) => c.offset)).toEqual([-4]);
  });
});

describe('引数の誤り', () => {
  it('perimeterTeeth 81（S）→ 例外', () => {
    expect(() => listGrowCandidates(onlyA, 'gear_a', { ...SPEC, perimeterTeeth: 81 })).toThrow();
  });

  it('coaxialSize L、coaxialTeeth 41 → 例外', () => {
    expect(() =>
      listGrowCandidates(onlyA, 'gear_a', { ...SPEC, coaxialSize: 'L', coaxialTeeth: 41 }),
    ).toThrow();
  });

  it('歯数が整数でない → 例外。シーンに無い歯車 → 例外', () => {
    expect(() => listGrowCandidates(onlyA, 'gear_a', { ...SPEC, perimeterTeeth: 12.5 })).toThrow();
    expect(() => listGrowCandidates(onlyA, 'gear_x', SPEC)).toThrow();
  });

  it('根からたどれない歯車 → 空', () => {
    // 親の歯車がシーンに無い mesh のシャフト（検証を通らないシーンだが、例外にしない）
    const s = scene(
      [meshShaft('shaft_o', 'gear_none', 'gear_o', 0)],
      [gear('gear_o', 'shaft_o', 12)],
    );
    expect(listGrowCandidates(s, 'gear_o', SPEC)).toEqual([]);
  });
});

describe('並び・決定性・不変', () => {
  it('外周（角度の昇順）→ 同じ軸（負 → 正）。パレットが平歯車なら遊星・ラックは出ない（S4-02）', () => {
    const list = listGrowCandidates(onlyA, 'gear_a', SPEC);
    expect(list.map((c) => c.kind)).toEqual([
      ...Array<string>(PERIMETER_CANDIDATE_COUNT).fill('perimeter'),
      'coaxial',
      'coaxial',
    ]);
    expect(angleSteps(list)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(coaxials(list).map((c) => c.offset)).toEqual([-4, 4]);
  });

  it('同じ入力なら同じ結果', () => {
    expect(listGrowCandidates(onlyA, 'gear_a', SPEC)).toEqual(
      listGrowCandidates(onlyA, 'gear_a', SPEC),
    );
  });

  it('入力のシーンを変更しない（Object.freeze したシーンで例外にならない）', () => {
    const frozen: Scene = Object.freeze({
      shafts: Object.freeze({ shaft_a: Object.freeze(shaftA) }),
      gears: Object.freeze({ gear_a: Object.freeze(gearA) }),
      motors: Object.freeze({}),
      anchors: {},
      carriers: {},
      racks: {},
    });
    // 外周 8 + 同じ軸 2（パレットが平歯車。S4-02）
    expect(listGrowCandidates(frozen, 'gear_a', SPEC)).toHaveLength(10);
    expect(Object.keys(frozen.gears)).toEqual(['gear_a']);
    expect(Object.keys(frozen.shafts)).toEqual(['shaft_a']);
  });

  it('戻り値に仮の ID を含まない', () => {
    const text = JSON.stringify(listGrowCandidates(onlyA, 'gear_a', SPEC));
    expect(text).not.toContain('__candidate');
  });
});

describe('性能の目安', () => {
  // 背骨: +X 方向に 100 枚の鎖。枝: 偶数番目は +Z、奇数番目は −Z に 1 枚ずつ（計 200 枚）
  function bigTree(): Scene {
    const shafts: Shaft[] = [root('shaft_0', [0, 0, 0])];
    const gears: Gear[] = [gear('gear_0', 'shaft_0', 12)];
    for (let i = 1; i < 100; i++) {
      shafts.push(meshShaft(`shaft_${i}`, `gear_${i - 1}`, `gear_${i}`, Math.PI / 2));
      gears.push(gear(`gear_${i}`, `shaft_${i}`, 12));
    }
    for (let i = 0; i < 100; i++) {
      shafts.push(meshShaft(`shaft_b${i}`, `gear_${i}`, `gear_b${i}`, i % 2 === 0 ? 0 : Math.PI));
      gears.push(gear(`gear_b${i}`, `shaft_b${i}`, 12));
    }
    return scene(shafts, gears);
  }

  it('12 歯の歯車 200 枚の木で、1 回の列挙が 200ms 未満', () => {
    const s = bigTree();
    const layout = resolveLayout(s);
    expect(Object.keys(layout.gears)).toHaveLength(200);
    expect(layout.interferences).toEqual([]);
    // 1 回目は JIT の準備を含むので、2 回目を測る
    listGrowCandidates(s, 'gear_50', SPEC);
    const start = performance.now();
    const list = listGrowCandidates(s, 'gear_50', SPEC);
    const elapsed = performance.now() - start;
    expect(list.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('パレットの種類での絞り込み（S4-02）', () => {
  // 中・24 歯の平歯車 1 枚（遊星歯車機構の歯数の組 12・48 がある）
  const spurM = scene([shaftA], [gear('gear_a', 'shaft_a', 24, 0, 'M')]);
  const specOf = (kind: PaletteKind): GrowSpec => ({
    perimeterTeeth: 20,
    coaxialSize: 'M',
    coaxialTeeth: 20,
    kind,
  });

  for (const kind of PALETTE_KIND_LIST) {
    it(`平歯車の親 × パレットが ${kind} → 候補の種類は ${kind} だけ`, () => {
      const list = listGrowCandidates(spurM, 'gear_a', specOf(kind));
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map(candidateKind))).toEqual(new Set([kind]));
    });
  }

  it('平歯車の親 × パレットが平歯車 → 外周 8 方向と同じ軸の 2 つだけ（遊星・ラックの候補が無い）', () => {
    const list = listGrowCandidates(spurM, 'gear_a', specOf('spur'));
    expect(list.some((c) => c.kind === 'planetary' || c.kind === 'rack')).toBe(false);
    expect(list.map((c) => c.kind)).toEqual([
      ...Array<string>(PERIMETER_CANDIDATE_COUNT).fill('perimeter'),
      'coaxial',
      'coaxial',
    ]);
  });

  it('平歯車の親 × パレットがラック → ラックの候補だけ（4 か所）', () => {
    const list = listGrowCandidates(spurM, 'gear_a', specOf('rack'));
    expect(list.map((c) => c.kind)).toEqual(['rack', 'rack', 'rack', 'rack']);
  });

  it('平歯車の親 × パレットが遊星 → 遊星歯車機構の候補だけ（1 つ）', () => {
    const list = listGrowCandidates(spurM, 'gear_a', specOf('planetary'));
    expect(list.map((c) => c.kind)).toEqual(['planetary']);
  });

  it('平歯車の親 × パレットがウォーム → 外周の候補が無く、同じ軸の候補（ウォーム）だけ', () => {
    const list = listGrowCandidates(spurM, 'gear_a', specOf('worm'));
    expect(list.map((c) => c.kind)).toEqual(['coaxial', 'coaxial']);
    for (const c of list) expect(c.kind === 'coaxial' && c.shape.kind).toBe('worm');
  });

  it('平歯車の親 × パレットが内歯車 → 囲む候補と同じ軸の内歯車（外周の平歯車は出ない）', () => {
    const list = listGrowCandidates(spurM, 'gear_a', specOf('internal'));
    expect(list.map((c) => c.kind)).toEqual(['enclose', 'coaxial', 'coaxial']);
  });

  it('meshableKinds: 親の種類ごとにかみ合う向きに生やせる種類', () => {
    const one = (g: Gear): Scene => scene([shaftA], [g]);
    const base = gear('gear_a', 'shaft_a', 20, 0, 'M');
    expect(meshableKinds(one(base), 'gear_a')).toEqual(['spur', 'internal', 'rack', 'planetary']);
    expect(meshableKinds(one({ ...base, kind: 'helical', hand: 'right' }), 'gear_a')).toEqual([
      'helical',
    ]);
    expect(meshableKinds(one({ ...base, kind: 'bevel', apex: 1 }), 'gear_a')).toEqual(['bevel']);
    expect(meshableKinds(one({ ...base, kind: 'worm', teeth: 1 }), 'gear_a')).toEqual([
      'wormWheel',
    ]);
    expect(meshableKinds(one({ ...base, kind: 'wormWheel' }), 'gear_a')).toEqual(['worm']);
    expect(meshableKinds(one({ ...base, kind: 'crossedHelical' }), 'gear_a')).toEqual([
      'crossedHelical',
    ]);
    expect(
      meshableKinds(one({ ...base, kind: 'internal', webSide: -1, teeth: 40 }), 'gear_a'),
    ).toEqual(['spur']);
    expect(meshableKinds(one(base), 'gear_x')).toEqual([]);
    expect(meshableKinds(one(base), 'shaft_a')).toEqual([]);
  });

  it('PALETTE_KIND_LIST: 歯車の種類 → ラック → 遊星', () => {
    expect(PALETTE_KIND_LIST).toEqual([
      'spur',
      'helical',
      'bevel',
      'worm',
      'wormWheel',
      'crossedHelical',
      'internal',
      'rack',
      'planetary',
    ]);
  });
});
