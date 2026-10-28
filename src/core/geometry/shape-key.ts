import { assertNever } from '../scene/gear-shape';
import type { GearShape, SizeKey } from '../scene/types';

// 形状データ（BufferGeometry）を共有するためのキー（design.md §7）。
// (種類, 大きさ, 歯数, 形を変える属性)。ハスバ歯車では hand を含める
export function gearShapeKey(shape: GearShape, size: SizeKey, teeth: number): string {
  switch (shape.kind) {
    case 'spur':
      return `spur:${size}:${teeth}`;
    case 'helical':
      return `helical:${size}:${teeth}:${shape.hand}`;
    default:
      return assertNever(shape);
  }
}
