import { MOTOR_SIZES } from '../constants';
import type { Motor } from '../scene/types';

// モーターのトルク（design.md §6）: τ = T_stall · (d − ω / ω0)。ω に対して一次

export function rpmToRadPerSec(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}

export function radPerSecToRpm(omega: number): number {
  return (omega * 60) / (2 * Math.PI);
}

// omega はモーターが付いたシャフトの角速度（rad/s）。on は見ない（呼ぶ側で OFF を除く）
export function motorTorque(motor: Motor, omega: number): number {
  const stall = MOTOR_SIZES[motor.size].stallTorque;
  return stall * (motor.direction - omega / rpmToRadPerSec(motor.rpm));
}
