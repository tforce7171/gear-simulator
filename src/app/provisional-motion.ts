import type { MotionState } from '../core/kinematics/types';
import type { Layout } from '../core/layout/types';
import type { Scene, ShaftId } from '../core/scene/types';

// 暫定の運動（S1-04）。ON のモーターが付いたシャフトを無負荷回転数で回し、かみ合いを
// たどって ω_B = −(z_A / z_B)·ω_A で伝える。連結成分にモーターが 2 個以上あれば最初の 1 個だけを使う。
// 角度は θ += ω·dt。S1-05・S1-06 が ω の求め方を差し替え、S1-07 が stepMotion で置き換える
export function stepProvisionalMotion(
  scene: Scene,
  layout: Layout,
  prev: MotionState,
  dt: number,
): MotionState {
  // シャフトのつながり: かみ合う歯車の組ごとに、両側のシャフトと歯数
  const edges = new Map<ShaftId, Array<{ to: ShaftId; ratio: number }>>();
  const addEdge = (from: ShaftId, to: ShaftId, ratio: number): void => {
    const list = edges.get(from);
    if (list === undefined) edges.set(from, [{ to, ratio }]);
    else list.push({ to, ratio });
  };
  for (const mesh of layout.meshes) {
    const a = scene.gears[mesh.a];
    const b = scene.gears[mesh.b];
    if (a === undefined || b === undefined) continue;
    addEdge(a.shaftId, b.shaftId, -a.teeth / b.teeth);
    addEdge(b.shaftId, a.shaftId, -b.teeth / a.teeth);
  }

  const omegas: Record<ShaftId, number> = {};
  for (const shaftId of Object.keys(scene.shafts)) omegas[shaftId] = 0;

  const visited = new Set<ShaftId>();
  for (const motor of Object.values(scene.motors)) {
    if (!motor.on || visited.has(motor.shaftId) || scene.shafts[motor.shaftId] === undefined) {
      continue;
    }
    const queue: Array<[ShaftId, number]> = [
      [motor.shaftId, ((motor.rpm * 2 * Math.PI) / 60) * motor.direction],
    ];
    visited.add(motor.shaftId);
    for (let head = 0; head < queue.length; head++) {
      const entry = queue[head];
      if (entry === undefined) continue;
      const [shaftId, omega] = entry;
      omegas[shaftId] = omega;
      for (const { to, ratio } of edges.get(shaftId) ?? []) {
        if (visited.has(to)) continue;
        visited.add(to);
        queue.push([to, ratio * omega]);
      }
    }
  }

  const angles: Record<ShaftId, number> = {};
  for (const shaftId of Object.keys(scene.shafts)) {
    angles[shaftId] = (prev.angles[shaftId] ?? 0) + (omegas[shaftId] ?? 0) * dt;
  }
  return { angles, omegas, locks: [], backDriven: [] };
}
