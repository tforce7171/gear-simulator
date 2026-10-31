import { DEFAULT_TEETH, GRID_SNAP } from '../core/constants';
import type { Command } from '../core/edit/commands';
import { outsideRadius } from '../core/geometry/mesh';
import { add, dot, scale, sub, type Vec3 } from '../core/math/vec3';
import type { Axis, SizeKey } from '../core/scene/types';

// 起点のシャフトを置く・動かすための純粋関数（S1-17）

// mm。起点の初期の高さ = 歯先円半径 + これ を GRID_SNAP に切り上げ（UI だけで使う）
export const ROOT_CLEARANCE = 10;

// 平行とみなすしきい値（向きのベクトルの内積・行列式）
const PARALLEL_EPS = 1e-9;

// step の倍数のうち最も近いもの（ちょうど半分なら大きい方）。-0 は 0 にする
export function snap(value: number, step: number): number {
  return Math.round(value / step) * step + 0;
}

// 起点の原点の高さ。どの向きに置いても歯車が床にめり込まない
export function rootHeight(size: SizeKey, teeth: number): number {
  const raw = outsideRadius(size, teeth) + ROOT_CLEARANCE;
  // 浮動小数の誤差で 1 段上がらないように、わずかに引いてから切り上げる
  return Math.ceil(raw / GRID_SNAP - 1e-9) * GRID_SNAP;
}

const NEXT_AXIS: Readonly<Record<Axis, Axis>> = { y: 'x', x: 'z', z: 'y' };

// R キーでの向きの切り替え: y → x → z → y
export function nextAxis(axis: Axis): Axis {
  return NEXT_AXIS[axis];
}

// レイと平面の交点。平行、または交点がレイの後ろなら null
export function intersectRayPlane(
  rayOrigin: Vec3,
  rayDir: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3,
): Vec3 | null {
  const denom = dot(planeNormal, rayDir);
  if (Math.abs(denom) < PARALLEL_EPS) return null;
  const t = dot(planeNormal, sub(planePoint, rayOrigin)) / denom;
  if (t < 0) return null;
  return add(rayOrigin, scale(rayDir, t));
}

// 縦の直線（x, z を通る）に最も近いレイ上の点の y。高さのハンドル用。
// 2 直線の最近点: 直線上の点の y = (a·ee − b·dd) / (a − b²)（a = |d|²、b = d_y、w = o − (x, 0, z)、
// dd = d·w、ee = w_y）。レイが縦（直線と平行）なら null
export function closestHeightOnVerticalLine(
  rayOrigin: Vec3,
  rayDir: Vec3,
  x: number,
  z: number,
): number | null {
  const w = sub(rayOrigin, [x, 0, z]);
  const a = dot(rayDir, rayDir);
  const b = rayDir[1];
  const denom = a - b * b;
  if (denom <= PARALLEL_EPS * a) return null;
  const dd = dot(rayDir, w);
  const ee = w[1];
  return (a * ee - b * dd) / denom;
}

// 床の点 floorHit に、歯車の無い起点のシャフトを向き axis で置くコマンド（S4-04。歯車はあとでシャフトの上に置く）。
// x・z は GRID_SNAP に吸着し、高さは rootHeight(size, DEFAULT_TEETH[size])（パレットの大きさの歯車を
// あとで置いても、どの向きでも床にめり込まない高さ。S1-17 のまま）
export function rootPlacementCommand(
  floorHit: Vec3,
  axis: Axis,
  size: SizeKey,
): Extract<Command, { type: 'addRootShaft' }> {
  return {
    type: 'addRootShaft',
    axis,
    origin: [
      snap(floorHit[0], GRID_SNAP),
      rootHeight(size, DEFAULT_TEETH[size]),
      snap(floorHit[2], GRID_SNAP),
    ],
  };
}
