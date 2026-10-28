import { describe, expect, it } from 'vitest';
import type { Scene } from '../scene/types';
import { boundsOf } from './bounds';
import { resolveLayout } from './resolve';

const EMPTY: Scene = { shafts: {}, gears: {}, motors: {}, anchors: {}, carriers: {} };

// 原点の縦軸の起点に中・20 歯の歯車（offset を指定）
function oneGear(offset: number): Scene {
  return {
    shafts: { s1: { id: 's1', placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } } },
    gears: { g1: { id: 'g1', kind: 'spur', shaftId: 's1', size: 'M', teeth: 20, offset } },
    motors: {},
    anchors: {},
    carriers: {},
  };
}

// oneGear(0) の外周（角度 0 = +Z）に中・20 歯をかみ合わせたもの。中心は [0, 4, 40]
const TWO: Scene = {
  shafts: {
    s1: { id: 's1', placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } },
    s2: {
      id: 's2',
      placement: { kind: 'mesh', parentGearId: 'g1', childGearId: 'g2', angle: 0 },
    },
  },
  gears: {
    g1: { id: 'g1', kind: 'spur', shaftId: 's1', size: 'M', teeth: 20, offset: 0 },
    g2: { id: 'g2', kind: 'spur', shaftId: 's2', size: 'M', teeth: 20, offset: 0 },
  },
  motors: {},
  anchors: {},
  carriers: {},
};

function expectBox(
  box: ReturnType<typeof boundsOf>,
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): void {
  expect(box).not.toBeNull();
  if (box === null) return;
  for (let i = 0; i < 3; i++) {
    expect(box.min[i]).toBeCloseTo(min[i] as number, 6);
    expect(box.max[i]).toBeCloseTo(max[i] as number, 6);
  }
}

describe('boundsOf', () => {
  it('空のシーン → null', () => {
    expect(boundsOf(EMPTY, resolveLayout(EMPTY))).toBeNull();
  });

  it('中・20 歯（offset 0、中心 [0, 4, 0]）→ x・z は ±22（歯先円半径）、y は 0〜8', () => {
    const scene = oneGear(0);
    const layout = resolveLayout(scene);
    expect(layout.gears.g1?.center).toEqual([0, 4, 0]);
    expectBox(boundsOf(scene, layout), [-22, 0, -22], [22, 8, 22]);
  });

  it('offset −4 → y は −4〜4', () => {
    const scene = oneGear(-4);
    expectBox(boundsOf(scene, resolveLayout(scene)), [-22, -4, -22], [22, 4, 22]);
  });

  it('2 枚 → 両方を含む範囲', () => {
    expectBox(boundsOf(TWO, resolveLayout(TWO)), [-22, 0, -22], [22, 8, 62]);
  });

  it('ids で 1 つを指定すると、その部品だけの範囲になる', () => {
    const layout = resolveLayout(TWO);
    expectBox(boundsOf(TWO, layout, ['g2']), [-22, 0, 18], [22, 8, 62]);
    expectBox(boundsOf(TWO, layout, ['g1']), [-22, 0, -22], [22, 8, 22]);
  });

  it('ids が空、またはシーンに無い ID だけ → null', () => {
    const layout = resolveLayout(TWO);
    expect(boundsOf(TWO, layout, [])).toBeNull();
    expect(boundsOf(TWO, layout, ['gear_nope'])).toBeNull();
  });

  it('ids でシャフトを指定すると、シャフトの線分の範囲', () => {
    const scene = oneGear(0);
    const layout = resolveLayout(scene);
    const span = layout.shafts.s1?.span;
    expect(span).toBeDefined();
    if (span === undefined) return;
    expectBox(boundsOf(scene, layout, ['s1']), [0, span[0], 0], [0, span[1], 0]);
  });

  it('横向きの軸（x）の歯車 → 軸方向は歯幅、他は歯先円半径', () => {
    const scene: Scene = {
      shafts: { s1: { id: 's1', placement: { kind: 'root', origin: [10, 30, 0], axis: 'x' } } },
      gears: { g1: { id: 'g1', kind: 'spur', shaftId: 's1', size: 'S', teeth: 12, offset: 0 } },
      motors: {},
      anchors: {},
      carriers: {},
    };
    // S・12 歯: 歯先円半径 7、歯幅 4。中心 [12, 30, 0]
    expectBox(boundsOf(scene, resolveLayout(scene)), [10, 23, -7], [14, 37, 7]);
  });
});
