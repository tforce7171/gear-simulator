import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../core/edit/commands';
import { candidateKind, PALETTE_KIND_LIST } from '../core/layout/candidates';
import { newInterferences } from '../core/layout/interference-diff';
import { resolveLayout } from '../core/layout/resolve';
import { createRandomIdGenerator, createSequentialIdGenerator } from '../core/scene/ids';
import type { Scene, SpurGear } from '../core/scene/types';
import { candidateSpec, candidatesFor, growCommand, growSpec, shaftGhostAt } from './grow';

function gear(patch: Partial<SpurGear>): SpurGear {
  return {
    id: 'gear_a',
    kind: 'spur',
    shaftId: 'shaft_a',
    size: 'M',
    teeth: 25,
    offset: 0,
    ...patch,
  };
}

// 縦軸の起点（原点 [0, 35, 0]）に中・20 歯の歯車 A を 1 枚（e2e/fixtures/one-root.json と同じ）
const oneRoot: Scene = {
  shafts: {
    shaft_a: { id: 'shaft_a', placement: { kind: 'root', origin: [0, 35, 0], axis: 'y' } },
  },
  gears: { gear_a: gear({ teeth: 20 }) },
  motors: {},
  anchors: {},
  carriers: {},
  racks: {},
};

describe('growSpec', () => {
  it('親が中・25 歯 → { size: M, teeth: 20 }（親と同じ大きさ）', () => {
    expect(growSpec(gear({ size: 'M', teeth: 25 }))).toEqual({ size: 'M', teeth: 20 });
  });
  it('親が小 → { size: S, teeth: 30 }', () => {
    expect(growSpec(gear({ size: 'S', teeth: 40 }))).toEqual({ size: 'S', teeth: 30 });
  });
});

describe('candidatesFor', () => {
  it('選択が無い・シャフトを選んでいる・シーンに無い ID → []', () => {
    expect(candidatesFor(oneRoot, null, 'spur')).toEqual([]);
    expect(candidatesFor(oneRoot, 'shaft_a', 'spur')).toEqual([]);
    expect(candidatesFor(oneRoot, 'gear_x', 'spur')).toEqual([]);
  });
  it('歯車を選ぶと、外周の親と同じ大きさの候補だけ（同じ軸の候補は S4-03 で廃止）', () => {
    const list = candidatesFor(oneRoot, 'gear_a', 'spur');
    expect(list).toHaveLength(8);
    for (const c of list) {
      expect(c.kind).toBe('perimeter');
      if (c.kind === 'perimeter') expect([c.size, c.teeth]).toEqual(['M', 20]);
    }
  });
});

describe('growCommand', () => {
  it('外周の候補 → mesh のシャフトと歯車を作る growGear', () => {
    const [first] = candidatesFor(oneRoot, 'gear_a', 'spur');
    if (first?.kind !== 'perimeter') throw new Error('外周の候補が無い');
    const command = growCommand(first);
    expect(command).toEqual({
      type: 'growGear',
      mode: 'perimeter',
      parentGearId: 'gear_a',
      angle: first.angle,
      teeth: 20,
    });
    const result = applyCommand(oneRoot, command, { ids: createSequentialIdGenerator() });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.created).toHaveLength(2);
  });
});

describe('shaftGhostAt（S4-03。シャフトの上に置く仮の歯車）', () => {
  // A は中・20 歯（offset 0、区画 [0, 8]）。シャフトの範囲は [−4, 12]
  it('中心が along に来るように offset を 4 の倍数に丸め、growGear（coaxial）のコマンドにする', () => {
    const g = shaftGhostAt(oneRoot, 'shaft_a', 10, 'S', 'spur');
    // 小は歯幅 4: 10 − 2 = 8
    expect(g).toMatchObject({ shaftId: 'shaft_a', kind: 'spur', size: 'S', teeth: 30, offset: 8 });
    expect(g?.blocked).toBe(false);
    expect(g?.command).toEqual({
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_a',
      offset: 8,
      size: 'S',
      teeth: 30,
      kind: 'spur',
    });
    expect(g?.spec).toMatchObject({
      center: [0, 35 + 10, 0],
      axis: 'y',
      followShaftId: 'shaft_a',
      followRatio: 1,
      withShaft: false,
      blocked: false,
    });
  });

  it('along はシャフトの範囲に収める（範囲の外へ追いかけない）', () => {
    // 端 12・−4 に中心を合わせ、(12 − 2) / 4 = 2.5 → 3、(−4 − 2) / 4 = −1.5 → −1 に丸める
    expect(shaftGhostAt(oneRoot, 'shaft_a', 100, 'S', 'spur')?.offset).toBe(12);
    expect(shaftGhostAt(oneRoot, 'shaft_a', -100, 'S', 'spur')?.offset).toBe(-4);
  });

  it('A と重なる位置 → blocked（赤）。置くコマンドは notAllowed', () => {
    const g = shaftGhostAt(oneRoot, 'shaft_a', 4, 'M', 'spur');
    expect(g?.offset).toBe(0);
    expect(g?.blocked).toBe(true);
    expect(g?.spec.blocked).toBe(true);
    const result = applyCommand(oneRoot, g?.command as Command, {
      ids: createSequentialIdGenerator(),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
  });

  for (const kind of ['spur', 'helical', 'bevel', 'worm', 'wormWheel', 'crossedHelical'] as const) {
    it(`パレットが ${kind} → その種類で置く`, () => {
      const g = shaftGhostAt(oneRoot, 'shaft_a', -40, 'M', kind);
      expect(g?.kind).toBe(kind);
      expect(g?.command).toMatchObject({ mode: 'coaxial', kind });
    });
  }

  it('ウォームは 1 条、内歯車は INTERNAL_MIN_TEETH 以上', () => {
    expect(shaftGhostAt(oneRoot, 'shaft_a', -40, 'M', 'worm')?.teeth).toBe(1);
    expect(shaftGhostAt(oneRoot, 'shaft_a', -40, 'M', 'internal')?.teeth).toBe(24);
  });

  it('パレットがラック・遊星 → null（シャフトの上には出さない）。シーンに無いシャフト → null', () => {
    expect(shaftGhostAt(oneRoot, 'shaft_a', 0, 'M', 'rack')).toBeNull();
    expect(shaftGhostAt(oneRoot, 'shaft_a', 0, 'M', 'planetary')).toBeNull();
    expect(shaftGhostAt(oneRoot, 'shaft_x', 0, 'M', 'spur')).toBeNull();
  });
});

describe('candidateSpec', () => {
  it('外周: 仮のシャフト付きで、親のシャフトに −(親の歯数 / 子の歯数) で回る', () => {
    const scene: Scene = { ...oneRoot, gears: { gear_a: gear({ teeth: 30 }) } };
    const first = candidatesFor(scene, 'gear_a', 'spur')[0];
    if (first?.kind !== 'perimeter') throw new Error('外周の候補が無い');
    expect(candidateSpec(scene, first)).toEqual({
      shape: { kind: 'spur' },
      size: 'M',
      teeth: 20,
      center: first.center,
      axis: 'y',
      phase: first.basePhase,
      followShaftId: 'shaft_a',
      followRatio: -1.5,
      withShaft: true,
    });
  });
});

describe('表示した候補はどれも置ける（S4-02）', () => {
  function fixture(name: string): Scene {
    const url = new URL(`../../e2e/fixtures/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8')) as Scene;
  }
  const SCENES = [
    'showcase',
    'stage2-showcase',
    'stage3-showcase',
    'rack-basic',
    'internal-pair',
    'planetary-ring-fixed',
    'worm-basic',
    'bevel-pair',
    'crossed-pair',
    'helical-pair',
  ];
  for (const name of SCENES) {
    it(`${name}: すべての歯車・ラック × パレットの種類の候補を growCommand で置くと、拒否されず干渉も増えない`, () => {
      const scene = fixture(name);
      const before = resolveLayout(scene);
      let count = 0;
      for (const id of [...Object.keys(scene.gears), ...Object.keys(scene.racks)]) {
        for (const kind of PALETTE_KIND_LIST) {
          const list = candidatesFor(scene, id, kind);
          for (const c of list) {
            expect(candidateKind(c)).toBe(kind);
            const result = applyCommand(scene, growCommand(c), {
              ids: createRandomIdGenerator(),
            });
            expect(result.ok, `${id} ${kind} ${c.kind}`).toBe(true);
            if (!result.ok) continue;
            expect(newInterferences(before, resolveLayout(result.scene))).toEqual([]);
            count++;
          }
        }
      }
      // 遊星歯車機構の組（太陽はリングと遊星に囲まれ、遊星の歯車からは生やさない）には、S4-03 で同じ軸の候補を
      // 廃止してから出せる候補が無い
      if (name === 'planetary-ring-fixed') expect(count).toBe(0);
      else expect(count).toBeGreaterThan(0);
    });
  }
});

describe('ラックを選んだとき（S4-02）', () => {
  it('パレットが平歯車なら 2 つ目のピニオンの候補、それ以外は候補なし', () => {
    const url = new URL('../../e2e/fixtures/rack-basic.json', import.meta.url);
    const scene = JSON.parse(readFileSync(url, 'utf8')) as Scene;
    const rackId = Object.keys(scene.racks)[0] as string;
    const spur = candidatesFor(scene, rackId, 'spur');
    expect(spur.length).toBeGreaterThan(0);
    expect(spur.every((c) => c.kind === 'rackPinion')).toBe(true);
    for (const kind of PALETTE_KIND_LIST.filter((k) => k !== 'spur')) {
      expect(candidatesFor(scene, rackId, kind)).toEqual([]);
    }
  });
});
