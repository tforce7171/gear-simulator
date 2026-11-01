// 数値の入力欄の確定（S1-20）。DOM に触れない純粋関数

// 入力欄の文字列を確定値にする。小数は四捨五入し、範囲外は範囲の端に丸める。
// 数でなければ null（呼び出し側は元の値に戻す）
export function parseClampedInt(text: string, min: number, max: number): number | null {
  return parseClampedStep(text, min, max, 1);
}

// 入力欄の文字列を step の倍数に丸めてから範囲に収める（S5-01。厚さの 0.5 mm 刻み）。
// 数でなければ null。step の倍数を浮動小数で作るので、誤差が残らないように丸め直す
export function parseClampedStep(
  text: string,
  min: number,
  max: number,
  step: number,
): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return clampToStep(value, min, max, step);
}

// value を step の倍数に四捨五入してから範囲に収める（[−][＋] と入力欄で共通）
export function clampToStep(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6)) + 0));
}
