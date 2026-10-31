import { canMesh } from '../geometry/can-mesh';
import { centerDistance, faceOverlaps, gearWidth } from '../geometry/dimensions';
import { axisVector } from '../math/axis';
import { dot, sub, type Vec3 } from '../math/vec3';
import type { GearId, Scene, ShaftId } from '../scene/types';
import { descendantShafts } from './resolve';
import type { Layout } from './types';

// 外周の角度の円弧ハンドル（S1-19）の、かみ合いへの吸着の相手。
// mesh のシャフト shaftId の子の歯車とかみ合える（canMesh。同じ大きさで種類と形が合う。S2-01）、軸が平行（Layout の axis が同じ）、
// 歯幅（厚さ。S4-05 から歯車ごと）が軸方向に重なる歯車（偶然のかみ合い contact の条件のうち、距離以外のもの。design.md §5）。
// 親の歯車と、動かすシャフトとその先（descendantShafts）に載った歯車は除く。並びは歯車の ID の昇順
export function meshSnapTargets(
  scene: Scene,
  layout: Layout,
  shaftId: ShaftId,
): Array<{ gearId: GearId; center: Vec3; pitchRadius: number; meshDistance: number }> {
  const placement = scene.shafts[shaftId]?.placement;
  if (placement?.kind !== 'mesh') return [];
  const child = scene.gears[placement.childGearId];
  const childLayout = layout.gears[placement.childGearId];
  if (child === undefined || childLayout === undefined) return [];
  const moving = new Set(descendantShafts(scene, shaftId));
  const w = axisVector(childLayout.axis);
  const childWidth = gearWidth(child);
  const targets: Array<{
    gearId: GearId;
    center: Vec3;
    pitchRadius: number;
    meshDistance: number;
  }> = [];
  for (const gear of Object.values(scene.gears)) {
    if (gear.id === placement.parentGearId || moving.has(gear.shaftId)) continue;
    if (!canMesh(gear, child)) continue;
    const g = layout.gears[gear.id];
    if (g === undefined || g.axis !== childLayout.axis) continue;
    const axial = dot(sub(g.center, childLayout.center), w);
    if (!faceOverlaps(axial, gearWidth(gear), childWidth)) continue;
    targets.push({
      gearId: gear.id,
      center: g.center,
      pitchRadius: g.pitchRadius,
      meshDistance: centerDistance(gear, child), // 内歯車の組は R − r（S3-02）
    });
  }
  return targets.sort((a, b) => (a.gearId < b.gearId ? -1 : a.gearId > b.gearId ? 1 : 0));
}
