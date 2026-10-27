import { describe, expect, it } from 'vitest';
import { fitDistance } from './camera-fit';

const FOV = (45 * Math.PI) / 180;

describe('fitDistance', () => {
  it('半径 0 → 0 以上の有限の値', () => {
    const d = fitDistance(0, FOV, 1.5);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
  });
  it('半径を 2 倍にすると距離もほぼ 2 倍', () => {
    const d1 = fitDistance(50, FOV, 1.5);
    const d2 = fitDistance(100, FOV, 1.5);
    expect(d2 / d1).toBeCloseTo(2, 6);
  });
  it('aspect < 1（縦長）では横の視野で決まり、aspect = 1 のときより遠い', () => {
    const square = fitDistance(50, FOV, 1);
    const tall = fitDistance(50, FOV, 0.5);
    expect(tall).toBeGreaterThan(square);
    // 横の視野角 fovX = 2 atan(tan(fovY / 2) · aspect) で決まる
    const fovX = 2 * Math.atan(Math.tan(FOV / 2) * 0.5);
    expect(tall / square).toBeCloseTo(Math.sin(FOV / 2) / Math.sin(fovX / 2), 6);
  });
  it('aspect > 1（横長）では縦の視野で決まり、aspect = 1 のときと同じ', () => {
    expect(fitDistance(50, FOV, 2)).toBeCloseTo(fitDistance(50, FOV, 1), 6);
  });
  it('余白を大きくすると遠くなる', () => {
    expect(fitDistance(50, FOV, 1, 1.5)).toBeGreaterThan(fitDistance(50, FOV, 1, 1));
  });
  it('余白 1 なら球がちょうど視野に接する距離（r / sin(fov/2)）', () => {
    expect(fitDistance(50, FOV, 1, 1)).toBeCloseTo(50 / Math.sin(FOV / 2), 6);
  });
});
