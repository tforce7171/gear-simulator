import { solveVelocities } from '../core/kinematics/balance';
import { buildMeshGraph, type MeshGraph } from '../core/kinematics/graph';
import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Scene, ShaftId } from '../core/scene/types';

// 暫定の運動（S1-04〜S1-06）。ω はかみ合いのグラフ（S1-05）の上の力のつり合いの解（S1-06 の solveVelocities）。
// 角度は θ += ω·dt。S1-07 が stepMotion で置き換える

// グラフはシーン（と、そこから求めた Layout）が変わったときだけ作り直す
const graphCache = new WeakMap<Layout, { scene: Scene; graph: MeshGraph }>();

function graphOf(scene: Scene, layout: Layout): MeshGraph {
  const cached = graphCache.get(layout);
  if (cached !== undefined && cached.scene === scene) return cached.graph;
  const graph = buildMeshGraph(scene, layout.meshes);
  graphCache.set(layout, { scene, graph });
  return graph;
}

export function stepProvisionalMotion(
  scene: Scene,
  layout: Layout,
  prev: MotionState,
  dt: number,
): MotionState {
  const { omegas } = solveVelocities(scene, graphOf(scene, layout));
  const angles: Record<ShaftId, number> = {};
  for (const shaftId of Object.keys(scene.shafts)) {
    angles[shaftId] = (prev.angles[shaftId] ?? 0) + (omegas[shaftId] ?? 0) * dt;
  }
  return { angles, omegas, locks: [], backDriven: [] };
}
