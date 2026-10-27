import { describe, expect, it } from 'vitest';
import { add, cross, dot, length, scale, sub } from './vec3';

describe('vec3', () => {
  it('足し算・引き算・スカラー倍', () => {
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(sub([1, 2, 3], [4, 5, 6])).toEqual([-3, -3, -3]);
    expect(scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
  });

  it('内積・外積・長さ', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(cross([0, 1, 0], [0, 0, 1])).toEqual([1, 0, 0]);
    expect(length([3, 4, 12])).toBe(13);
  });
});
