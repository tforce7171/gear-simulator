import { describe, expect, it } from 'vitest';
import { GEAR_SIZES, MOTOR_RPM_RANGE, MOTOR_SIZES, PRESSURE_ANGLE } from './constants';

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
});
