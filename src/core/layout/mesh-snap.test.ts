import { describe, expect, it } from 'vitest';
import type { Gear, Scene, Shaft, SpurGear } from '../scene/types';
import { meshSnapTargets } from './mesh-snap';
import { resolveLayout } from './resolve';

// arc-loop.json 相当: 縦軸の起点 A（原点 [0, 35, 0]、中・20 歯）と T（原点 [40, 35, 0]、中・20 歯。
// A と contact でかみ合う）。A の外周に子 B（中・20 歯、angle 0）
function arcLoop(patch: { t?: Partial<SpurGear>; tAxis?: 'x' | 'y' | 'z'; withB2?: boolean } = {}) {
  const shafts: Record<string, Shaft> = {
    shaft_a: { id: 'shaft_a', placement: { kind: 'root', origin: [0, 35, 0], axis: 'y' } },
    shaft_t: {
      id: 'shaft_t',
      placement: { kind: 'root', origin: [40, 35, 0], axis: patch.tAxis ?? 'y' },
    },
    shaft_b: {
      id: 'shaft_b',
      placement: { kind: 'mesh', parentGearId: 'gear_a', childGearId: 'gear_b', angle: 0 },
    },
  };
  const gears: Record<string, Gear> = {
    gear_a: { id: 'gear_a', kind: 'spur', shaftId: 'shaft_a', size: 'M', teeth: 20, offset: 0 },
    gear_t: {
      id: 'gear_t',
      kind: 'spur',
      shaftId: 'shaft_t',
      size: 'M',
      teeth: 20,
      offset: 0,
      ...patch.t,
    },
    gear_b: { id: 'gear_b', kind: 'spur', shaftId: 'shaft_b', size: 'M', teeth: 20, offset: 0 },
  };
  if (patch.withB2 === true) {
    shafts.shaft_b2 = {
      id: 'shaft_b2',
      placement: { kind: 'mesh', parentGearId: 'gear_b', childGearId: 'gear_b2', angle: Math.PI },
    };
    gears.gear_b2 = {
      id: 'gear_b2',
      kind: 'spur',
      shaftId: 'shaft_b2',
      size: 'M',
      teeth: 20,
      offset: 0,
    };
  }
  const scene: Scene = { shafts, gears, motors: {}, anchors: {}, carriers: {} };
  return scene;
}

function targetIds(scene: Scene): string[] {
  return meshSnapTargets(scene, resolveLayout(scene), 'shaft_b').map((t) => t.gearId);
}

describe('meshSnapTargets', () => {
  it('arc-loop 相当: B のシャフト → T だけ（親 A は除く）。中心とピッチ円半径も返す', () => {
    const scene = arcLoop();
    const targets = meshSnapTargets(scene, resolveLayout(scene), 'shaft_b');
    expect(targets).toEqual([
      { gearId: 'gear_t', center: [40, 39, 0], pitchRadius: 20, meshDistance: 40 },
    ]);
  });

  it('T を小の歯車にしたシーン → []', () => {
    expect(targetIds(arcLoop({ t: { size: 'S', teeth: 30 } }))).toEqual([]);
  });

  it('T の offset を 8 にしたシーン（歯幅が重ならない）→ []', () => {
    expect(targetIds(arcLoop({ t: { offset: 8 } }))).toEqual([]);
  });

  it("T の軸を 'x' にしたシーン → []", () => {
    expect(targetIds(arcLoop({ tAxis: 'x' }))).toEqual([]);
  });

  it('B の先に子 B2 があっても、B2 は相手にならない', () => {
    expect(targetIds(arcLoop({ withB2: true }))).toEqual(['gear_t']);
  });

  it('mesh でないシャフト・シーンに無いシャフト → []', () => {
    const scene = arcLoop();
    const layout = resolveLayout(scene);
    expect(meshSnapTargets(scene, layout, 'shaft_a')).toEqual([]);
    expect(meshSnapTargets(scene, layout, 'nope')).toEqual([]);
  });
});
