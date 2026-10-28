import { describe, expect, it } from 'vitest';
import { applyCommand } from '../core/edit/commands';
import type { GrowCandidate } from '../core/layout/candidates';
import { createSequentialIdGenerator } from '../core/scene/ids';
import type { Scene, SpurGear } from '../core/scene/types';
import { candidateSpec, candidatesFor, growCommand, growSpec } from './grow';

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
};

describe('growSpec', () => {
  it("親が中・25 歯で 'perimeter'、パレットが大 → { size: 'M', teeth: 20 }", () => {
    expect(growSpec(gear({ size: 'M', teeth: 25 }), 'perimeter', 'L')).toEqual({
      size: 'M',
      teeth: 20,
    });
  });
  it("親が中・25 歯で 'coaxial'、パレットが大 → { size: 'L', teeth: 16 }", () => {
    expect(growSpec(gear({ size: 'M', teeth: 25 }), 'coaxial', 'L')).toEqual({
      size: 'L',
      teeth: 16,
    });
  });
  it("親が小で 'perimeter' → { size: 'S', teeth: 30 }", () => {
    expect(growSpec(gear({ size: 'S', teeth: 40 }), 'perimeter', 'M')).toEqual({
      size: 'S',
      teeth: 30,
    });
  });
});

describe('candidatesFor', () => {
  it('選択が無い・シャフトを選んでいる・シーンに無い ID → []', () => {
    expect(candidatesFor(oneRoot, null, 'M', 'spur')).toEqual([]);
    expect(candidatesFor(oneRoot, 'shaft_a', 'M', 'spur')).toEqual([]);
    expect(candidatesFor(oneRoot, 'gear_x', 'M', 'spur')).toEqual([]);
  });
  it('歯車を選ぶと、外周は親と同じ大きさ・同じ軸はパレットの大きさの候補', () => {
    const list = candidatesFor(oneRoot, 'gear_a', 'L', 'spur');
    const perimeter = list.filter((c) => c.kind === 'perimeter');
    const coaxial = list.filter((c) => c.kind === 'coaxial');
    expect(perimeter).toHaveLength(8);
    for (const c of perimeter) expect([c.size, c.teeth]).toEqual(['M', 20]);
    expect(coaxial.map((c) => [c.size, c.teeth, c.kind === 'coaxial' ? c.offset : null])).toEqual([
      ['L', 16, -12],
      ['L', 16, 8],
    ]);
  });
});

describe('growCommand', () => {
  it('外周の候補 → mesh のシャフトと歯車を作る growGear', () => {
    const [first] = candidatesFor(oneRoot, 'gear_a', 'M', 'spur');
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
  it('同じ軸の候補 → 親のシャフトに通す growGear', () => {
    const coaxial = candidatesFor(oneRoot, 'gear_a', 'S', 'spur').find((c) => c.kind === 'coaxial');
    if (coaxial?.kind !== 'coaxial') throw new Error('同じ軸の候補が無い');
    expect(growCommand(coaxial)).toEqual({
      type: 'growGear',
      mode: 'coaxial',
      shaftId: 'shaft_a',
      offset: -4,
      size: 'S',
      teeth: 30,
      kind: 'spur',
    });
  });
});

describe('パレットの種類で同じ軸の候補を作る（S2-05）', () => {
  for (const kind of ['spur', 'helical', 'bevel', 'worm', 'wormWheel', 'crossedHelical'] as const) {
    it(`${kind} → 同じ軸の候補はその種類で、growGear の kind も ${kind}`, () => {
      const list = candidatesFor(oneRoot, 'gear_a', 'M', kind).filter((c) => c.kind === 'coaxial');
      expect(list.length).toBeGreaterThan(0);
      for (const c of list) {
        expect(c.shape.kind).toBe(kind);
        expect(growCommand(c)).toMatchObject({ mode: 'coaxial', kind });
      }
    });
  }

  it('ウォームは歯数によらず 1 条', () => {
    const [c] = candidatesFor(oneRoot, 'gear_a', 'M', 'worm').filter((x) => x.kind === 'coaxial');
    const result = applyCommand(oneRoot, growCommand(c as GrowCandidate), {
      ids: createSequentialIdGenerator(),
    });
    if (!result.ok) throw new Error(result.error.message);
    const created = Object.values(result.scene.gears).find((g) => g.kind === 'worm');
    expect(created?.teeth).toBe(1);
  });

  it('外周の候補の種類は親で決まり、パレットの種類によらない', () => {
    const perimeter = candidatesFor(oneRoot, 'gear_a', 'M', 'worm').filter(
      (c) => c.kind === 'perimeter',
    );
    expect(perimeter.length).toBeGreaterThan(0);
    for (const c of perimeter) expect(c.shape.kind).toBe('spur');
  });
});

describe('candidateSpec', () => {
  it('外周: 仮のシャフト付きで、親のシャフトに −(親の歯数 / 子の歯数) で回る', () => {
    const scene: Scene = { ...oneRoot, gears: { gear_a: gear({ teeth: 30 }) } };
    const first = candidatesFor(scene, 'gear_a', 'M', 'spur')[0];
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
  it('同じ軸: シャフトは描かず、親のシャフトと一緒に回る', () => {
    const coaxial = candidatesFor(oneRoot, 'gear_a', 'M', 'spur').find((c) => c.kind === 'coaxial');
    if (coaxial === undefined) throw new Error('同じ軸の候補が無い');
    expect(candidateSpec(oneRoot, coaxial)).toMatchObject({
      phase: 0,
      followShaftId: 'shaft_a',
      followRatio: 1,
      withShaft: false,
    });
  });
});
