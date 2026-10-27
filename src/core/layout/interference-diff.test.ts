import { describe, expect, it } from 'vitest';
import { newInterferences } from './interference-diff';
import type { Layout } from './types';

function layoutWith(interferences: Array<[string, string]>): Layout {
  return { shafts: {}, gears: {}, meshes: [], interferences };
}

describe('newInterferences', () => {
  it('before に [a, b]、after に [b, a] と [c, d] → [[c, d]] だけ', () => {
    const before = layoutWith([['a', 'b']]);
    const after = layoutWith([
      ['b', 'a'],
      ['c', 'd'],
    ]);
    expect(newInterferences(before, after)).toEqual([['c', 'd']]);
  });

  it('同じなら空、after が空でも空', () => {
    const before = layoutWith([['a', 'b']]);
    expect(newInterferences(before, layoutWith([['a', 'b']]))).toEqual([]);
    expect(newInterferences(before, layoutWith([]))).toEqual([]);
  });
});
