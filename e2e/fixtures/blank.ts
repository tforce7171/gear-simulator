// RGBA の画素列から、輝度の分散がしきい値未満なら「真っ黒・真っ白（一色）」とみなす

/** 輝度（0〜255）の分散のしきい値 */
export const BLANK_VARIANCE_THRESHOLD = 4;

export function luminanceVariance(rgba: Uint8Array | Uint8ClampedArray): number {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    // Rec. 709 の係数
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y;
    sumSq += y * y;
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

export function isBlankImage(rgba: Uint8Array | Uint8ClampedArray): boolean {
  return luminanceVariance(rgba) < BLANK_VARIANCE_THRESHOLD;
}
