import { GEAR_SIZES } from '../constants';
import { toothPitchAngle } from '../geometry/mesh';
import { type ToothArc, toothArcOf } from '../geometry/partial-gear';
import { wrapCentered } from '../geometry/rack';
import type { Layout } from '../layout/types';
import { axisFrame, axisVector } from '../math/axis';
import { dot, scale, sub, type Vec3 } from '../math/vec3';
import type { Axis, Gear, GearId, RackId, Scene, ShaftId, SpurGear } from '../scene/types';
import { rackSign } from './mesh-coefficients';

// 欠け歯車のかみ合いの入り切り（S5-05。design.md §6「かみ合いの入り切り」）。
// 欠け歯車を含むかみ合いは、欠け歯車の今の角度で、歯のある弧が接点に来ているときだけかかる。
// 歯車の局所の角度 ψ = 接点の向き − 歯車の回転角（basePhase + シャフトの回転角）で、歯 j の中心は ψ = j·p（p = 2π/z）。
// 歯のある弧は ψ ∈ [(start − 1/2)·p, (start + count − 1/2)·p]（両端を含む）。1 回転で count 歯ぶんだけ相手を送る

// 弧の端にいるとみなす角度の許容（rad）。入る・外れる瞬間で区切ったあとの角度の丸めの誤差を吸収する
export const ENGAGE_EDGE_EPS = 1e-7;
// かみ合い直すときの位相のずれの許容（歯 1 ピッチに対する比）。これより大きくずれていれば 'toothClash'
export const TOOTH_CLASH_EPS = 1e-3;

const TAU = 2 * Math.PI;

function wrapTau(x: number): number {
  const r = x - Math.floor(x / TAU) * TAU;
  return r >= TAU ? r - TAU : r;
}

// 歯のある弧の始まりの端（ψ）と幅
function arcEdges(arc: ToothArc, teeth: number): { start: number; span: number } {
  const p = toothPitchAngle(teeth);
  return { start: (arc.start - 0.5) * p, span: arc.count * p };
}

// 欠け歯車の回転角 rotation（basePhase + シャフトの回転角）と、接点の向き contactAngle（歯車の軸まわりの角度）から、
// 歯のある弧が接点にあるか（両端を含む）。普通の平歯車は常に真
export function isEngaged(gear: SpurGear, rotation: number, contactAngle: number): boolean {
  const arc = toothArcOf(gear, gear.teeth);
  if (arc === null) return true;
  const { start, span } = arcEdges(arc, gear.teeth);
  const d = wrapTau(contactAngle - rotation - start);
  return d <= span + ENGAGE_EDGE_EPS || d >= TAU - ENGAGE_EDGE_EPS;
}

// かみ合いの片側の欠け歯車
export interface GateSide {
  readonly gearId: GearId;
  readonly shaftId: ShaftId;
  readonly teeth: number;
  readonly basePhase: number;
  readonly contactAngle: number; // 接点の向き（歯車の軸まわりの角度）
  readonly start: number; // 歯のある弧の始まりの端（ψ）
  readonly span: number; // 弧の幅（rad）
}

// 欠け歯車を含むかみ合い 1 組
export interface Gate {
  readonly kind: 'mesh' | 'rack'; // Layout.meshes か Layout.rackMeshes か
  readonly index: number; // その配列の添字
  readonly sides: readonly GateSide[]; // 欠け歯車の側（1 つか 2 つ）
  readonly body: ShaftId; // かみ合う片方のシャフト（連結成分を引くのに使う）
  // 位相のずれ（ピッチに対する比、[−1/2, 1/2)）。0 なら歯が谷に入る。確かめない組（内歯車など）は null
  readonly residual:
    | ((
        angles: Readonly<Record<ShaftId, number>>,
        racks: Readonly<Record<RackId, number>>,
      ) => number)
    | null;
}

export type SideStatus = 'in' | 'out' | 'atStart' | 'atEnd';

// 欠け歯車のシャフトの角度での、弧に対する接点の位置
export function sideStatus(side: GateSide, shaftAngle: number): SideStatus {
  const d = wrapTau(side.contactAngle - side.basePhase - shaftAngle - side.start);
  if (d < ENGAGE_EDGE_EPS || d > TAU - ENGAGE_EDGE_EPS) return 'atStart';
  if (Math.abs(d - side.span) < ENGAGE_EDGE_EPS) return 'atEnd';
  return d < side.span ? 'in' : 'out';
}

// 端にいる側が、シャフトの角速度 omega で弧の外へ向かうか（ψ̇ = −ω。始まりの端では ψ が減る向き、終わりの端では増える向き）
export function leavingArc(status: SideStatus, omega: number): boolean {
  if (status === 'atStart') return omega > 0;
  if (status === 'atEnd') return omega < 0;
  return false;
}

// シャフトの角度が from から to へ線形に動く間に、側が弧の端をまたぐ最初の割合（0 < t ≤ 1）。またがなければ null。
// 今いる端（ENGAGE_EDGE_EPS 以内）は、またいだものとして数えない
export function sideCrossing(side: GateSide, from: number, to: number): number | null {
  const delta = -(to - from); // ψ の変化
  if (delta === 0) return null;
  const psi0 = side.contactAngle - side.basePhase - from;
  let best: number | null = null;
  for (const edge of [side.start, side.start + side.span]) {
    let d = delta > 0 ? wrapTau(edge - psi0) : wrapTau(psi0 - edge);
    if (d < ENGAGE_EDGE_EPS || d > TAU - ENGAGE_EDGE_EPS) d += TAU;
    const t = d / Math.abs(delta);
    if (t <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

// ベクトル p の、軸 axis まわりの角度
function angleAround(axis: Axis, p: Vec3): number {
  const { u, v } = axisFrame(axis);
  return Math.atan2(dot(p, v), dot(p, u));
}

function sideOf(gear: Gear, layout: Layout, contactAngle: number): GateSide | null {
  const arc = toothArcOf(gear, gear.teeth);
  const placed = layout.gears[gear.id];
  if (arc === null || placed === undefined) return null;
  const { start, span } = arcEdges(arc, gear.teeth);
  return {
    gearId: gear.id,
    shaftId: gear.shaftId,
    teeth: gear.teeth,
    basePhase: placed.basePhase,
    contactAngle,
    start,
    span,
  };
}

// 歯の並びの中での接点の位置（ピッチに対する比）。0 なら歯の中心が接点にある
function toothFraction(
  contactAngle: number,
  basePhase: number,
  shaftAngle: number,
  teeth: number,
): number {
  return (contactAngle - basePhase - shaftAngle) / toothPitchAngle(teeth);
}

function buildGates(scene: Scene, layout: Layout): Gate[] {
  const gates: Gate[] = [];
  layout.meshes.forEach((mesh, index) => {
    // 遊星のかみ合い（接点の向きが公転で変わる）は、欠け歯車でも常にかかるものとして扱う
    if (mesh.carrierShaftId !== undefined) return;
    const a = scene.gears[mesh.a];
    const b = scene.gears[mesh.b];
    const la = layout.gears[mesh.a];
    const lb = layout.gears[mesh.b];
    if (a === undefined || b === undefined || la === undefined || lb === undefined) return;
    if (toothArcOf(a, a.teeth) === null && toothArcOf(b, b.teeth) === null) return;
    // 接点の向き: 外歯車どうしは相手の中心の向き。内歯車の組は、外歯車から見て内歯車の中心と反対の向き
    // （内歯車の側は欠け歯車にならないので、外歯車の側の向きだけが意味を持つ）
    const ab = sub(lb.center, la.center);
    const internal = mesh.kind === 'internal';
    const betaA = angleAround(la.axis, internal ? scale(ab, -1) : ab);
    const betaB = angleAround(lb.axis, internal ? ab : scale(ab, -1));
    const sides = [sideOf(a, layout, betaA), sideOf(b, layout, betaB)].filter(
      (s): s is GateSide => s !== null,
    );
    const residual =
      mesh.kind === 'spur' && a.kind === 'spur' && b.kind === 'spur'
        ? (angles: Readonly<Record<ShaftId, number>>) =>
            wrapCentered(
              toothFraction(betaA, la.basePhase, angles[a.shaftId] ?? 0, a.teeth) +
                toothFraction(betaB, lb.basePhase, angles[b.shaftId] ?? 0, b.teeth) -
                0.5,
              1,
            )
        : null;
    gates.push({ kind: 'mesh', index, sides, body: a.shaftId, residual });
  });
  layout.rackMeshes.forEach((rm, index) => {
    const gear = scene.gears[rm.gear];
    const rack = scene.racks[rm.rack];
    const lg = layout.gears[rm.gear];
    const lr = layout.racks[rm.rack];
    if (gear === undefined || rack === undefined || lg === undefined || lr === undefined) return;
    // 接点の向き u = −normalSign·normal
    const beta = angleAround(lg.axis, scale(axisVector(lr.normal), -lr.normalSign));
    const side = sideOf(gear, layout, beta);
    if (side === null) return;
    const k = rackSign(lg.axis, lr);
    const pitch = Math.PI * GEAR_SIZES[rack.size].module;
    // ピニオンの歯の中心が接点にある（f_g = 0）とき、ラックの歯溝の中心が接点にある（f_r = 0）。
    // 回してもかみ合ったままなら f_g − k·f_r は変わらない
    const residual = (
      angles: Readonly<Record<ShaftId, number>>,
      racks: Readonly<Record<RackId, number>>,
    ): number => {
      const fg = toothFraction(beta, lg.basePhase, angles[gear.shaftId] ?? 0, gear.teeth);
      const fr = (rm.position - lr.grooveOffset - (racks[rack.id] ?? 0)) / pitch;
      return wrapCentered(fg - k * fr, 1);
    };
    gates.push({ kind: 'rack', index, sides: [side], body: gear.shaftId, residual });
  });
  return gates;
}

const gateCache = new WeakMap<Layout, { scene: Scene; gates: readonly Gate[] }>();

// 欠け歯車を含むかみ合いの一覧（Layout.meshes の順、続けて Layout.rackMeshes の順）。Layout の参照ごとに覚える。
// 欠け歯車のないシーンでは空
export function gatesOf(scene: Scene, layout: Layout): readonly Gate[] {
  const cached = gateCache.get(layout);
  if (cached !== undefined && cached.scene === scene) return cached.gates;
  const gates = buildGates(scene, layout);
  gateCache.set(layout, { scene, gates });
  return gates;
}

// 両端を含む判定で、今の角度でかかっているか（gatesOf の順）
export function engagedAt(
  gates: readonly Gate[],
  angles: Readonly<Record<ShaftId, number>>,
): boolean[] {
  return gates.map((gate) =>
    gate.sides.every((side) => sideStatus(side, angles[side.shaftId] ?? 0) !== 'out'),
  );
}

// かかっているかみ合いだけの Layout.meshes・Layout.rackMeshes の添字の集合（engaged が null なら全部）
export interface EngagementMasks {
  readonly meshes: readonly boolean[]; // Layout.meshes の添字ごと（無い添字はかかっている）
  readonly rackMeshes: readonly boolean[]; // Layout.rackMeshes の添字ごと（同じ）
}

// 添字の無い組は「かかっている」とみなす（masks.meshes[i] !== false で読む）
const ALL_ENGAGED: EngagementMasks = { meshes: [], rackMeshes: [] };

export function engagementMasks(
  layout: Layout,
  gates: readonly Gate[],
  engaged: readonly boolean[],
): EngagementMasks {
  const meshes = layout.meshes.map(() => true);
  const rackMeshes = layout.rackMeshes.map(() => true);
  gates.forEach((gate, i) => {
    if (engaged[i] === true) return;
    if (gate.kind === 'mesh') meshes[gate.index] = false;
    else rackMeshes[gate.index] = false;
  });
  return { meshes, rackMeshes };
}

// 今の運動の状態で、Layout.meshes・Layout.rackMeshes の組がかかっているか（音・情報表示に使う。両端を含む）
export function currentEngagement(
  scene: Scene,
  layout: Layout,
  angles: Readonly<Record<ShaftId, number>>,
): EngagementMasks {
  const gates = gatesOf(scene, layout);
  // 欠け歯車のないシーンは毎フレーム配列を作らない（空の配列は「全部かかっている」と同じ意味）
  if (gates.length === 0) return ALL_ENGAGED;
  return engagementMasks(layout, gates, engagedAt(gates, angles));
}
