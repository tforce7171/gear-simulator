import { MOTOR_SIZES } from '../constants';
import type { Motor, MotorId, Scene, ShaftId } from '../scene/types';
import type { MeshGraph } from './graph';
import {
  type Matrix,
  multiply,
  multiplyVector,
  nullSpace,
  solveParticular,
  transpose,
} from './linalg';
import { motorTorque, rpmToRadPerSec } from './motor';

// 力のつり合い（design.md §6）。シャフトに働くトルクは b − D ω（D・b はそのシャフトの ON のモーターの和）。
// ω = N q を代入し、仮想仕事の原理から (Nᵀ D N) q = Nᵀ b を解く

export interface ShaftDrive {
  readonly damping: number; // D_s = Σ T_stall / ω0
  readonly bias: number; // b_s = Σ T_stall · d
}

const NO_DRIVE: ShaftDrive = { damping: 0, bias: 0 };

// 1 つの成分を解く。basis は S1-05 の KinematicComponent.basis（行 = シャフト、列 = 自由度）、
// drives はその行の順。解が一意でないときは、解のうち ω の二乗和 |N q|² が最小のものを取る
// （q の最小ノルムではない。N の基底の取り方に結果が左右されないように）
export function solveBalance(
  basis: Matrix,
  drives: readonly ShaftDrive[],
): { q: number[]; omegas: number[] } {
  if (drives.length !== basis.length) throw new RangeError('drives の長さが basis の行数と違う');
  const dof = basis[0]?.length ?? 0;
  if (dof === 0) return { q: [], omegas: basis.map(() => 0) };

  const nT = transpose(basis, dof);
  const dN = basis.map((row, s) => row.map((v) => v * (drives[s] as ShaftDrive).damping));
  const a = multiply(nT, dN, dof); // Nᵀ D N
  const r = multiplyVector(
    nT,
    drives.map((d) => d.bias),
  ); // Nᵀ b

  // 一般解 q = q_p + Z z。|N (q_p + Z z)|² を z について最小にする:
  // (Zᵀ G Z) z = −Zᵀ G q_p（G = Nᵀ N。N の列は独立なので Zᵀ G Z は正則）
  let q = solveParticular(a, r, dof);
  const z = nullSpace(a, dof);
  const free = z[0]?.length ?? 0;
  if (free > 0) {
    const g = multiply(nT, basis, dof);
    const zT = transpose(z, free);
    const zTg = multiply(zT, g, dof);
    const m = multiply(zTg, z, free);
    const rhs = multiplyVector(zTg, q).map((v) => -v);
    const y = solveParticular(m, rhs, free);
    const shift = multiplyVector(z, y);
    q = q.map((v, i) => v + (shift[i] as number));
  }
  return { q, omegas: multiplyVector(basis, q) };
}

export interface BalanceResult {
  readonly omegas: Record<ShaftId, number>; // シーンの全シャフト
  readonly motorTorques: Record<MotorId, number>; // ON のモーターだけ。解の ω でのトルク
  readonly componentQ: number[][]; // graph.components と同じ順の q
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// シーンの全成分を解く。OFF のモーターは無いものとして扱い、paused なら全モーターを OFF とみなす。
// 自由度 0 の成分とモーターの無い成分は ω = 0。ロックの判定はしない（S1-07）
export function solveVelocities(
  scene: Scene,
  graph: MeshGraph,
  options: { paused?: boolean } = {},
): BalanceResult {
  const motors: Motor[] =
    options.paused === true
      ? []
      : Object.values(scene.motors)
          .filter((m) => m.on)
          .sort((x, y) => compareIds(x.id, y.id));

  const drives = new Map<ShaftId, ShaftDrive>();
  for (const motor of motors) {
    const stall = MOTOR_SIZES[motor.size].stallTorque;
    const prev = drives.get(motor.shaftId) ?? NO_DRIVE;
    drives.set(motor.shaftId, {
      damping: prev.damping + stall / rpmToRadPerSec(motor.rpm),
      bias: prev.bias + stall * motor.direction,
    });
  }

  const omegas: Record<ShaftId, number> = {};
  for (const shaftId of Object.keys(scene.shafts)) omegas[shaftId] = 0;

  const componentQ = graph.components.map((component) => {
    const solved = solveBalance(
      component.basis,
      component.shaftIds.map((id) => drives.get(id) ?? NO_DRIVE),
    );
    component.shaftIds.forEach((id, i) => {
      omegas[id] = solved.omegas[i] as number;
    });
    return solved.q;
  });

  const motorTorques: Record<MotorId, number> = {};
  for (const motor of motors)
    motorTorques[motor.id] = motorTorque(motor, omegas[motor.shaftId] ?? 0);

  return { omegas, motorTorques, componentQ };
}
