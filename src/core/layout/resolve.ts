import { GEAR_SIZES } from '../constants';
import { centerDistance, meshPhase, pitchRadius } from '../geometry/mesh';
import { axisVector, radialDirection } from '../math/axis';
import { add, scale, type Vec3 } from '../math/vec3';
import { gearCenter } from '../scene/gear-center';
import type { Axis, Gear, GearId, Scene, Shaft, ShaftId } from '../scene/types';
import type { GearLayout, Layout, Mesh, ShaftLayout } from './types';

// 暫定のレイアウト（S1-04）。root・detached のシャフトから mesh でたどれる木だけを扱う。
// 偶然のかみ合い・干渉は扱わない（S1-08 が interferences を埋め、S1-09 がこのファイルを置き換える）
export function resolveLayout(scene: Scene): Layout {
  const gearsByShaft = new Map<ShaftId, Gear[]>();
  for (const gear of Object.values(scene.gears)) {
    const list = gearsByShaft.get(gear.shaftId);
    if (list === undefined) gearsByShaft.set(gear.shaftId, [gear]);
    else list.push(gear);
  }
  // 親の歯車 → その外周に生やした mesh のシャフト
  const childShaftsByParentGear = new Map<GearId, Shaft[]>();
  for (const shaft of Object.values(scene.shafts)) {
    if (shaft.placement.kind !== 'mesh') continue;
    const parentId = shaft.placement.parentGearId;
    const list = childShaftsByParentGear.get(parentId);
    if (list === undefined) childShaftsByParentGear.set(parentId, [shaft]);
    else list.push(shaft);
  }

  const shafts: Record<ShaftId, ShaftLayout> = {};
  const gears: Record<GearId, GearLayout> = {};
  const meshes: Mesh[] = [];

  // 幅優先でたどる。子の歯車の basePhase はキューに積むときに決める
  const queue: Array<{
    shaftId: ShaftId;
    origin: Vec3;
    axis: Axis;
    childPhase?: [GearId, number];
  }> = [];
  for (const shaft of Object.values(scene.shafts)) {
    const p = shaft.placement;
    if (p.kind === 'mesh') continue;
    queue.push({ shaftId: shaft.id, origin: p.origin, axis: p.axis });
  }

  for (let head = 0; head < queue.length; head++) {
    const item = queue[head];
    if (item === undefined || shafts[item.shaftId] !== undefined) continue;
    const { shaftId, origin, axis } = item;
    const onShaft = gearsByShaft.get(shaftId) ?? [];
    shafts[shaftId] = { origin, axis, span: spanOf(onShaft) };

    for (const gear of onShaft) {
      const basePhase =
        item.childPhase !== undefined && item.childPhase[0] === gear.id ? item.childPhase[1] : 0;
      gears[gear.id] = {
        center: gearCenter(origin, axis, gear),
        axis,
        pitchRadius: pitchRadius(gear.size, gear.teeth),
        basePhase,
      };
    }

    for (const parent of onShaft) {
      const parentLayout = gears[parent.id];
      if (parentLayout === undefined) continue;
      for (const childShaft of childShaftsByParentGear.get(parent.id) ?? []) {
        const p = childShaft.placement;
        if (p.kind !== 'mesh' || shafts[childShaft.id] !== undefined) continue;
        const child = scene.gears[p.childGearId];
        if (child === undefined || child.shaftId !== childShaft.id) continue;
        // 親の歯車の負側の面 + 外周の向き × 中心距離（子の offset は 0 として置く）
        const face = add(origin, scale(axisVector(axis), parent.offset));
        const distance = centerDistance(parent.size, parent.teeth, child.teeth);
        const childOrigin = add(face, scale(radialDirection(axis, p.angle), distance));
        const phase = meshPhase(parentLayout.basePhase, parent.teeth, child.teeth, p.angle);
        meshes.push({ a: parent.id, b: child.id, source: 'tree' });
        queue.push({
          shaftId: childShaft.id,
          origin: childOrigin,
          axis,
          childPhase: [child.id, phase],
        });
      }
    }
  }

  return { shafts, gears, meshes, interferences: [] };
}

// 載っている歯車の両端（暫定。S1-09 で決め直す）。歯車が無ければ [0, 0]
function spanOf(gears: readonly Gear[]): [number, number] {
  if (gears.length === 0) return [0, 0];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const gear of gears) {
    lo = Math.min(lo, gear.offset);
    hi = Math.max(hi, gear.offset + GEAR_SIZES[gear.size].faceWidth);
  }
  return [lo, hi];
}
