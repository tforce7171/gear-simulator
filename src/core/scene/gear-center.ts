import { sectionWidth } from '../geometry/dimensions';
import { axisVector } from '../math/axis';
import { add, scale, type Vec3 } from '../math/vec3';
import type { Axis, Gear } from './types';

// 歯車の中心 = シャフトの原点 + (offset + 区画の幅/2) × 軸（design.md §4）。
// 区画の幅は歯幅（ウォームは長さを AXIAL_SNAP の倍数に切り上げた値。S2-03）
export function gearCenter(
  shaftOrigin: Vec3,
  axis: Axis,
  gear: Pick<Gear, 'kind' | 'size' | 'offset'>,
): Vec3 {
  return add(shaftOrigin, scale(axisVector(axis), gear.offset + sectionWidth(gear) / 2));
}
