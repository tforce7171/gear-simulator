import type { PartColor } from './types';

// 部品ごとの色（S5-04）の一覧と判定。テーマの系統と色の対応は core/theme.ts の THEME_PART_COLORS、
// 色ごとの質感は render/themes.ts の PART_COLOR_MATERIALS

// Record にして、色を足したときの書き忘れを型で検出する（並びはプロパティパネルの色見本の順）
const PART_COLOR_SET: Readonly<Record<PartColor, true>> = {
  brass: true,
  silver: true,
  metallicBlue: true,
  wood: true,
  darkOak: true,
};

export const PART_COLORS: readonly PartColor[] = Object.keys(PART_COLOR_SET) as PartColor[];

export function isPartColor(x: unknown): x is PartColor {
  return typeof x === 'string' && Object.hasOwn(PART_COLOR_SET, x);
}

// 生やした部品が元の部品の色を引き継ぐときに、部品のフィールドへ広げる値（色が無ければ何も足さない）
export function inheritedColor(from: { readonly color?: PartColor }): {
  readonly color?: PartColor;
} {
  return from.color === undefined ? {} : { color: from.color };
}
