// 作品のサムネイルと名前の計算（S1-27）。画は描かず、数だけを求める

// 幅 w・高さ h のキャンバスの中央から切り出す正方形（短いほうの辺に合わせる）
export function centerSquareCrop(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h);
  return { sx: Math.floor((w - size) / 2), sy: Math.floor((h - size) / 2), size };
}

// 既存の名前と重ならない「<base> <n>」の最小の n（1 から）。base は t('work.defaultName')
export function nextDefaultWorkName(existing: readonly string[], base: string): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}
