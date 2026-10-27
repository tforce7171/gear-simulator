// 形状データ（BufferGeometry）を共有するためのキー（design.md §7）
export type GearKind = 'spur';

// size は S1-03 で SizeKey に差し替える
export function gearShapeKey(kind: GearKind, size: 'S' | 'M' | 'L', teeth: number): string {
  return `${kind}:${size}:${teeth}`;
}
