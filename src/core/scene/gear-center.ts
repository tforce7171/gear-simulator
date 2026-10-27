import { GEAR_SIZES } from '../constants';
import { axisVector } from '../math/axis';
import { add, scale, type Vec3 } from '../math/vec3';
import type { Axis, Gear } from './types';

// 歯車の中心 = シャフトの原点 + (offset + 歯幅/2) × 軸（design.md §4）
export function gearCenter(
  shaftOrigin: Vec3,
  axis: Axis,
  gear: Pick<Gear, 'size' | 'offset'>,
): Vec3 {
  const { faceWidth } = GEAR_SIZES[gear.size];
  return add(shaftOrigin, scale(axisVector(axis), gear.offset + faceWidth / 2));
}
