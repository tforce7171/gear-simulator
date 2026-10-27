import type { Axis, Scene, ShaftId } from './types';

// シャフトの向き。root / detached は placement.axis、mesh は親の歯車のシャフトをたどって求める
// （段階 1 の平歯車では親と同じ）。循環していたり参照先が無かったりすれば null
export function shaftAxis(scene: Scene, shaftId: ShaftId): Axis | null {
  const visited = new Set<ShaftId>();
  let current: ShaftId = shaftId;
  for (;;) {
    if (visited.has(current)) return null;
    visited.add(current);
    const shaft = scene.shafts[current];
    if (shaft === undefined) return null;
    const placement = shaft.placement;
    if (placement.kind !== 'mesh') return placement.axis;
    const parent = scene.gears[placement.parentGearId];
    if (parent === undefined) return null;
    current = parent.shaftId;
  }
}
