import type { Axis } from '../scene/types';
import { add, scale, type Vec3 } from './vec3';

// 軸の座標系（design.md §2）。軸 w に垂直な平面の基底 u・v は u × v = w の右手系。
// 角度 angle の方向は cos(angle)·u + sin(angle)·v で、angle が増える向きが回転の正の向き（右ねじ）。
// 2D の歯形（S1-02）の x・y は u・v に対応する。

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Z: Vec3 = [0, 0, 1];

const FRAMES: Readonly<Record<Axis, { u: Vec3; v: Vec3; w: Vec3 }>> = {
  x: { u: Y, v: Z, w: X },
  y: { u: Z, v: X, w: Y },
  z: { u: X, v: Y, w: Z },
};

export function axisVector(axis: Axis): Vec3 {
  return FRAMES[axis].w;
}

export function axisFrame(axis: Axis): { u: Vec3; v: Vec3; w: Vec3 } {
  return FRAMES[axis];
}

export function radialDirection(axis: Axis, angle: number): Vec3 {
  const { u, v } = FRAMES[axis];
  return add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
}

const NEXT_AXIS: Readonly<Record<Axis, Axis>> = { x: 'y', y: 'z', z: 'x' };

// 軸を x → y → z → x の順に step 回進める（S2-02。向きの違う子の配置の axisStep。S2-03 の 'skew' も使う）
export function stepAxis(axis: Axis, step: number): Axis {
  let result = axis;
  const n = ((step % 3) + 3) % 3;
  for (let i = 0; i < n; i++) result = NEXT_AXIS[result];
  return result;
}
