// 小さな密行列の線形代数（design.md §6 の拘束行列 C と零空間の基底 N に使う）

export type Matrix = number[][]; // 行の配列

// 階数の判定の既定の相対しきい値。係数は歯数（整数）なので、丸め誤差よりずっと大きく、
// 意味のある差（矛盾）よりずっと小さい値にする
export const DEFAULT_REL_TOL = 1e-9;

interface Echelon {
  readonly rows: Matrix; // 行階段形。pivotColumns.length 本
  readonly pivotColumns: number[]; // 昇順
  readonly freeColumns: number[]; // 昇順
}

// 部分ピボット選択つきのガウスの消去で行階段形にする。ピボットは左の列から貪欲に取るので、
// ピボットの列は「それより左の列と独立な列」、自由な列はその残りになる
function echelon(a: Matrix, columns: number, relTol: number): Echelon {
  const m = a.map((row) => {
    if (row.length !== columns) throw new RangeError('行の長さが columns と違う');
    return [...row];
  });
  let maxAbs = 0;
  for (const row of m) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
  const tol = relTol * maxAbs;

  const pivotColumns: number[] = [];
  const freeColumns: number[] = [];
  let r = 0;
  for (let c = 0; c < columns; c++) {
    let best = -1;
    let bestAbs = tol;
    for (let i = r; i < m.length; i++) {
      const v = Math.abs(m[i]?.[c] ?? 0);
      if (v > bestAbs) {
        best = i;
        bestAbs = v;
      }
    }
    if (best < 0) {
      freeColumns.push(c);
      continue;
    }
    const pivotRow = m[best] as number[];
    m[best] = m[r] as number[];
    m[r] = pivotRow;
    const p = pivotRow[c] as number;
    for (let i = r + 1; i < m.length; i++) {
      const row = m[i] as number[];
      const f = (row[c] as number) / p;
      if (f === 0) continue;
      for (let j = c; j < columns; j++) row[j] = (row[j] as number) - f * (pivotRow[j] as number);
      row[c] = 0;
    }
    pivotColumns.push(c);
    r++;
  }
  return { rows: m.slice(0, r), pivotColumns, freeColumns };
}

// a の零空間の基底を、列ベクトルを並べた行列（行数 = columns、列数 = 零空間の次元）で返す。
// 自由な列（左の列と従属な列）が基底の単位行列の行になる: 基底の j 列目は、
// j 番目の自由な列の成分が 1、他の自由な列の成分が 0
export function nullSpaceWithFreeColumns(
  a: Matrix,
  columns: number,
  relTol: number = DEFAULT_REL_TOL,
): { basis: Matrix; freeColumns: number[] } {
  const { rows, pivotColumns, freeColumns } = echelon(a, columns, relTol);
  const basis: Matrix = Array.from({ length: columns }, () =>
    new Array<number>(freeColumns.length).fill(0),
  );
  freeColumns.forEach((free, k) => {
    const x = new Array<number>(columns).fill(0);
    x[free] = 1;
    for (let i = pivotColumns.length - 1; i >= 0; i--) {
      const row = rows[i] as number[];
      const pc = pivotColumns[i] as number;
      let sum = 0;
      for (let j = pc + 1; j < columns; j++) sum += (row[j] as number) * (x[j] as number);
      x[pc] = -sum / (row[pc] as number);
    }
    for (let j = 0; j < columns; j++) (basis[j] as number[])[k] = x[j] as number;
  });
  return { basis, freeColumns };
}

// a の零空間の基底を、列ベクトルを並べた行列（行数 = a の列数）で返す
export function nullSpace(a: Matrix, columns: number, relTol?: number): Matrix {
  return nullSpaceWithFreeColumns(a, columns, relTol).basis;
}

export function rank(a: Matrix, columns: number, relTol: number = DEFAULT_REL_TOL): number {
  return echelon(a, columns, relTol).pivotColumns.length;
}
