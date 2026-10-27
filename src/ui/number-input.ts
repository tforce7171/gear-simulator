// 数値の入力欄の確定（S1-20）。DOM に触れない純粋関数

// 入力欄の文字列を確定値にする。小数は四捨五入し、範囲外は範囲の端に丸める。
// 数でなければ null（呼び出し側は元の値に戻す）
export function parseClampedInt(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}
