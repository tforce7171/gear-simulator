import { describe, expect, it } from 'vitest';
import { nullSpace, rank } from './linalg';

function multiply(a: number[][], x: number[]): number[] {
  return a.map((row) => row.reduce((sum, v, j) => sum + v * (x[j] ?? 0), 0));
}

function column(m: number[][], j: number): number[] {
  return m.map((row) => row[j] ?? Number.NaN);
}

describe('nullSpace', () => {
  it('[[1, 1]] → 1 列で (1, −1) に比例', () => {
    const n = nullSpace([[1, 1]], 2);
    expect(n).toHaveLength(2);
    expect(n.every((row) => row.length === 1)).toBe(true);
    const [x, y] = column(n, 0);
    expect(x).not.toBe(0);
    expect((y ?? 0) / (x ?? 1)).toBeCloseTo(-1, 12);
  });

  it('[[1, 0], [0, 1]] → 0 列', () => {
    const n = nullSpace(
      [
        [1, 0],
        [0, 1],
      ],
      2,
    );
    expect(n).toEqual([[], []]);
  });

  it('行が 0 本で 3 列 → 3 列で階数 3', () => {
    const n = nullSpace([], 3);
    expect(n).toHaveLength(3);
    expect(n.every((row) => row.length === 3)).toBe(true);
    expect(rank(n, 3)).toBe(3);
  });

  it('[[12, 24], [24, 12]] → 0 列、[[12, 24], [12, 24]] → 1 列', () => {
    const independent = nullSpace(
      [
        [12, 24],
        [24, 12],
      ],
      2,
    );
    expect(independent.every((row) => row.length === 0)).toBe(true);
    const a = [
      [12, 24],
      [12, 24],
    ];
    const dependent = nullSpace(a, 2);
    expect(dependent.every((row) => row.length === 1)).toBe(true);
    for (const v of multiply(a, column(dependent, 0))) expect(v).toBeCloseTo(0, 12);
  });

  it('基底の各列は a·x = 0 を満たす', () => {
    const a = [
      [12, 24, 0, 0],
      [0, 12, 36, 0],
    ];
    const n = nullSpace(a, 4);
    expect(n[0]).toHaveLength(2);
    for (let j = 0; j < 2; j++) {
      for (const v of multiply(a, column(n, j))) expect(v).toBeCloseTo(0, 12);
    }
  });
});

describe('rank', () => {
  it('行が 0 本なら 0、零行列なら 0', () => {
    expect(rank([], 3)).toBe(0);
    expect(rank([[0, 0]], 2)).toBe(0);
  });

  it('奇数の閉路は階数が満ち、偶数の閉路は 1 落ちる', () => {
    expect(
      rank(
        [
          [12, 12, 0],
          [0, 12, 12],
          [12, 0, 12],
        ],
        3,
      ),
    ).toBe(3);
    expect(
      rank(
        [
          [12, 12, 0, 0],
          [0, 12, 12, 0],
          [0, 0, 12, 12],
          [12, 0, 0, 12],
        ],
        4,
      ),
    ).toBe(3);
  });
});
