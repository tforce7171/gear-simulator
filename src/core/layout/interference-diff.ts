import type { Layout } from './types';

// 編集の前後で新しく生まれた干渉（S1-17。ハンドルと起点を置くときの判定に使う）

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

// after にあって before に無い干渉の組（順序は問わない）。並びは after のまま
export function newInterferences(before: Layout, after: Layout): Array<[string, string]> {
  const existing = new Set(before.interferences.map(([a, b]) => pairKey(a, b)));
  const added: Array<[string, string]> = [];
  for (const [a, b] of after.interferences) {
    if (!existing.has(pairKey(a, b))) added.push([a, b]);
  }
  return added;
}
