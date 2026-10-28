import { stepAxis } from '../math/axis';
import type { Axis, Scene, ShaftId } from './types';

// シャフトの向き。root / detached は placement.axis、mesh は親の歯車のシャフトの向き（平歯車では親と同じ）、
// bevel・skew は親の歯車のシャフトの向きを axisStep 回進めたもの（S2-02、S2-03）。concentric は親のシャフト、
// planet はキャリアのシャフトの向き（S3-03）。rack はラックの歯幅の方向（S3-04）。親をたどって求める。
// 循環していたり参照先が無かったりすれば null
export function shaftAxis(scene: Scene, shaftId: ShaftId): Axis | null {
  const visited = new Set<ShaftId>();
  let current: ShaftId = shaftId;
  let steps = 0;
  for (;;) {
    if (visited.has(current)) return null;
    visited.add(current);
    const shaft = scene.shafts[current];
    if (shaft === undefined) return null;
    const placement = shaft.placement;
    if (placement.kind === 'root' || placement.kind === 'detached') {
      return stepAxis(placement.axis, steps);
    }
    if (placement.kind === 'concentric') {
      // 同じ線上のシャフト（S3-03）は親のシャフトと同じ向き
      current = placement.parentShaftId;
      continue;
    }
    if (placement.kind === 'planet') {
      // 遊星のシャフト（S3-03）はキャリアのシャフトと同じ向き
      const carrier = scene.carriers[placement.carrierId];
      if (carrier === undefined) return null;
      current = carrier.shaftId;
      continue;
    }
    if (placement.kind === 'rack') {
      // ラックのピニオンのシャフト（S3-04）はラックの歯幅の方向。pinion のラックはピニオンの軸、浮いたラックは自分の向きから
      const rack = scene.racks[placement.rackId];
      if (rack === undefined) return null;
      const rp = rack.placement;
      if (rp.kind === 'detached') {
        if (rp.direction === rp.normal) return null;
        const width = (['x', 'y', 'z'] as const).find((a) => a !== rp.direction && a !== rp.normal);
        return width === undefined ? null : stepAxis(width, steps);
      }
      const pinion = scene.gears[rp.gearId];
      if (pinion === undefined) return null;
      current = pinion.shaftId;
      continue;
    }
    if (placement.kind === 'bevel' || placement.kind === 'skew') steps += placement.axisStep;
    const parent = scene.gears[placement.parentGearId];
    if (parent === undefined) return null;
    current = parent.shaftId;
  }
}
