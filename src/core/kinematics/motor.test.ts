import { describe, expect, it } from 'vitest';
import type { Motor } from '../scene/types';
import { motorTorque, radPerSecToRpm, rpmToRadPerSec } from './motor';

function motor(patch: Partial<Motor>): Motor {
  return {
    id: 'motor_1',
    shaftId: 'shaft_a',
    size: 'S',
    rpm: 60,
    direction: 1,
    on: true,
    ...patch,
  };
}

describe('rpm と rad/s の換算', () => {
  it('60rpm = 2π rad/s、往復で戻る', () => {
    expect(rpmToRadPerSec(60)).toBeCloseTo(2 * Math.PI, 12);
    expect(radPerSecToRpm(Math.PI)).toBeCloseTo(30, 12);
    expect(radPerSecToRpm(rpmToRadPerSec(17.5))).toBeCloseTo(17.5, 12);
  });
});

describe('motorTorque', () => {
  it('S、60rpm、direction 1', () => {
    const m = motor({});
    expect(motorTorque(m, 0)).toBeCloseTo(1, 10);
    expect(motorTorque(m, Math.PI)).toBeCloseTo(0.5, 10);
    expect(motorTorque(m, 2 * Math.PI)).toBeCloseTo(0, 10);
    expect(motorTorque(m, -2 * Math.PI)).toBeCloseTo(2, 10);
  });

  it('direction −1 で ω = 0 → −1', () => {
    expect(motorTorque(motor({ direction: -1 }), 0)).toBeCloseTo(-1, 10);
  });

  it('L、15rpm、ω = 0 → 10', () => {
    expect(motorTorque(motor({ size: 'L', rpm: 15 }), 0)).toBeCloseTo(10, 10);
  });
});
