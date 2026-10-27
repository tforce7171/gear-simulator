import { describe, expect, it } from 'vitest';
import { WATCH_AZIMUTH_SPEED, WATCH_RESUME_DELAY_MS, watchAzimuthDelta } from './watch';

describe('watchAzimuthDelta', () => {
  it('1 分で 1 周、操作から 2 秒で再開する', () => {
    expect(WATCH_AZIMUTH_SPEED).toBeCloseTo((2 * Math.PI) / 60, 12);
    expect(WATCH_RESUME_DELAY_MS).toBe(2000);
  });

  it('入力なしで dt 0.5 → WATCH_AZIMUTH_SPEED × 0.5', () => {
    expect(watchAzimuthDelta(0.5, 10_000, null)).toBeCloseTo(WATCH_AZIMUTH_SPEED * 0.5, 12);
  });

  it('最後の入力から 1000ms → 0', () => {
    expect(watchAzimuthDelta(0.5, 11_000, 10_000)).toBe(0);
  });

  it('最後の入力から 2000ms 以上 → 再び正の値', () => {
    expect(watchAzimuthDelta(0.5, 12_000, 10_000)).toBeGreaterThan(0);
    expect(watchAzimuthDelta(0.5, 15_000, 10_000)).toBeCloseTo(WATCH_AZIMUTH_SPEED * 0.5, 12);
  });
});
