import { assertNever } from '../scene/gear-shape';
import type { Gear, GearShape } from '../scene/types';

// かみ合える歯車の組（S2-01。design.md §5）。位置は見ず、種類・大きさ・形を変える属性だけで決める

// かみ合いの種類。S2-04 以降で足す
export type MeshKind = 'spur' | 'helical' | 'bevel' | 'worm';

// かみ合う 2 軸の位置関係（S2-03）。平行（外周の mesh の配置）、交わる 90°（bevel）、ねじれた位置の 90°（skew）。
// 種類ごとに 1 つに決まり、かみ合える組は同じ位置関係を持つ
export type MeshGeometry = 'parallel' | 'bevel' | 'skew';

export function meshGeometryOf(gear: GearShape): MeshGeometry {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
      return 'parallel';
    case 'bevel':
      return 'bevel';
    case 'worm':
    case 'wormWheel':
      return 'skew';
    default:
      return assertNever(gear);
  }
}

// その位置関係の木の親子の配置の種類（ShaftPlacement['kind']）
export function placementKindOf(geometry: MeshGeometry): 'mesh' | 'bevel' | 'skew' {
  return geometry === 'parallel' ? 'mesh' : geometry;
}

// 平歯車同士、ねじれの向きが逆のハスバ歯車同士、同じ歯数のかさ歯車同士（どれも同じ大きさ）だけがかみ合う。
// かさ歯車は歯数比 1:1 のみ（S2-02）なので、歯数もそろっている必要がある。
// ウォームとかみ合えるのはホイールだけ、ホイールとかみ合えるのはウォームだけ（S2-03）
export function canMesh(a: Gear, b: Gear): boolean {
  if (a.size !== b.size) return false;
  switch (a.kind) {
    case 'spur':
      return b.kind === 'spur';
    case 'helical':
      return b.kind === 'helical' && b.hand !== a.hand;
    case 'bevel':
      return b.kind === 'bevel' && b.teeth === a.teeth;
    case 'worm':
      return b.kind === 'wormWheel';
    case 'wormWheel':
      return b.kind === 'worm';
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
    case 'bevel':
      return 'bevel';
    case 'worm':
    case 'wormWheel':
      return 'worm';
    default:
      return assertNever(gear);
  }
}
