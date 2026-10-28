import type { MotionState } from '../kinematics/types';
import { axisVector } from '../math/axis';
import { add, cross, dot, scale, sub, type Vec3 } from '../math/vec3';
import type { Axis, GearId, ShaftId } from '../scene/types';
import type { Layout, Orbit } from './types';

// 実際の位置（S3-03。design.md §5）。resolveLayout は遊星のシャフトを基準配置（すべてのキャリアの角度が 0）で返すので、
// 描画・音源の位置・ピッキングは、ここでキャリアのシャフトの回転角だけ、キャリアの軸まわりに回した位置を使う

// 点 p を、center を通る軸 axis まわりに angle（右ねじの向き）だけ回した点
export function rotateAboutAxis(p: Vec3, center: Vec3, axis: Axis, angle: number): Vec3 {
  if (angle === 0) return p;
  const w = axisVector(axis);
  const d = sub(p, center);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dot(w, d);
  const rotated = add(add(scale(d, c), scale(cross(w, d), s)), scale(w, along * (1 - c)));
  return add(center, rotated);
}

// 公転の今の角度（キャリアのシャフトの回転角）。運動の状態に無ければ 0
export function orbitAngle(motion: MotionState, orbit: Orbit): number {
  return motion.angles[orbit.carrierShaftId] ?? 0;
}

function orbited(layout: Layout, p: Vec3, orbit: Orbit | undefined, motion: MotionState): Vec3 {
  if (orbit === undefined) return p;
  const axis = layout.shafts[orbit.carrierShaftId]?.axis;
  if (axis === undefined) return p;
  return rotateAboutAxis(p, orbit.center, axis, orbitAngle(motion, orbit));
}

// シャフトの原点の実際の位置。遊星のシャフトはキャリアのシャフトの回転角だけ回す。レイアウトに無ければ [0, 0, 0]
export function shaftWorldOrigin(layout: Layout, motion: MotionState, shaftId: ShaftId): Vec3 {
  const s = layout.shafts[shaftId];
  if (s === undefined) return [0, 0, 0];
  return orbited(layout, s.origin, s.orbit, motion);
}

// 歯車の中心の実際の位置。遊星のシャフトの歯車はキャリアのシャフトの回転角だけ回す。レイアウトに無ければ [0, 0, 0]
export function gearWorldCenter(layout: Layout, motion: MotionState, gearId: GearId): Vec3 {
  const g = layout.gears[gearId];
  if (g === undefined) return [0, 0, 0];
  return orbited(layout, g.center, g.orbit, motion);
}
