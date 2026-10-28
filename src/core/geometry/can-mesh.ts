import { INTERNAL_MIN_TOOTH_DIFF } from '../constants';
import { assertNever } from '../scene/gear-shape';
import type { Gear, GearShape } from '../scene/types';

// かみ合える歯車の組（S2-01。design.md §5）。位置は見ず、種類・大きさ・形を変える属性だけで決める

// かみ合いの種類。'internal' は内歯車と平歯車の組（S3-02）
export type MeshKind = 'spur' | 'helical' | 'bevel' | 'worm' | 'crossedHelical' | 'internal';

// かみ合う 2 軸の位置関係（S2-03）。平行（外周の mesh の配置）、交わる 90°（bevel）、ねじれた位置の 90°（skew）。
// 種類ごとに 1 つに決まり、かみ合える組は同じ位置関係を持つ
export type MeshGeometry = 'parallel' | 'bevel' | 'skew';

export function meshGeometryOf(gear: GearShape): MeshGeometry {
  switch (gear.kind) {
    case 'spur':
    case 'helical':
    case 'internal':
      return 'parallel';
    case 'bevel':
      return 'bevel';
    case 'worm':
    case 'wormWheel':
    case 'crossedHelical':
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
// ウォームとかみ合えるのはホイールだけ、ホイールとかみ合えるのはウォームだけ（S2-03）。
// ねじ歯車はねじ歯車とだけ（S2-04。どれも右ねじれ 45° なので向きは見ない。歯数は自由）。
// 内歯車は平歯車とだけ、歯数差（内歯車 − 平歯車）が INTERNAL_MIN_TOOTH_DIFF 以上のとき（S3-02。内歯車同士はかみ合わない）
export function canMesh(a: Gear, b: Gear): boolean {
  if (a.size !== b.size) return false;
  switch (a.kind) {
    case 'spur':
      return b.kind === 'spur' || (b.kind === 'internal' && internalDiffOk(b.teeth, a.teeth));
    case 'internal':
      return b.kind === 'spur' && internalDiffOk(a.teeth, b.teeth);
    case 'helical':
      return b.kind === 'helical' && b.hand !== a.hand;
    case 'bevel':
      return b.kind === 'bevel' && b.teeth === a.teeth;
    case 'worm':
      return b.kind === 'wormWheel';
    case 'wormWheel':
      return b.kind === 'worm';
    case 'crossedHelical':
      return b.kind === 'crossedHelical';
    default:
      return assertNever(a);
  }
}

// 内歯車の歯数と外歯車の歯数の差が足りるか（内側での歯先の干渉を避ける。S3-02）
export function internalDiffOk(internalTeeth: number, externalTeeth: number): boolean {
  return internalTeeth - externalTeeth >= INTERNAL_MIN_TOOTH_DIFF;
}

// かみ合える組（canMesh が真）のかみ合いの種類。a と b を入れ替えても同じ。
// 内歯車を含む組は 'internal'（S3-02）、それ以外は組のどちらの形からも同じ種類になる
export function meshKindOf(a: GearShape, b: GearShape): MeshKind {
  if (a.kind === 'internal' || b.kind === 'internal') return 'internal';
  return singleMeshKind(a);
}

function singleMeshKind(gear: GearShape): MeshKind {
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
    case 'crossedHelical':
      return 'crossedHelical';
    case 'internal':
      return 'internal';
    default:
      return assertNever(gear);
  }
}
