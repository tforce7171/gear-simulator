import { describe, expect, it } from 'vitest';
import { gearCenter } from './gear-center';
import { emptyScene } from './scene';
import { shaftAxis } from './shaft-axis';
import type { Scene } from './types';

describe('emptyScene', () => {
  it('空のコレクションを持つ', () => {
    expect(emptyScene()).toEqual({ shafts: {}, gears: {}, motors: {} });
  });
});

describe('gearCenter', () => {
  it('シャフトの原点 + (offset + 歯幅/2) × 軸', () => {
    expect(gearCenter([0, 10, 0], 'y', { size: 'S', offset: 4 })).toEqual([0, 16, 0]);
    expect(gearCenter([30, 0, 0], 'z', { size: 'S', offset: 0 })).toEqual([30, 0, 2]);
    expect(gearCenter([0, 0, 0], 'x', { size: 'L', offset: -8 })).toEqual([-2, 0, 0]);
  });
});

describe('shaftAxis', () => {
  const scene: Scene = {
    shafts: {
      root: { id: 'root', placement: { kind: 'root', origin: [0, 0, 0], axis: 'x' } },
      child: {
        id: 'child',
        placement: { kind: 'mesh', parentGearId: 'g_root', childGearId: 'g_child', angle: 0 },
      },
      grandchild: {
        id: 'grandchild',
        placement: { kind: 'mesh', parentGearId: 'g_child', childGearId: 'g_grand', angle: 1 },
      },
      floating: { id: 'floating', placement: { kind: 'detached', origin: [5, 0, 0], axis: 'z' } },
      loopA: {
        id: 'loopA',
        placement: { kind: 'mesh', parentGearId: 'g_loopB', childGearId: 'g_loopA', angle: 0 },
      },
      loopB: {
        id: 'loopB',
        placement: { kind: 'mesh', parentGearId: 'g_loopA', childGearId: 'g_loopB', angle: 0 },
      },
    },
    gears: {
      g_root: { id: 'g_root', kind: 'spur', shaftId: 'root', size: 'S', teeth: 12, offset: 0 },
      g_child: { id: 'g_child', kind: 'spur', shaftId: 'child', size: 'S', teeth: 24, offset: 0 },
      g_grand: {
        id: 'g_grand',
        kind: 'spur',
        shaftId: 'grandchild',
        size: 'S',
        teeth: 12,
        offset: 0,
      },
      g_loopA: { id: 'g_loopA', kind: 'spur', shaftId: 'loopA', size: 'S', teeth: 12, offset: 0 },
      g_loopB: { id: 'g_loopB', kind: 'spur', shaftId: 'loopB', size: 'S', teeth: 12, offset: 0 },
    },
    motors: {},
  };

  it("root（'x'）の子・孫はどちらも 'x'", () => {
    expect(shaftAxis(scene, 'root')).toBe('x');
    expect(shaftAxis(scene, 'child')).toBe('x');
    expect(shaftAxis(scene, 'grandchild')).toBe('x');
  });

  it("detached（'z'）は 'z'", () => {
    expect(shaftAxis(scene, 'floating')).toBe('z');
  });

  it('循環・存在しないシャフトは null', () => {
    expect(shaftAxis(scene, 'loopA')).toBeNull();
    expect(shaftAxis(scene, 'nothing')).toBeNull();
  });
});
