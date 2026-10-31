import { COLLISION_EPS, GEAR_SIZES } from '../constants';
import { outsideRadius } from '../geometry/mesh';
import { axisFrame } from '../math/axis';
import { cross, dot, length, sub, type Vec3 } from '../math/vec3';
import type { Axis, GearId, ShaftId, SizeKey } from '../scene/types';

// 干渉判定（要件 §6、design.md §5）。歯車を円柱、シャフトを線分で近似する。
// 触れているだけは干渉としない（重なりの深さが COLLISION_EPS 以下なら干渉なし）。
// モーターは段階 1 では判定しない。

export type Collider =
  | {
      kind: 'cylinder';
      id: GearId;
      shaftId: ShaftId;
      center: Vec3;
      axis: Axis;
      radius: number; // 歯先円半径
      halfWidth: number; // 歯幅 / 2
    }
  // 中空の円柱（S3-02 の内歯車のリングとつなぎの筒）。内側の半径より内は空洞として扱う
  | {
      kind: 'hollow';
      id: GearId;
      shaftId: ShaftId;
      center: Vec3;
      axis: Axis;
      innerRadius: number; // 内歯車の歯先円（R − m）
      radius: number; // 外側の半径（リムの外側 R + 3.25m）
      halfWidth: number;
    }
  | { kind: 'segment'; id: ShaftId; start: Vec3; end: Vec3 };

type Cylinder = Extract<Collider, { kind: 'cylinder' }>;
type Hollow = Extract<Collider, { kind: 'hollow' }>;
type Segment = Extract<Collider, { kind: 'segment' }>;

type Index = 0 | 1 | 2;
const AXIS_INDEX: Readonly<Record<Axis, Index>> = { x: 0, y: 1, z: 2 };
// 直交する 2 軸の添字から残りの軸の添字（同じ軸の組は使わない）
const REMAINING_AXIS: readonly [
  readonly [Index, Index, Index],
  readonly [Index, Index, Index],
  readonly [Index, Index, Index],
] = [
  [0, 2, 1],
  [2, 1, 0],
  [1, 0, 2],
];

// 歯車の円柱（歯先円 × 厚さ width。width は省けば大きさごとの歯幅。S4-05）
export function gearCollider(
  id: GearId,
  shaftId: ShaftId,
  center: Vec3,
  axis: Axis,
  size: SizeKey,
  teeth: number,
  width: number = GEAR_SIZES[size].faceWidth,
): Collider {
  return {
    kind: 'cylinder',
    id,
    shaftId,
    center,
    axis,
    radius: outsideRadius(size, teeth),
    halfWidth: width / 2,
  };
}

export function collides(a: Collider, b: Collider): boolean {
  if (a.kind === 'hollow') return hollowAny(a, b);
  if (b.kind === 'hollow') return hollowAny(b, a);
  if (a.kind === 'cylinder') {
    return b.kind === 'cylinder' ? cylinderCylinder(a, b) : segmentCylinder(b, a);
  }
  return b.kind === 'cylinder' ? segmentCylinder(a, b) : segmentSegment(a, b);
}

// 中空の円柱を外側の円柱（空洞を無視した、中の詰まった円柱）として見たもの
function solidOf(h: Hollow): Cylinder {
  return {
    kind: 'cylinder',
    id: h.id,
    shaftId: h.shaftId,
    center: h.center,
    axis: h.axis,
    radius: h.radius,
    halfWidth: h.halfWidth,
  };
}

// 中空の円柱と、ほかの部品（S3-02）。軸が平行な部品だけ空洞を考える:
// 円柱（半径 ρ、軸からの距離 d）は d + ρ ≤ 内側の半径なら空洞に収まり、d − ρ ≥ 外側の半径なら外にあって干渉しない。
// 線分は、軸に平行で、軸からの距離が内側の半径以下なら空洞を通るので干渉しない。
// 平行でない部品は、空洞を無視して外側の円柱として扱う（安全側に倒す）
function hollowAny(h: Hollow, other: Collider): boolean {
  const solid = solidOf(h);
  const ia = AXIS_INDEX[h.axis];
  if (other.kind === 'segment') {
    const dir = sub(other.end, other.start);
    const along = Math.abs(dir[ia]);
    const parallel = length(dir) - along <= 1e-12 * Math.max(1, along);
    if (parallel && radialDistance(h, other.start) <= h.innerRadius + COLLISION_EPS) return false;
    return segmentCylinder(other, solid);
  }
  const otherAxis = AXIS_INDEX[other.axis];
  if (otherAxis !== ia) {
    return other.kind === 'cylinder'
      ? cylinderCylinder(solid, other)
      : cylinderCylinder(solid, solidOf(other));
  }
  // 平行: 軸方向の区間の重なり
  const axialOverlap = h.halfWidth + other.halfWidth - Math.abs(h.center[ia] - other.center[ia]);
  if (axialOverlap <= COLLISION_EPS) return false;
  const d = radialDistance(h, other.center);
  if (other.kind === 'cylinder') {
    if (d + other.radius <= h.innerRadius + COLLISION_EPS) return false; // 空洞に収まる
    return d - other.radius < h.radius - COLLISION_EPS;
  }
  // 中空同士: どちらかがもう一方の空洞に収まるか、外側どうしが離れていれば干渉しない
  if (d + other.radius <= h.innerRadius + COLLISION_EPS) return false;
  if (d + h.radius <= other.innerRadius + COLLISION_EPS) return false;
  return d < h.radius + other.radius - COLLISION_EPS;
}

// 点から、中空の円柱の軸までの距離
function radialDistance(h: Hollow, p: Vec3): number {
  const ia = AXIS_INDEX[h.axis];
  const d = sub(p, h.center);
  return Math.sqrt(Math.max(0, dot(d, d) - d[ia] * d[ia]));
}

// 全ての組を調べる。exempt の組（順序は問わない）と、歯車とそれが載ったシャフトの組は除く。
// 組の中は [小さい ID, 大きい ID]、一覧も辞書順（符号単位の比較）。重複なし。
// 粗い絞り込みとして、x の区間で並べ（sweep and prune）、軸に平行な箱が重なる組だけを詳しく調べる
export function findInterferences(
  colliders: readonly Collider[],
  exempt: ReadonlyArray<readonly [string, string]>,
): Array<[string, string]> {
  const exemptKeys = new Set<string>();
  for (const [a, b] of exempt) exemptKeys.add(pairKey(a, b));

  const boxes = colliders.map(boundingBox);
  const order = colliders
    .map((_, i) => i)
    .sort((i, j) => boxMin(boxes, i, 0) - boxMin(boxes, j, 0));

  const found = new Map<string, [string, string]>();
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi] ?? 0;
    const a = colliders[i];
    const boxA = boxes[i];
    if (a === undefined || boxA === undefined) continue;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj] ?? 0;
      const b = colliders[j];
      const boxB = boxes[j];
      if (b === undefined || boxB === undefined) continue;
      // x の最小で並べているので、b の x の最小が a の x の最大を超えたら、以降は重ならない
      if (boxB.min[0] > boxA.max[0]) break;
      if (!boxesOverlap(boxA, boxB) || a.id === b.id) continue;
      if (onOwnShaft(a, b) || onOwnShaft(b, a)) continue;
      const key = pairKey(a.id, b.id);
      if (exemptKeys.has(key) || found.has(key)) continue;
      if (!collides(a, b)) continue;
      found.set(key, a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
    }
  }
  return [...found.values()].sort((p, q) => compare(p[0], q[0]) || compare(p[1], q[1]));
}

// subject と others の各部品の組のうち、干渉するものの相手の ID（others の順）。
// findInterferences と同じ判定（外接箱の絞り込み、同じ ID と歯車とそれが載ったシャフトの組を除く）を、1 つの部品について行う。
// skip が真の相手は調べない（かみ合う組など）
export function interferingWith(
  subject: Collider,
  others: readonly Collider[],
  skip: (other: Collider) => boolean,
): string[] {
  const box = boundingBox(subject);
  const hits: string[] = [];
  for (const other of others) {
    if (other.id === subject.id || onOwnShaft(subject, other) || onOwnShaft(other, subject))
      continue;
    if (skip(other) || !boxesOverlap(box, boundingBox(other))) continue;
    if (collides(subject, other)) hits.push(other.id);
  }
  return hits;
}

interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

// 軸に平行な外接箱（閉じた箱。触れているだけの組も残し、詳しい判定に回す）
function boundingBox(c: Collider): Box {
  if (c.kind === 'segment') {
    return {
      min: [
        Math.min(c.start[0], c.end[0]),
        Math.min(c.start[1], c.end[1]),
        Math.min(c.start[2], c.end[2]),
      ],
      max: [
        Math.max(c.start[0], c.end[0]),
        Math.max(c.start[1], c.end[1]),
        Math.max(c.start[2], c.end[2]),
      ],
    };
  }
  const ia = AXIS_INDEX[c.axis];
  const half = (k: Index): number => (k === ia ? c.halfWidth : c.radius);
  return {
    min: [c.center[0] - half(0), c.center[1] - half(1), c.center[2] - half(2)],
    max: [c.center[0] + half(0), c.center[1] + half(1), c.center[2] + half(2)],
  };
}

function boxMin(boxes: readonly Box[], i: number, k: Index): number {
  return boxes[i]?.min[k] ?? 0;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.min[0] <= b.max[0] &&
    b.min[0] <= a.max[0] &&
    a.min[1] <= b.max[1] &&
    b.min[1] <= a.max[1] &&
    a.min[2] <= b.max[2] &&
    b.min[2] <= a.max[2]
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pairKey(a: string, b: string): string {
  // ID に含まれない区切り（NUL）でつなぐ
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function onOwnShaft(gear: Collider, shaft: Collider): boolean {
  return gear.kind !== 'segment' && shaft.kind === 'segment' && gear.shaftId === shaft.id;
}

// 点 x から閉区間 [lo, hi] までの距離（内側なら 0）
function distanceToInterval(x: number, lo: number, hi: number): number {
  return x < lo ? lo - x : x > hi ? x - hi : 0;
}

function cylinderCylinder(p: Cylinder, q: Cylinder): boolean {
  const ia = AXIS_INDEX[p.axis];
  const ib = AXIS_INDEX[q.axis];
  if (ia === ib) {
    // 平行: 軸方向の区間の重なり、軸に垂直な方向の中心間の距離
    const axialOverlap = p.halfWidth + q.halfWidth - Math.abs(p.center[ia] - q.center[ia]);
    if (axialOverlap <= COLLISION_EPS) return false;
    const d = sub(p.center, q.center);
    const radial = Math.sqrt(Math.max(0, dot(d, d) - d[ia] * d[ia]));
    return radial < p.radius + q.radius - COLLISION_EPS;
  }
  // 直交: a = P の軸、b = Q の軸、c = 残りの軸。
  // 共通部分を c 座標ごとに見ると、P と Q それぞれで c が取れる範囲は閉区間になり、
  // その 2 つの区間が重なるときに限り共通部分がある（正確な判定）
  const ic = REMAINING_AXIS[ia][ib];
  const pa = p.center[ia];
  const qb = q.center[ib];
  const dA = distanceToInterval(q.center[ia], pa - p.halfWidth, pa + p.halfWidth);
  const dB = distanceToInterval(p.center[ib], qb - q.halfWidth, qb + q.halfWidth);
  // 境界から COLLISION_EPS より深く入り込めないなら、触れているだけ
  if (q.radius - dA <= COLLISION_EPS || p.radius - dB <= COLLISION_EPS) return false;
  const halfQ = Math.sqrt(q.radius * q.radius - dA * dA);
  const halfP = Math.sqrt(p.radius * p.radius - dB * dB);
  return Math.abs(p.center[ic] - q.center[ic]) < halfQ + halfP - COLLISION_EPS;
}

// 線分の一部が、円柱を COLLISION_EPS だけ内側に縮めたものの内部に入るか
function segmentCylinder(s: Segment, c: Cylinder): boolean {
  const radius = c.radius - COLLISION_EPS;
  const half = c.halfWidth - COLLISION_EPS;
  if (radius <= 0 || half <= 0) return false;
  const ia = AXIS_INDEX[c.axis];
  const rel = sub(s.start, c.center);
  const dir = sub(s.end, s.start);

  // 線分のパラメータ t ∈ [0, 1] のうち、条件を満たす開区間を狭めていく
  let lo = 0;
  let hi = 1;

  // 軸方向: |rel_a + t·dir_a| < half
  const t0 = rel[ia];
  const dt = dir[ia];
  if (dt === 0) {
    if (Math.abs(t0) >= half) return false;
  } else {
    const t1 = (-half - t0) / dt;
    const t2 = (half - t0) / dt;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  if (lo >= hi) return false;

  // 軸に垂直な方向: |w0 + t·dw|² < radius²
  const { u, v } = axisFrame(c.axis);
  const w0: readonly [number, number] = [dot(rel, u), dot(rel, v)];
  const dw: readonly [number, number] = [dot(dir, u), dot(dir, v)];
  const qa = dw[0] * dw[0] + dw[1] * dw[1];
  const qb = 2 * (w0[0] * dw[0] + w0[1] * dw[1]);
  const qc = w0[0] * w0[0] + w0[1] * w0[1] - radius * radius;
  if (qa === 0) return qc < 0;
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= 0) return false;
  const root = Math.sqrt(disc);
  lo = Math.max(lo, (-qb - root) / (2 * qa));
  hi = Math.min(hi, (-qb + root) / (2 * qa));
  return lo < hi;
}

function segmentSegment(a: Segment, b: Segment): boolean {
  const d1 = sub(a.end, a.start);
  const d2 = sub(b.end, b.start);
  const len1 = length(d1);
  const len2 = length(d2);
  // 長さ 0 の線分（点）は干渉の対象にしない
  if (len1 <= COLLISION_EPS || len2 <= COLLISION_EPS) return false;
  const r = sub(b.start, a.start);
  const n = cross(d1, d2);

  if (length(n) <= 1e-12 * len1 * len2) {
    // 平行: 同じ直線の上にあって、重なりの長さが COLLISION_EPS より大きい
    if (length(cross(r, d1)) / len1 >= COLLISION_EPS) return false;
    const u1 = dot(r, d1) / len1;
    const u2 = dot(sub(b.end, a.start), d1) / len1;
    const overlap = Math.min(len1, Math.max(u1, u2)) - Math.max(0, Math.min(u1, u2));
    return overlap > COLLISION_EPS;
  }

  // 平行でない: 2 直線の最近点が、両方の線分の内側（端点から COLLISION_EPS より離れた点）にあり、
  // 距離が COLLISION_EPS 未満
  const nn = dot(n, n);
  const s = dot(cross(r, d2), n) / nn;
  const t = dot(cross(r, d1), n) / nn;
  const margin1 = COLLISION_EPS / len1;
  const margin2 = COLLISION_EPS / len2;
  if (s <= margin1 || s >= 1 - margin1 || t <= margin2 || t >= 1 - margin2) return false;
  return Math.abs(dot(r, n)) / Math.sqrt(nn) < COLLISION_EPS;
}
