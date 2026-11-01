import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { IdGenerator } from '../scene/ids';
import type { Gear, PartColor, Scene } from '../scene/types';
import { validateScene } from '../scene/validate';
import { applyCommand, type Command, type CommandResult } from './commands';
import { emptyHistory, execute, redo, undo } from './history';

// S5-04: 部品ごとの色（setPartColor）と、生やした部品が元の部品の色を引き継ぐこと

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

// fixture の ID（gear_1 など）とぶつからない ID を作る
function ids(): IdGenerator {
  let n = 0;
  return (kind) => `${kind}_new${++n}`;
}

function apply(s: Scene, command: Command): CommandResult {
  return applyCommand(s, command, { ids: ids() });
}

function ok(result: CommandResult): { scene: Scene; created: string[] } {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

function code(result: CommandResult): string | null {
  return result.ok ? null : result.error.code;
}

function withGearColor(s: Scene, gearId: string, color: PartColor): Scene {
  const gear = s.gears[gearId] as Gear;
  return { ...s, gears: { ...s.gears, [gearId]: { ...gear, color } } };
}

// stage3-showcase: 遊星歯車機構（gear_s・carrier_k）、内歯車の組、ラック rack_r（固定具 anchor_r）、モーター 2 つ
const showcase = fixture('stage3-showcase');

describe('setPartColor（S5-04）', () => {
  const targets: Array<[string, (s: Scene) => PartColor | undefined]> = [
    ['gear_s', (s) => s.gears.gear_s?.color],
    ['gear_r', (s) => s.gears.gear_r?.color],
    ['rack_r', (s) => s.racks.rack_r?.color],
    ['carrier_k', (s) => s.carriers.carrier_k?.color],
    ['anchor_r', (s) => s.anchors.anchor_r?.color],
  ];
  for (const [target, colorOf] of targets) {
    it(`${target} の色を変えられる。null で color が消える`, () => {
      const colored = ok(apply(showcase, { type: 'setPartColor', target, color: 'silver' })).scene;
      expect(colorOf(colored)).toBe('silver');
      expect(validateScene(colored)).toEqual({ ok: true });
      const cleared = ok(apply(colored, { type: 'setPartColor', target, color: null })).scene;
      expect(colorOf(cleared)).toBeUndefined();
      // フィールドごと消す（保存したときに "color" が残らない）
      const collection = target.split('_')[0] as 'gear' | 'rack' | 'carrier' | 'anchor';
      const part = { gear: cleared.gears, rack: cleared.racks, carrier: cleared.carriers }[
        collection as 'gear'
      ]?.[target];
      if (part !== undefined) expect(part).not.toHaveProperty('color');
      if (collection === 'anchor') expect(cleared.anchors[target]).not.toHaveProperty('color');
    });
  }

  it('ほかの部品は同じ参照のまま', () => {
    const colored = ok(
      apply(showcase, { type: 'setPartColor', target: 'gear_s', color: 'metallicBlue' }),
    ).scene;
    expect(colored.gears.gear_d).toBe(showcase.gears.gear_d);
    expect(colored.shafts).toBe(showcase.shafts);
    expect(colored.racks).toBe(showcase.racks);
  });

  it('シャフト・モーター → notAllowed', () => {
    expect(
      code(apply(showcase, { type: 'setPartColor', target: 'shaft_s', color: 'silver' })),
    ).toBe('notAllowed');
    expect(
      code(apply(showcase, { type: 'setPartColor', target: 'motor_s', color: 'silver' })),
    ).toBe('notAllowed');
  });

  it('無い部品 → notFound', () => {
    expect(code(apply(showcase, { type: 'setPartColor', target: 'gear_x', color: 'silver' }))).toBe(
      'notFound',
    );
  });

  it('知らない色 → invalidValue', () => {
    expect(
      code(
        apply(showcase, {
          type: 'setPartColor',
          target: 'gear_s',
          color: 'gold' as PartColor,
        }),
      ),
    ).toBe('invalidValue');
  });

  it('今と同じ色（null で color なしも）なら同じシーンの参照', () => {
    expect(ok(apply(showcase, { type: 'setPartColor', target: 'gear_s', color: null })).scene).toBe(
      showcase,
    );
    const colored = withGearColor(showcase, 'gear_s', 'wood');
    expect(
      ok(apply(colored, { type: 'setPartColor', target: 'gear_s', color: 'wood' })).scene,
    ).toBe(colored);
  });

  it('テーマの系統によらず、どの色も入れられる（描くときに系統を見る）', () => {
    for (const color of ['brass', 'silver', 'metallicBlue', 'wood', 'darkOak'] as const) {
      const s = ok(apply(showcase, { type: 'setPartColor', target: 'rack_r', color })).scene;
      expect(s.racks.rack_r?.color).toBe(color);
    }
  });

  it('Undo/Redo で色が戻る', () => {
    const ctx = { ids: ids() };
    const state = { scene: showcase, history: emptyHistory() };
    const result = execute(state, { type: 'setPartColor', target: 'gear_s', color: 'silver' }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.scene.gears.gear_s?.color).toBe('silver');
    const back = undo(result.state);
    expect(back?.scene.gears.gear_s?.color).toBeUndefined();
    const again = back === null ? null : redo(back);
    expect(again?.scene.gears.gear_s?.color).toBe('silver');
  });
});

describe('生やした部品は元の部品の色を引き継ぐ（S5-04）', () => {
  const twoGears = fixture('two-gears');

  it('外周（perimeter）: 親の color が子に入る。親が color なしなら子もなし', () => {
    const colored = withGearColor(twoGears, 'gear_1', 'metallicBlue');
    const grow: Command = {
      type: 'growGear',
      mode: 'perimeter',
      parentGearId: 'gear_1',
      angle: Math.PI,
      teeth: 20,
    };
    const result = ok(apply(colored, grow));
    const child = result.scene.gears[result.created[1] as string];
    expect(child?.color).toBe('metallicBlue');
    const plain = ok(apply(twoGears, grow));
    expect(plain.scene.gears[plain.created[1] as string]).not.toHaveProperty('color');
  });

  it('囲む内歯車（enclose）', () => {
    const colored = withGearColor(twoGears, 'gear_1', 'darkOak');
    const result = ok(
      apply(colored, {
        type: 'growGear',
        mode: 'enclose',
        parentGearId: 'gear_1',
        angle: Math.PI,
        teeth: 40,
      }),
    );
    expect(result.scene.gears[result.created[1] as string]?.color).toBe('darkOak');
  });

  it('かさ歯車（bevel）', () => {
    const bevel = fixture('bevel-pair');
    const colored = withGearColor(bevel, 'gear_a', 'silver');
    const result = ok(
      apply(colored, {
        type: 'growGear',
        mode: 'bevel',
        parentGearId: 'gear_a',
        axisStep: 2,
        side: 1,
      }),
    );
    expect(result.scene.gears[result.created[1] as string]?.color).toBe('silver');
  });

  it('ねじれた位置（skew）', () => {
    const worm = fixture('worm-basic');
    const colored = withGearColor(worm, 'gear_h', 'brass');
    const result = ok(
      apply(colored, {
        type: 'growGear',
        mode: 'skew',
        parentGearId: 'gear_h',
        axisStep: 2,
        side: -1,
        teeth: 30,
      }),
    );
    expect(result.scene.gears[result.created[1] as string]?.color).toBe('brass');
  });

  it('遊星歯車機構（planetary）: キャリア・遊星・リングが太陽の color を引き継ぐ', () => {
    const colored = withGearColor(twoGears, 'gear_2', 'silver');
    const result = ok(
      apply(colored, { type: 'growGear', mode: 'planetary', parentGearId: 'gear_2' }),
    );
    const [, carrierId, ...rest] = result.created;
    expect(result.scene.carriers[carrierId as string]?.color).toBe('silver');
    const gears = rest.filter((id) => id.startsWith('gear_'));
    expect(gears.length).toBeGreaterThanOrEqual(4);
    for (const id of gears) expect(result.scene.gears[id]?.color, id).toBe('silver');
    // 色なしの太陽からは色なし
    const plain = ok(
      apply(twoGears, { type: 'growGear', mode: 'planetary', parentGearId: 'gear_2' }),
    );
    expect(plain.scene.carriers[plain.created[1] as string]).not.toHaveProperty('color');
  });

  it('ラック（growRack）: ピニオンの color', () => {
    const colored = withGearColor(twoGears, 'gear_1', 'wood');
    const result = ok(
      apply(colored, {
        type: 'growRack',
        gearId: 'gear_1',
        axisStep: 1,
        normalSign: -1,
        teeth: 10,
      }),
    );
    expect(result.scene.racks[result.created[0] as string]?.color).toBe('wood');
  });

  it('ラックの 2 つ目のピニオン（growGear rack）: ラックの color', () => {
    const rack = fixture('rack-basic');
    const rackR = rack.racks.rack_r as Scene['racks'][string];
    const colored: Scene = { ...rack, racks: { rack_r: { ...rackR, color: 'metallicBlue' } } };
    const result = ok(
      apply(colored, { type: 'growGear', mode: 'rack', rackId: 'rack_r', position: 60, teeth: 20 }),
    );
    expect(result.scene.gears[result.created[1] as string]?.color).toBe('metallicBlue');
  });

  it('遊星の数を変えると、作り直した遊星は 1 本目の遊星の color を引き継ぐ', () => {
    const colored = withGearColor(showcase, 'gear_p0', 'darkOak');
    const result = ok(apply(colored, { type: 'setPlanetCount', carrierId: 'carrier_k', count: 4 }));
    const planets = result.created.filter((id) => id.startsWith('gear_'));
    expect(planets).toHaveLength(4);
    for (const id of planets) expect(result.scene.gears[id]?.color).toBe('darkOak');
  });

  it('起点のシャフトの最初の歯車、シャフトの上に置く歯車、固定具は「自動」', () => {
    const colored = withGearColor(twoGears, 'gear_1', 'silver');
    const root = ok(
      apply(colored, {
        type: 'addRootShaft',
        axis: 'y',
        origin: [200, 30, 0],
        gear: { size: 'M', teeth: 20 },
      }),
    );
    expect(root.scene.gears[root.created[1] as string]).not.toHaveProperty('color');
    const coaxial = ok(
      apply(colored, {
        type: 'growGear',
        mode: 'coaxial',
        shaftId: 'shaft_1',
        offset: 16,
        size: 'S',
        teeth: 12,
      }),
    );
    expect(coaxial.scene.gears[coaxial.created[0] as string]).not.toHaveProperty('color');
    const anchored = ok(apply(colored, { type: 'addAnchor', shaftId: 'shaft_1' }));
    expect(anchored.scene.anchors[anchored.created[0] as string]).not.toHaveProperty('color');
  });
});
