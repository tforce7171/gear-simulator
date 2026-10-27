import { buildMeshGraph, type MeshGraph } from '../core/kinematics/graph';
import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Motor, Scene, ShaftId } from '../core/scene/types';

// 暫定の運動（S1-04、S1-05）。かみ合いのグラフ（S1-05 の buildMeshGraph）の基底 N で ω = N q とする。
// 成分ごとに、ID の最も小さい ON のモーターの無負荷角速度から、そのシャフトの行で q を決める。
// 自由度 0 の成分（回転条件の矛盾）とモーターの無い成分は止める。角度は θ += ω·dt。
// S1-06 が ω をつり合いの解に差し替え、S1-07 が stepMotion で置き換える

// グラフはシーン（と、そこから求めた Layout）が変わったときだけ作り直す
const graphCache = new WeakMap<Layout, { scene: Scene; graph: MeshGraph }>();

function graphOf(scene: Scene, layout: Layout): MeshGraph {
  const cached = graphCache.get(layout);
  if (cached !== undefined && cached.scene === scene) return cached.graph;
  const graph = buildMeshGraph(scene, layout.meshes);
  graphCache.set(layout, { scene, graph });
  return graph;
}

function noLoadOmega(motor: Motor): number {
  return ((motor.rpm * 2 * Math.PI) / 60) * motor.direction;
}

export function stepProvisionalMotion(
  scene: Scene,
  layout: Layout,
  prev: MotionState,
  dt: number,
): MotionState {
  const graph = graphOf(scene, layout);

  const omegas: Record<ShaftId, number> = {};
  for (const shaftId of Object.keys(scene.shafts)) omegas[shaftId] = 0;

  const driven = new Set<number>();
  const motors = Object.values(scene.motors).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const motor of motors) {
    const index = graph.componentOfShaft[motor.shaftId];
    if (!motor.on || index === undefined || driven.has(index)) continue;
    driven.add(index);
    const component = graph.components[index];
    if (component === undefined || component.dof === 0) continue;
    // モーターのシャフトの行 n について n·q = ω_m を満たす最小ノルムの q（自由度 1 なら q = ω_m / n）
    const n = component.basis[component.shaftIds.indexOf(motor.shaftId)] ?? [];
    const norm2 = n.reduce((sum, v) => sum + v * v, 0);
    if (norm2 === 0) continue;
    const omegaM = noLoadOmega(motor);
    const q = n.length === 1 ? [omegaM / (n[0] as number)] : n.map((v) => (v * omegaM) / norm2);
    component.shaftIds.forEach((shaftId, i) => {
      const row = component.basis[i] ?? [];
      omegas[shaftId] = row.reduce((sum, v, k) => sum + v * (q[k] ?? 0), 0);
    });
  }

  const angles: Record<ShaftId, number> = {};
  for (const shaftId of Object.keys(scene.shafts)) {
    angles[shaftId] = (prev.angles[shaftId] ?? 0) + (omegas[shaftId] ?? 0) * dt;
  }
  return { angles, omegas, locks: [], backDriven: [] };
}
