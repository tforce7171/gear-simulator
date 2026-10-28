import { LOCK_OMEGA_EPS } from '../constants';
import type { Mesh } from '../layout/types';
import type { Scene, ShaftId } from '../scene/types';
import { type ShaftDrive, solveBalanceAffine } from './balance';
import type { KinematicComponent } from './graph';
import { type Matrix, multiply, multiplyVector, nullSpace, solveParticular } from './linalg';
import { meshCoefficients, meshTerms } from './mesh-coefficients';
import type { LockReason } from './types';

// ウォームのセルフロック（S2-03。design.md §6）。ウォームのかみ合いを一方通行の拘束として扱う:
// ウォーム側はホイール側の影響を受けず、ホイール側はウォームの動きに無限の強さで従う。
// 1. ウォームのかみ合いを除いたかみ合いでつながる部分を「区画」とする
// 2. ウォームのかみ合いを「ウォームの区画 → ホイールの区画」の有向辺とし、閉路に含まれる区画はまとめて 1 つにする
//    （その中のウォームのかみ合いは通常の双方向の拘束）
// 3. トポロジカル順に解く。入ってくる辺のない区画は段階 1 と同じ力のつり合い、入ってくる辺のある区画は、
//    上流で決まったウォームの ω から求まるホイールの ω を規定値（手で回すのと同じ無限に強い拘束）として加えて解く

const NO_DRIVE: ShaftDrive = { damping: 0, bias: 0 };

interface Constraint {
  readonly shaftA: ShaftId;
  readonly shaftB: ShaftId;
  readonly coefA: number;
  readonly coefB: number;
  readonly worm: 'a' | 'b' | null; // ウォームのかみ合いなら、ウォームの側
  // 拘束の行の項（遊星のかみ合いはキャリアのシャフトも。S3-03。ウォームのかみ合いは公転しない）
  readonly terms: ReadonlyArray<{ readonly shaftId: ShaftId; readonly coef: number }>;
}

export interface WormSection {
  readonly shaftIds: readonly ShaftId[]; // ID の昇順
  readonly incoming: boolean; // 上流のウォームから規定値を受けるか
}

export interface WormSections {
  readonly sections: readonly WormSection[]; // トポロジカル順
  readonly sectionOfShaft: ReadonlyMap<ShaftId, number>;
  readonly constraints: readonly Constraint[];
  // 固定具の拘束 ω = 0 を入れるシャフト（S3-01）。そのシャフトを含む区画の拘束の行として足す
  readonly anchoredShaftIds: ReadonlySet<ShaftId>;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function constraintOf(scene: Scene, mesh: Mesh): Constraint {
  const a = scene.gears[mesh.a];
  const b = scene.gears[mesh.b];
  if (a === undefined || b === undefined) {
    throw new Error(`かみ合いの歯車がシーンに無い: ${mesh.a}, ${mesh.b}`);
  }
  const { a: coefA, b: coefB } = meshCoefficients(mesh, scene);
  const worm = mesh.kind !== 'worm' ? null : a.kind === 'worm' ? 'a' : 'b';
  return {
    shaftA: a.shaftId,
    shaftB: b.shaftId,
    coefA,
    coefB,
    worm,
    terms: meshTerms(mesh, scene),
  };
}

// 成分の区画とトポロジカル順。ウォームのかみ合いが無ければ null（段階 1 と同じに解く）
export function wormSections(scene: Scene, component: KinematicComponent): WormSections | null {
  if (!component.meshes.some((m) => m.kind === 'worm')) return null;
  const constraints = component.meshes.map((m) => constraintOf(scene, m));

  // 1. ウォーム以外のかみ合いで区画に分ける（Union-Find）
  const parent = new Map<ShaftId, ShaftId>(component.shaftIds.map((id) => [id, id]));
  const find = (id: ShaftId): ShaftId => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as ShaftId;
    parent.set(id, root);
    return root;
  };
  const union = (x: ShaftId, y: ShaftId) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(compareIds(rx, ry) < 0 ? ry : rx, compareIds(rx, ry) < 0 ? rx : ry);
  };
  for (const c of constraints) {
    if (c.worm === null) for (const t of c.terms) union(c.shaftA, t.shaftId);
  }

  // 2. 区画の有向グラフ（ウォームの区画 → ホイールの区画）と、強連結成分でまとめる（Tarjan）
  const nodes = [...new Set(component.shaftIds.map(find))].sort(compareIds);
  const edges = new Map<ShaftId, ShaftId[]>(nodes.map((n) => [n, []]));
  for (const c of constraints) {
    if (c.worm === null) continue;
    const from = find(c.worm === 'a' ? c.shaftA : c.shaftB);
    const to = find(c.worm === 'a' ? c.shaftB : c.shaftA);
    if (from !== to) edges.get(from)?.push(to);
  }
  const sccOf = tarjan(nodes, edges);
  for (const n of nodes) union(n, sccOf.get(n) as ShaftId);

  // 3. まとめた区画のトポロジカル順（入ってくる辺の無いもののうち、先頭のシャフトの ID が小さい順）
  const groups = new Map<ShaftId, ShaftId[]>();
  for (const id of component.shaftIds) {
    const root = find(id);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [id]);
    else list.push(id);
  }
  const inDegree = new Map<ShaftId, number>([...groups.keys()].map((g) => [g, 0]));
  const out = new Map<ShaftId, ShaftId[]>([...groups.keys()].map((g) => [g, []]));
  const incoming = new Set<ShaftId>();
  for (const c of constraints) {
    if (c.worm === null) continue;
    const from = find(c.worm === 'a' ? c.shaftA : c.shaftB);
    const to = find(c.worm === 'a' ? c.shaftB : c.shaftA);
    if (from === to) continue;
    out.get(from)?.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    incoming.add(to);
  }
  const first = (g: ShaftId) => (groups.get(g) as ShaftId[])[0] as ShaftId;
  const ready = [...groups.keys()].filter((g) => inDegree.get(g) === 0);
  const order: ShaftId[] = [];
  while (ready.length > 0) {
    ready.sort((x, y) => compareIds(first(x), first(y)));
    const g = ready.shift() as ShaftId;
    order.push(g);
    for (const next of out.get(g) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }

  const sectionOfShaft = new Map<ShaftId, number>();
  const sections = order.map((g, index) => {
    const shaftIds = groups.get(g) as ShaftId[];
    for (const id of shaftIds) sectionOfShaft.set(id, index);
    return { shaftIds, incoming: incoming.has(g) };
  });
  return {
    sections,
    sectionOfShaft,
    constraints,
    anchoredShaftIds: new Set(component.anchoredShaftIds),
  };
}

// 強連結成分。各頂点 → その成分の代表（成分の中で最も小さい頂点）
function tarjan(
  nodes: readonly ShaftId[],
  edges: ReadonlyMap<ShaftId, readonly ShaftId[]>,
): Map<ShaftId, ShaftId> {
  const index = new Map<ShaftId, number>();
  const low = new Map<ShaftId, number>();
  const onStack = new Set<ShaftId>();
  const stack: ShaftId[] = [];
  const result = new Map<ShaftId, ShaftId>();
  let counter = 0;
  const visit = (v: ShaftId): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const members: ShaftId[] = [];
      for (;;) {
        const w = stack.pop() as ShaftId;
        onStack.delete(w);
        members.push(w);
        if (w === v) break;
      }
      const root = [...members].sort(compareIds)[0] as ShaftId;
      for (const w of members) result.set(w, root);
    }
  };
  for (const v of nodes) if (!index.has(v)) visit(v);
  return result;
}

export type WormSolution =
  | { readonly ok: true; readonly omegas: ReadonlyMap<ShaftId, number> }
  | { readonly ok: false; readonly reason: LockReason };

// 区画ごとにトポロジカル順に解く。drives はシャフトごとの ON のモーターの和（無ければ NO_DRIVE）。
// ロックの条件（成分全体を ω = 0 にする理由）:
// - 入ってくる辺のない区画: 自由度 0 で ON のモーターがある → 'contradiction'。ON のモーターがあり、
//   解いた ω がその区画で全て LOCK_OMEGA_EPS 未満 → 'stalemate'（段階 1 と同じ）
// - 入ってくる辺のある区画: 規定値がすべて 0（上流のウォームが止まっている）で、ON のモーターがあり、
//   解いた ω がその区画で全て LOCK_OMEGA_EPS 未満 → 'wormBackDrive'。
//   規定値どうし・区画の中の拘束と規定値が両立しない（止まったウォームが別のウォームに逆から回される）→ 'wormBackDrive'
export function solveWormSections(
  structure: WormSections,
  drives: ReadonlyMap<ShaftId, ShaftDrive>,
): WormSolution {
  const omegas = new Map<ShaftId, number>();
  for (const [index, section] of structure.sections.entries()) {
    const ids = section.shaftIds;
    const local = new Map(ids.map((id, i) => [id, i]));
    const rows: Matrix = [];
    const fixed: Array<{ row: number; value: number }> = [];
    for (const c of structure.constraints) {
      if (c.terms.every((t) => structure.sectionOfShaft.get(t.shaftId) === index)) {
        const row = new Array<number>(ids.length).fill(0);
        for (const t of c.terms) {
          const j = local.get(t.shaftId) as number;
          row[j] = (row[j] as number) + t.coef;
        }
        rows.push(row);
      } else if (c.worm !== null) {
        // 上流のウォーム → この区画のホイール: c_w·ω_w + c_h·ω_h = 0 から ω_h を規定値にする
        const wormShaft = c.worm === 'a' ? c.shaftA : c.shaftB;
        const wheelShaft = c.worm === 'a' ? c.shaftB : c.shaftA;
        const cw = c.worm === 'a' ? c.coefA : c.coefB;
        const ch = c.worm === 'a' ? c.coefB : c.coefA;
        if (structure.sectionOfShaft.get(wheelShaft) !== index) continue;
        const ww = omegas.get(wormShaft) ?? 0;
        fixed.push({ row: local.get(wheelShaft) as number, value: (-cw * ww) / ch });
      }
    }
    // 固定具（S3-01）: 区画の中の拘束として ω = 0 の行を足す（区画の零空間に入る）
    ids.forEach((id, i) => {
      if (!structure.anchoredShaftIds.has(id)) return;
      const row = new Array<number>(ids.length).fill(0);
      row[i] = 1;
      rows.push(row);
    });
    const basis = nullSpace(rows, ids.length);
    const dof = basis[0]?.length ?? 0;
    const sectionDrives = ids.map((id) => drives.get(id) ?? NO_DRIVE);
    const hasMotor = ids.some((id) => drives.has(id));

    let solved: number[];
    if (fixed.length === 0) {
      if (dof === 0 && hasMotor) return { ok: false, reason: 'contradiction' };
      solved = solveBalanceAffine(basis, null, sectionDrives).omegas;
      if (hasMotor && solved.every((w) => Math.abs(w) < LOCK_OMEGA_EPS)) {
        return { ok: false, reason: 'stalemate' };
      }
    } else {
      const constrained = solveFixed(basis, dof, fixed, sectionDrives);
      if (constrained === null) return { ok: false, reason: 'wormBackDrive' };
      solved = constrained;
      const stopped = fixed.every((f) => Math.abs(f.value) < LOCK_OMEGA_EPS);
      if (stopped && hasMotor && solved.every((w) => Math.abs(w) < LOCK_OMEGA_EPS)) {
        return { ok: false, reason: 'wormBackDrive' };
      }
    }
    ids.forEach((id, i) => {
      omegas.set(id, solved[i] as number);
    });
  }
  return { ok: true, omegas };
}

// 規定値（行 row の ω = value）を満たす ω = N q のうち、残りの自由度を力のつり合いで決めたもの。両立しなければ null。
// 自由度 2 以上の成分を手で回すとき（S3-03）にも使う
export function solveFixed(
  basis: Matrix,
  dof: number,
  fixed: ReadonlyArray<{ row: number; value: number }>,
  drives: readonly ShaftDrive[],
): number[] | null {
  const scaleOf = Math.max(1, ...fixed.map((f) => Math.abs(f.value)));
  const tolerance = 1e-9 * scaleOf;
  if (dof === 0) {
    return fixed.every((f) => Math.abs(f.value) <= tolerance) ? basis.map(() => 0) : null;
  }
  const a: Matrix = fixed.map((f) => [...(basis[f.row] as number[])]);
  const v = fixed.map((f) => f.value);
  const qp = solveParticular(a, v, dof);
  const residual = multiplyVector(a, qp).map((x, i) => x - (v[i] as number));
  if (residual.some((r) => Math.abs(r) > tolerance)) return null;
  const offset = multiplyVector(basis, qp);
  const z = nullSpace(a, dof);
  const free = z[0]?.length ?? 0;
  if (free === 0) return offset;
  return solveBalanceAffine(multiply(basis, z, free), offset, drives).omegas;
}
