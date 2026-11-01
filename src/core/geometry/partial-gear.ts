import type { GearShape } from '../scene/types';

// 欠け歯車（S5-05。design.md §4・§5）。平歯車の toothCount（残す歯数）と toothStart（歯のある弧の始まりの歯）。
// 歯 toothStart から toothCount 個（歯数で折り返す）を残し、ほかは歯底円の弧にする

export interface ToothArc {
  readonly count: number; // 残す歯数（1〜teeth − 1）
  readonly start: number; // 始まりの歯の番号（0〜teeth − 1）
}

// 残す歯の弧。普通の歯車（平歯車でない・toothCount を省いた・teeth 以上）は null
export function toothArcOf(shape: GearShape, teeth: number): ToothArc | null {
  if (shape.kind !== 'spur') return null;
  const count = shape.toothCount;
  if (count === undefined || count >= teeth) return null;
  const start = shape.toothStart ?? 0;
  return { count, start: ((start % teeth) + teeth) % teeth };
}

// 歯 j が残っているか（arc が null なら常に真）
export function hasTooth(arc: ToothArc | null, teeth: number, j: number): boolean {
  if (arc === null) return true;
  return (((j - arc.start) % teeth) + teeth) % teeth < arc.count;
}

// 歯数を変えたときに、2 つの欄を新しい歯数の範囲に収める（S5-05）。toothCount は 1〜teeth、toothStart は 0〜teeth − 1
export function clampToothArc(
  toothCount: number | undefined,
  toothStart: number | undefined,
  teeth: number,
): { toothCount?: number; toothStart?: number } {
  return {
    ...(toothCount === undefined ? {} : { toothCount: Math.min(Math.max(1, toothCount), teeth) }),
    ...(toothStart === undefined
      ? {}
      : { toothStart: Math.min(Math.max(0, toothStart), teeth - 1) }),
  };
}
