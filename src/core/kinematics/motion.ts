import { LOCK_OMEGA_EPS } from '../constants';
import type { Layout } from '../layout/types';
import type { Motor, MotorId, Scene, ShaftId } from '../scene/types';
import { solveVelocities } from './balance';
import { buildMeshGraph, type KinematicComponent, type MeshGraph } from './graph';
import { multiplyVector } from './linalg';
import {
  emptyMotion,
  type HandConstraint,
  type LockInfo,
  type LockReason,
  type MotionState,
} from './types';

// 運動の状態を 1 フレーム進める（design.md §6）。かみ合いのグラフ（S1-05）と力のつり合い（S1-06）から、
// ロック・負けたモーター・角度（θ = N q）を求める

export interface MotionOptions {
  readonly paused?: boolean; // 全モーターを OFF とみなす（シーンは変えない）
  readonly hand?: HandConstraint; // つかんだシャフトの角度をこの値にする
}

export function initialMotionState(): MotionState {
  return emptyMotion();
}

// グラフは Layout の参照ごとに覚え、シーンの参照が変わったときだけ作り直す。
// 情報表示のギア比（S1-23）も同じグラフを使う
const graphCache = new WeakMap<Layout, { scene: Scene; graph: MeshGraph }>();

export function meshGraphOf(scene: Scene, layout: Layout): MeshGraph {
  const cached = graphCache.get(layout);
  if (cached !== undefined && cached.scene === scene) return cached.graph;
  const graph = buildMeshGraph(scene, layout.meshes);
  graphCache.set(layout, { scene, graph });
  return graph;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lockOf(reason: LockReason, component: KinematicComponent): LockInfo {
  return { reason, shaftIds: [...component.shaftIds], gearIds: [...component.gearIds] };
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
  const graph = meshGraphOf(scene, layout);
  const balance = solveVelocities(scene, graph, { paused });

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

  const angles: Record<ShaftId, number> = {};
  const omegas: Record<ShaftId, number> = {};
  const locks: LockInfo[] = [];
  const backDriven: MotorId[] = [];

  graph.components.forEach((component, index) => {
    const { shaftIds, basis, dof } = component;
    const hasMotor = shaftIds.some((id) => motorsOfShaft.has(id));
    const grabbed = index === handComponent;

    // 自由度 0: 角度は前の値のまま（無ければ 0）、ω = 0。ON のモーターか手があれば矛盾のロック
    if (dof === 0) {
      for (const id of shaftIds) {
        angles[id] = prev.angles[id] ?? 0;
        omegas[id] = 0;
      }
      if (hasMotor || grabbed) locks.push(lockOf('contradiction', component));
      return;
    }

    // q は基準シャフトの角度。前の状態に無ければ 0 から
    const qPrev = component.referenceShaftIds.map((id) => prev.angles[id] ?? 0);
    let qNext: number[];
    let qDot: number[];
    if (grabbed && hand !== undefined) {
      if (dof !== 1) {
        throw new Error(`自由度 ${dof} の成分を手で回すのは未対応（S3-03）: ${hand.shaftId}`);
      }
      const n = basis[shaftIds.indexOf(hand.shaftId)]?.[0] ?? 0;
      if (n === 0) throw new Error(`つかんだシャフトが成分の自由度に乗っていない: ${hand.shaftId}`);
      qNext = [hand.angle / n];
      qDot = qNext.map((v, k) => (dt > 0 ? (v - (qPrev[k] as number)) / dt : 0));
    } else {
      const solved = balance.componentQ[index] ?? [];
      const stalemate =
        hasMotor && shaftIds.every((id) => Math.abs(balance.omegas[id] ?? 0) < LOCK_OMEGA_EPS);
      if (stalemate) locks.push(lockOf('stalemate', component));
      qDot = stalemate ? solved.map(() => 0) : solved;
      qNext = qPrev.map((v, k) => v + (qDot[k] as number) * dt);
    }

    const theta = multiplyVector(basis, qNext);
    const omega = multiplyVector(basis, qDot);
    shaftIds.forEach((id, i) => {
      angles[id] = theta[i] as number;
      omegas[id] = (omega[i] as number) + 0; // −0 を 0 にそろえる
    });

    for (const id of shaftIds) {
      const w = omegas[id] as number;
      for (const motor of motorsOfShaft.get(id) ?? []) {
        if (w * motor.direction < -LOCK_OMEGA_EPS) backDriven.push(motor.id);
      }
    }
  });

  backDriven.sort(compareIds);
  return { angles, omegas, locks, backDriven };
}
