import { describe, expect, it } from 'vitest';
import type { Gear, GearShape, Hand, SizeKey } from '../scene/types';
import { canMesh, meshKindOf } from './can-mesh';

function helical(hand: Hand, size: SizeKey = 'M', id = 'gear_h'): Gear {
  return { id, kind: 'helical', hand, shaftId: 'shaft_x', size, teeth: 20, offset: 0 };
}
function spur(size: SizeKey = 'M'): Gear {
  return { id: 'gear_s', kind: 'spur', shaftId: 'shaft_x', size, teeth: 20, offset: 0 };
}

describe('canMesh（S2-01）', () => {
  it("'right' と 'left' のハスバ（同じ大きさ）→ 真", () => {
    expect(canMesh(helical('right'), helical('left'))).toBe(true);
    expect(canMesh(helical('left'), helical('right'))).toBe(true);
  });

  it("'right' 同士・'left' 同士 → 偽", () => {
    expect(canMesh(helical('right'), helical('right'))).toBe(false);
    expect(canMesh(helical('left'), helical('left'))).toBe(false);
  });

  it('ハスバと平歯車 → 偽（どちらの順でも）', () => {
    expect(canMesh(helical('right'), spur())).toBe(false);
    expect(canMesh(spur(), helical('left'))).toBe(false);
  });

  it('大きさ違い → 偽', () => {
    expect(canMesh(helical('right', 'M'), helical('left', 'S'))).toBe(false);
    expect(canMesh(spur('M'), spur('L'))).toBe(false);
  });

  it('平歯車同士（同じ大きさ）→ 真（段階 1 と同じ）', () => {
    expect(canMesh(spur(), spur())).toBe(true);
  });

  it('三角形: 中・20 歯のハスバ 3 枚は、互いにかみ合う組み合わせが無い（ねじれの向きが 2 種類しかない）', () => {
    const hands: Hand[] = ['right', 'left'];
    for (const h1 of hands) {
      for (const h2 of hands) {
        for (const h3 of hands) {
          const [a, b, c] = [helical(h1, 'M', 'a'), helical(h2, 'M', 'b'), helical(h3, 'M', 'c')];
          const all = canMesh(a, b) && canMesh(b, c) && canMesh(a, c);
          expect(all).toBe(false);
        }
      }
    }
  });
});

describe('meshKindOf', () => {
  it('平歯車は spur、ハスバ歯車は helical', () => {
    const shapes: Array<[GearShape, string]> = [
      [{ kind: 'spur' }, 'spur'],
      [{ kind: 'helical', hand: 'right' }, 'helical'],
      [{ kind: 'helical', hand: 'left' }, 'helical'],
    ];
    for (const [shape, kind] of shapes) expect(meshKindOf(shape)).toBe(kind);
  });
});
