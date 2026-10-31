import { GEAR_SIZES } from '../constants';
import { assertNever } from '../scene/gear-shape';
import type { GearShape, SizeKey } from '../scene/types';

// 形状データ（BufferGeometry）を共有するためのキー（design.md §7）。
// (種類, 大きさ, 歯数, 形を変える属性)。ハスバ歯車では hand を含める。
// かさ歯車の apex は描画の向き（ローカルの z の反転）で表すので含めない（S2-02）。
// ウォームは (種類, 大きさ)、ホイールは (種類, 大きさ, 歯数)（S2-03）。ねじ歯車は (種類, 大きさ, 歯数)（S2-04）。
// 内歯車は (種類, 大きさ, 歯数)。webSide は描画の向きで表す（S3-02）。
// 厚さ width（S4-05）が大きさごとの歯幅と違えば、末尾に `:w厚さ` を足す（省くか同じなら前と同じキー）
export function gearShapeKey(
  shape: GearShape,
  size: SizeKey,
  teeth: number,
  width: number = GEAR_SIZES[size].faceWidth,
): string {
  const base = baseShapeKey(shape, size, teeth);
  return width === GEAR_SIZES[size].faceWidth ? base : `${base}:w${width}`;
}

function baseShapeKey(shape: GearShape, size: SizeKey, teeth: number): string {
  switch (shape.kind) {
    case 'spur':
      return `spur:${size}:${teeth}`;
    case 'helical':
      return `helical:${size}:${teeth}:${shape.hand}`;
    case 'bevel':
      return `bevel:${size}:${teeth}`;
    case 'worm':
      // ウォームの形は大きさだけで決まる（条数は常に 1。S2-03）
      return `worm:${size}`;
    case 'wormWheel':
      return `wormWheel:${size}:${teeth}`;
    case 'crossedHelical':
      // ねじれ角・向きは固定（S2-04）
      return `crossedHelical:${size}:${teeth}`;
    case 'internal':
      // webSide は描画の向き（ローカルの z の反転）で表すので含めない（S3-02）
      return `internal:${size}:${teeth}`;
    default:
      return assertNever(shape);
  }
}
