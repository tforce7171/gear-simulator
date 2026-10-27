import type { SizeKey } from '../scene/types';

// 形状データ（BufferGeometry）を共有するためのキー（design.md §7）
export type GearKind = 'spur';

export function gearShapeKey(kind: GearKind, size: SizeKey, teeth: number): string {
  return `${kind}:${size}:${teeth}`;
}
