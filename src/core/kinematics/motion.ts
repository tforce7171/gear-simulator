import { LOCK_OMEGA_EPS, MOTOR_SIZES, RACK_END_EPS } from '../constants';
import type { Layout } from '../layout/types';
import { anchoredRackIds, anchoredShaftIds } from '../scene/scene';
import type { Motor, MotorId, RackId, Scene, ShaftId } from '../scene/types';
import { type ShaftDrive, solveVelocities } from './balance';
import { bodyIdsOf, buildMeshGraph, type KinematicComponent, type MeshGraph } from './graph';
import { multiplyVector } from './linalg';
import { rpmToRadPerSec } from './motor';
import {
  emptyMotion,
  type HandConstraint,
  type LockInfo,
  type LockReason,
  type MotionState,
} from './types';
import { solveFixed, solveWormSections, type WormSections, wormSections } from './worm-solve';

// 運動の状態を 1 フレーム進める（design.md §6）。かみ合いのグラフ（S1-05）と力のつり合い（S1-06）から、
// ロック・負けたモーター・角度（θ = N q）を求める

// つかんだシャフトの零空間の行が、この値未満の成分だけなら動けない（固定具で止まっている。S3-01）。
// 基底の成分は速度比（歯数の比）の大きさなので、丸めの誤差だけを 0 とみなす
const PINNED_EPS = 1e-9;

const NO_DRIVE: ShaftDrive = { damping: 0, bias: 0 };

export interface MotionOptions {
  readonly paused?: boolean; // 全モーターを OFF とみなす（シーンは変えない）
  readonly hand?: HandConstraint; // つかんだシャフトの角度をこの値にする
}

export function initialMotionState(): MotionState {
  return emptyMotion();
}

// ウォームの区画（S2-03）。グラフと同じく、グラフの参照ごとに覚える
const wormCache = new WeakMap<MeshGraph, Array<WormSections | null>>();

function wormSectionsOf(scene: Scene, graph: MeshGraph): Array<WormSections | null> {
  const cached = wormCache.get(graph);
  if (cached !== undefined) return cached;
  const sections = graph.components.map((c) => wormSections(scene, c));
  wormCache.set(graph, sections);
  return sections;
}

// グラフは Layout の参照ごとに覚え、シーンの参照が変わったときだけ作り直す。
// meshGraphOf は固定具の拘束を入れないグラフ（かみ合いだけ。ロックの理由 'anchor' の判定と、
// 情報表示のギア比（S1-23）の逃げ道に使う）、anchoredMeshGraphOf は固定具の拘束 ω = 0 を入れたグラフ（S3-01。
// 運動はこちらで解く）。固定具が無ければ 2 つは同じオブジェクト
const graphCache = new WeakMap<Layout, { scene: Scene; graph: MeshGraph }>();
const anchoredGraphCache = new WeakMap<Layout, { scene: Scene; graph: MeshGraph }>();

export function meshGraphOf(scene: Scene, layout: Layout): MeshGraph {
  const cached = graphCache.get(layout);
  if (cached !== undefined && cached.scene === scene) return cached.graph;
  const graph = buildMeshGraph(scene, layout.meshes, new Set(), layout.rackMeshes);
  graphCache.set(layout, { scene, graph });
  return graph;
}

export function anchoredMeshGraphOf(scene: Scene, layout: Layout): MeshGraph {
  const cached = anchoredGraphCache.get(layout);
  if (cached !== undefined && cached.scene === scene) return cached.graph;
  // 固定具の対象はシャフトとラック（S3-04 のラックは v = 0）
  const anchored = new Set<ShaftId | RackId>([
    ...anchoredShaftIds(scene),
    ...anchoredRackIds(scene),
  ]);
  const graph =
    anchored.size === 0
      ? meshGraphOf(scene, layout)
      : buildMeshGraph(scene, layout.meshes, anchored, layout.rackMeshes);
  anchoredGraphCache.set(layout, { scene, graph });
  return graph;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lockOf(reason: LockReason, component: KinematicComponent): LockInfo {
  const lock = { reason, shaftIds: [...component.shaftIds], gearIds: [...component.gearIds] };
  return component.rackIds.length === 0 ? lock : { ...lock, rackIds: [...component.rackIds] };
}

function isAnchored(component: KinematicComponent): boolean {
  return component.anchoredShaftIds.length > 0 || component.anchoredRackIds.length > 0;
}

// 行ベクトル n と q の内積
function rowDot(n: readonly number[], q: readonly number[]): number {
  let sum = 0;
  for (let k = 0; k < n.length; k++) sum += (n[k] as number) * (q[k] as number);
  return sum;
}

// ラックの変位 s = n·q が範囲 travel の外なら、q を最も小さく動かして（n の向きに）端に寄せる（S3-04。
// ラックの歯数を減らしたときなど、構成が変わって範囲が縮んだとき）
function clampRacksIntoTravel(
  q: number[],
  rows: ReadonlyArray<{
    readonly n: readonly number[];
    readonly travel: readonly [number, number];
  }>,
): number[] {
  let out = q;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const { n, travel } of rows) {
      const norm2 = rowDot(n, n);
      if (norm2 === 0) continue;
      const s = rowDot(n, out);
      const target =
        s > travel[1] + RACK_END_EPS ? travel[1] : s < travel[0] - RACK_END_EPS ? travel[0] : null;
      if (target === null) continue;
      const shift = (target - s) / norm2;
      out = out.map((v, k) => v + shift * (n[k] as number));
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

// ラックの端（S3-04）。q が qPrev から qNext へ動くとき（速度 qDot）、どれかのラックが端を越えるなら、最初に端に届く割合 t
// （0〜1）を返す。端にいて外向きに動こうとしているなら 0。越えなければ null
function rackEndFraction(
  rows: ReadonlyArray<{
    readonly n: readonly number[];
    readonly travel: readonly [number, number];
  }>,
  qPrev: readonly number[],
  qNext: readonly number[],
  qDot: readonly number[],
): number | null {
  let t: number | null = null;
  for (const { n, travel } of rows) {
    const [lo, hi] = travel;
    const sPrev = rowDot(n, qPrev);
    const sNext = rowDot(n, qNext);
    const v = rowDot(n, qDot);
    const ds = sNext - sPrev;
    let ti: number | null = null;
    if (sPrev >= hi - RACK_END_EPS && (ds > RACK_END_EPS || v > LOCK_OMEGA_EPS)) ti = 0;
    else if (sPrev <= lo + RACK_END_EPS && (ds < -RACK_END_EPS || v < -LOCK_OMEGA_EPS)) ti = 0;
    else if (sNext > hi + RACK_END_EPS) ti = (hi - sPrev) / ds;
    else if (sNext < lo - RACK_END_EPS) ti = (lo - sPrev) / ds;
    if (ti === null) continue;
    const clamped = Math.min(1, Math.max(0, ti));
    t = t === null ? clamped : Math.min(t, clamped);
  }
  return t;
}

// 角度を進めずに、いまの入力での ω・ロック・負けたモーターを求める（dt = 0 の stepMotion と同じ）
export function solveMotion(
  scene: Scene,
  layout: Layout,
  prev: MotionState,
  opts?: MotionOptions,
): MotionState {
  return stepMotion(scene, layout, prev, 0, opts);
}

// 1 フレーム進める。戻り値の angles・omegas はシーンの全シャフトを含み、シーンに無いシャフトは含まない
export function stepMotion(
  scene: Scene,
  layout: Layout,
  prev: MotionState,
  dt: number,
  opts: MotionOptions = {},
): MotionState {
  const paused = opts.paused === true;
  const graph = anchoredMeshGraphOf(scene, layout);
  const balance = solveVelocities(scene, graph, { paused });
  // 固定具を外したグラフ（S3-01）。固定具のある成分がロックしたときだけ、理由を決めるために解く
  const freeGraph = meshGraphOf(scene, layout);
  let freeBalance: ReturnType<typeof solveVelocities> | null = null;

  // ON のモーター（一時停止中は無い）を、シャフトごとに
  const motorsOfShaft = new Map<ShaftId, Motor[]>();
  if (!paused) {
    for (const motor of Object.values(scene.motors)) {
      if (!motor.on) continue;
      const list = motorsOfShaft.get(motor.shaftId);
      if (list === undefined) motorsOfShaft.set(motor.shaftId, [motor]);
      else list.push(motor);
    }
  }

  // シーンに無いシャフトをつかんでいたら、手は無いものとして扱う
  const hand =
    opts.hand !== undefined && graph.componentOfShaft[opts.hand.shaftId] !== undefined
      ? opts.hand
      : undefined;
  const handComponent = hand === undefined ? undefined : graph.componentOfShaft[hand.shaftId];

  // ウォームを含む成分の区画（S2-03）と、シャフトごとの ON のモーターの和（区画ごとのつり合いに使う）
  const worms = wormSectionsOf(scene, graph);
  const drives = new Map<ShaftId, ShaftDrive>();
  for (const [shaftId, motors] of motorsOfShaft) {
    let damping = 0;
    let bias = 0;
    for (const motor of motors) {
      const stall = MOTOR_SIZES[motor.size].stallTorque;
      damping += stall / rpmToRadPerSec(motor.rpm);
      bias += stall * motor.direction;
    }
    drives.set(shaftId, { damping, bias });
  }

  const angles: Record<ShaftId, number> = {};
  const omegas: Record<ShaftId, number> = {};
  const rackPositions: Record<RackId, number> = {};
  const rackVelocities: Record<RackId, number> = {};
  const locks: LockInfo[] = [];
  const backDriven: MotorId[] = [];
  // 前の状態の「角度」。ラック（S3-04）は変位 s
  const isRack = (id: string): boolean => scene.racks[id] !== undefined;
  const prevValue = (id: string): number =>
    (isRack(id) ? prev.rackPositions[id] : prev.angles[id]) ?? 0;

  // 固定具を外して解き直したときの、成分のロックの理由（段階 1・ウォームの条件。ロックしなければ null）。
  // 固定具は連結のしかたを変えないので、固定具を外したグラフにも同じシャフトの組の成分がある
  function freeLockReason(component: KinematicComponent): LockReason | null {
    const freeIndex = freeGraph.componentOfShaft[bodyIdsOf(component)[0] as ShaftId] as number;
    const free = freeGraph.components[freeIndex] as KinematicComponent;
    const hasMotor = free.shaftIds.some((id) => motorsOfShaft.has(id));
    if (free.dof === 0) return hasMotor ? 'contradiction' : null;
    const worm = wormSectionsOf(scene, freeGraph)[freeIndex] ?? null;
    if (worm !== null) {
      const solution = solveWormSections(worm, drives);
      return solution.ok ? null : solution.reason;
    }
    freeBalance ??= solveVelocities(scene, freeGraph, { paused });
    const omegasFree = freeBalance.omegas;
    const stalemate =
      hasMotor && free.shaftIds.every((id) => Math.abs(omegasFree[id] ?? 0) < LOCK_OMEGA_EPS);
    return stalemate ? 'stalemate' : null;
  }

  // ロックの理由に固定具を考える（S3-01）: 固定具のある成分で、固定具を外して解き直すとロックしないなら 'anchor'。
  // 外してもロックするなら、外したときの段階 1（・ウォーム）の理由にする（固定具で自由度 0 になっても、
  // 本当の原因はウォームの逆駆動、などのため）
  function anchorAware(reason: LockReason, component: KinematicComponent): LockReason {
    if (!isAnchored(component)) return reason;
    return freeLockReason(component) ?? 'anchor';
  }

  // 手でつかんだシャフトが動けないときの理由: 固定具を外すと動けるなら 'anchor'、外しても自由度 0 なら 'contradiction'
  function grabbedLockReason(component: KinematicComponent): LockReason {
    if (!isAnchored(component)) return 'contradiction';
    const freeIndex = freeGraph.componentOfShaft[bodyIdsOf(component)[0] as ShaftId] as number;
    return (freeGraph.components[freeIndex]?.dof ?? 0) === 0 ? 'contradiction' : 'anchor';
  }

  graph.components.forEach((component, index) => {
    const { shaftIds, basis, dof } = component;
    const bodyIds = bodyIdsOf(component);
    const hasMotor = shaftIds.some((id) => motorsOfShaft.has(id));
    const grabbed = index === handComponent;
    const lockCount = locks.length;

    // 自由度 0: 角度は前の値のまま（無ければ 0）、ω = 0。ON のモーターか手があれば矛盾のロック
    // （固定具を外せば解けるなら 'anchor'。S3-01）
    if (dof === 0) {
      for (const id of shaftIds) {
        angles[id] = prev.angles[id] ?? 0;
        omegas[id] = 0;
      }
      for (const id of component.rackIds) {
        rackPositions[id] = prev.rackPositions[id] ?? 0;
        rackVelocities[id] = 0;
      }
      if (grabbed) {
        locks.push(lockOf(grabbedLockReason(component), component));
      } else if (hasMotor) {
        locks.push(lockOf(anchorAware('contradiction', component), component));
      }
      return;
    }

    // ラックの行と s の範囲（S3-04）。レイアウトに無いラック（ピニオンが根からたどれない）は範囲を見ない
    const rackRows = component.rackIds.flatMap((id, k) => {
      const travel = layout.racks[id]?.travel;
      const n = basis[shaftIds.length + k];
      return travel === undefined || n === undefined ? [] : [{ n, travel }];
    });
    // q は基準シャフト（ラックだけの成分ではラック）の角度。前の状態に無ければ 0 から。
    // ラックの範囲が縮んで今の s が外に出ていれば、端に寄せる（S3-04）
    const qPrev = clampRacksIntoTravel(
      component.referenceShaftIds.map((id) => prevValue(id)),
      rackRows,
    );
    let qNext: number[];
    let qDot: number[];
    const worm = worms[index] ?? null;
    const wormSection =
      worm === null || hand === undefined ? undefined : worm.sectionOfShaft.get(hand.shaftId);
    const handRow = hand === undefined ? -1 : bodyIds.indexOf(hand.shaftId);
    if (
      grabbed &&
      worm !== null &&
      wormSection !== undefined &&
      worm.sections[wormSection]?.incoming
    ) {
      // ウォームから規定値を受ける区画をつかんだ（手と上流のウォームの両方が規定値になる）: 常にロック（S2-03）
      locks.push(lockOf('wormBackDrive', component));
      qDot = qPrev.map(() => 0);
      qNext = qPrev;
    } else if (
      grabbed &&
      hand !== undefined &&
      (basis[handRow] ?? []).every((x) => Math.abs(x) < PINNED_EPS)
    ) {
      // つかんだシャフトが固定具で動けない（固定具の拘束を入れた零空間で、その行がすべて 0）: ドラッグ中はロック（S3-01）
      locks.push(lockOf(grabbedLockReason(component), component));
      qDot = qPrev.map(() => 0);
      qNext = qPrev;
    } else if (grabbed && hand !== undefined && dof === 1) {
      const n = basis[handRow]?.[0] ?? 0;
      qNext = [hand.angle / n];
      qDot = qNext.map((v, k) => (dt > 0 ? (v - (qPrev[k] as number)) / dt : 0));
    } else if (grabbed && hand !== undefined) {
      // 自由度 2 以上（S3-03 の遊星歯車など）: つかんだシャフトの角度を手の角度にし、残りの自由度はつり合いで決める。
      // つかんだシャフトの ω（= 角度の差 / dt）を規定値として、ウォームの規定値と同じ solveFixed で解く（モーターも効く）。
      // dt = 0 では角度の差を一度に動かす（モーターは無いものとし、ω の二乗和が最小の動き）。ω は 0
      const row = handRow;
      const current = multiplyVector([basis[row] as number[]], qPrev)[0] ?? 0;
      const delta = hand.angle - current;
      const refRows = component.referenceShaftIds.map((id) => bodyIds.indexOf(id));
      const toQ = (omegasOfShafts: readonly number[]) => refRows.map((i) => omegasOfShafts[i] ?? 0);
      if (dt > 0) {
        const solved =
          solveFixed(
            basis,
            dof,
            [{ row, value: delta / dt }],
            bodyIds.map((id) => drives.get(id) ?? NO_DRIVE),
          ) ?? basis.map(() => 0);
        qDot = toQ(solved);
        qNext = qPrev.map((v, k) => v + (qDot[k] as number) * dt);
      } else {
        const moved =
          solveFixed(
            basis,
            dof,
            [{ row, value: delta }],
            bodyIds.map(() => NO_DRIVE),
          ) ?? basis.map(() => 0);
        qNext = qPrev.map((v, k) => v + (toQ(moved)[k] as number));
        qDot = qPrev.map(() => 0);
      }
    } else if (worm !== null) {
      // ウォームを含む成分（S2-03）: 区画ごとにトポロジカル順に解き、ω から q（基準シャフトの ω）を求めて積分する
      const solution = solveWormSections(worm, drives);
      if (solution.ok) {
        qDot = component.referenceShaftIds.map((id) => solution.omegas.get(id) ?? 0);
      } else {
        locks.push(lockOf(anchorAware(solution.reason, component), component));
        qDot = qPrev.map(() => 0);
      }
      qNext = qPrev.map((v, k) => v + (qDot[k] as number) * dt);
    } else {
      const solved = balance.componentQ[index] ?? [];
      const stalemate =
        hasMotor && shaftIds.every((id) => Math.abs(balance.omegas[id] ?? 0) < LOCK_OMEGA_EPS);
      if (stalemate) locks.push(lockOf(anchorAware('stalemate', component), component));
      qDot = stalemate ? solved.map(() => 0) : solved;
      qNext = qPrev.map((v, k) => v + (qDot[k] as number) * dt);
    }

    // ラックの端（S3-04）: 端を越えるなら端で止め（その割合だけ進める）、成分をロックにする（ω = 0、v = 0）。
    // 端にいて外向きに動こうとしている間もロック。内向きなら動く（モーターの向きを変えれば戻る）
    if (locks.length === lockCount && rackRows.length > 0) {
      const t = rackEndFraction(rackRows, qPrev, qNext, qDot);
      if (t !== null) {
        const from = qPrev;
        const to = qNext;
        qNext = from.map((v, k) => v + t * ((to[k] as number) - v));
        qDot = qDot.map(() => 0);
        locks.push(lockOf('rackEnd', component));
      }
    }

    const theta = multiplyVector(basis, qNext);
    const omega = multiplyVector(basis, qDot);
    bodyIds.forEach((id, i) => {
      if (i < shaftIds.length) {
        angles[id] = theta[i] as number;
        omegas[id] = (omega[i] as number) + 0; // −0 を 0 にそろえる
      } else {
        rackPositions[id] = (theta[i] as number) + 0;
        rackVelocities[id] = (omega[i] as number) + 0;
      }
    });

    for (const id of shaftIds) {
      const w = omegas[id] as number;
      for (const motor of motorsOfShaft.get(id) ?? []) {
        if (w * motor.direction < -LOCK_OMEGA_EPS) backDriven.push(motor.id);
      }
    }
  });

  backDriven.sort(compareIds);
  return { angles, omegas, locks, backDriven, rackPositions, rackVelocities };
}
