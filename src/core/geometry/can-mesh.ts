import { assertNever } from '../scene/gear-shape';
import type { Gear, GearShape } from '../scene/types';

// かみ合える歯車の組（S2-01。design.md §5）。位置は見ず、種類・大きさ・形を変える属性だけで決める

// かみ合いの種類。S2-02 以降で足す
export type MeshKind = 'spur' | 'helical';

// 平歯車同士、ねじれの向きが逆のハスバ歯車同士（どちらも同じ大きさ）だけがかみ合う
export function canMesh(a: Gear, b: Gear): boolean {
  if (a.size !== b.size) return false;
  switch (a.kind) {
    case 'spur':
      return b.kind === 'spur';
    case 'helical':
      return b.kind === 'helical' && b.hand !== a.hand;
    default:
      return assertNever(a);
  }
}

// かみ合える組（canMesh が真）のかみ合いの種類。組のどちらの歯車から求めても同じ
export function meshKindOf(gear: GearShape): MeshKind {
  switch (gear.kind) {
    case 'spur':
      return 'spur';
    case 'helical':
      return 'helical';
    default:
      return assertNever(gear);
  }
}
