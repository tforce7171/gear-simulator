import { describe, expect, it } from 'vitest';
import {
  COLLISION_EPS,
  DEFAULT_TEETH,
  GEAR_SIZES,
  GRID_SNAP,
  MOTOR_RPM_RANGE,
  MOTOR_SIZES,
  PERIMETER_CANDIDATE_COUNT,
  PRESSURE_ANGLE,
} from './constants';

describe('constants', () => {
  it('GEAR_SIZES.S は要件の値', () => {
    expect(GEAR_SIZES.S).toEqual({ module: 1, faceWidth: 4, minTeeth: 12, maxTeeth: 80 });
  });

  it('GEAR_SIZES.L の最大歯数は 40', () => {
    expect(GEAR_SIZES.L.maxTeeth).toBe(40);
  });

  it('MOTOR_SIZES.M の停動トルクは 3', () => {
    expect(MOTOR_SIZES.M.stallTorque).toBe(3);
  });

  it('MOTOR_RPM_RANGE は 1〜120', () => {
    expect(MOTOR_RPM_RANGE).toEqual({ min: 1, max: 120 });
  });

  it('PRESSURE_ANGLE は 20° をラジアンにしたもの', () => {
    expect(PRESSURE_ANGLE).toBeCloseTo((20 * Math.PI) / 180, 12);
  });

  it('COLLISION_EPS は 1e-6 mm（design.md §3）', () => {
    expect(COLLISION_EPS).toBe(1e-6);
  });

  it('PERIMETER_CANDIDATE_COUNT は 8（design.md §3）', () => {
    expect(PERIMETER_CANDIDATE_COUNT).toBe(8);
  });
});

describe('S1-17 の定数', () => {
  it('DEFAULT_TEETH と GRID_SNAP は design.md §3 の値', () => {
    expect(DEFAULT_TEETH).toEqual({ S: 30, M: 20, L: 16 });
    expect(GRID_SNAP).toBe(5);
  });

  it('DEFAULT_TEETH は各大きさの歯数の範囲に入る', () => {
    for (const size of ['S', 'M', 'L'] as const) {
      expect(DEFAULT_TEETH[size]).toBeGreaterThanOrEqual(GEAR_SIZES[size].minTeeth);
      expect(DEFAULT_TEETH[size]).toBeLessThanOrEqual(GEAR_SIZES[size].maxTeeth);
    }
  });
});
