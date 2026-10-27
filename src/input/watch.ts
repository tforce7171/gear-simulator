// 眺めるモードの周回（S1-14）。純粋関数のみ

export const WATCH_AZIMUTH_SPEED = (2 * Math.PI) / 60; // rad/s（1 分で 1 周）
export const WATCH_RESUME_DELAY_MS = 2000; // 最後の操作から再開するまで

// このフレームで方位角を何ラジアン回すか。最後のユーザーの操作から WATCH_RESUME_DELAY_MS のあいだは 0
export function watchAzimuthDelta(
  dtSec: number,
  nowMs: number,
  lastUserInputMs: number | null,
): number {
  if (lastUserInputMs !== null && nowMs - lastUserInputMs < WATCH_RESUME_DELAY_MS) return 0;
  return WATCH_AZIMUTH_SPEED * Math.max(dtSec, 0);
}
