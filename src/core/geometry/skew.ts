import { axisFrame, axisVector, stepAxis } from '../math/axis';
import { add, cross, dot, length, scale, sub, type Vec3 } from '../math/vec3';
import type { Axis } from '../scene/types';
import { toothPitchAngle } from './mesh';

// ねじれた位置の 90° でかみ合う組の幾何（S2-03。design.md §4・§5・§6）。ウォームとホイールのほか、
// S2-04 のねじ歯車も使うので、種類に依存しない部分（子の位置、s の計算）はここに置く

const AXES: readonly Axis[] = ['x', 'y', 'z'];

// 2 本の（違う）軸のどちらとも直交する 3 本目の座標軸
export function thirdAxis(a: Axis, b: Axis): Axis {
  if (a === b) throw new Error(`thirdAxis: same axis ${a}`);
  return AXES.find((axis) => axis !== a && axis !== b) as Axis;
}

// skew の配置の子の軸と中心。子の軸 = 親の軸を axisStep 回進めた軸、u = 2 本の軸のどちらとも直交する座標軸として
// 子の中心 = 親の中心 + (r_親 + r_子)·side·u（r はピッチ円半径。ウォームは 5m）
export function skewChildFrame(
  parentCenter: Vec3,
  parentAxis: Axis,
  parentRadius: number,
  childRadius: number,
  axisStep: 1 | 2,
  side: 1 | -1,
): { axis: Axis; center: Vec3 } {
  const axis = stepAxis(parentAxis, axisStep);
  const u = axisVector(thirdAxis(parentAxis, axis));
  return { axis, center: add(parentCenter, scale(u, (parentRadius + childRadius) * side)) };
}

// 拘束の符号 s = (e_a × u_ab)·e_b（e は各シャフトの軸の単位ベクトル、u_ab は a の中心から b の中心への単位ベクトル）。
// a と b を入れ替えても変わらない。中心が一致していれば 0
export function skewSign(axisA: Axis, centerA: Vec3, axisB: Axis, centerB: Vec3): number {
  const d = sub(centerB, centerA);
  const len = length(d);
  if (len === 0) return 0;
  return dot(cross(axisVector(axisA), scale(d, 1 / len)), axisVector(axisB));
}

// 軸まわりの、方向 d の角度（design.md §2 の radialDirection の逆）
export function angleAround(axis: Axis, d: Vec3): number {
  const { u, v } = axisFrame(axis);
  return Math.atan2(dot(d, v), dot(d, u));
}

function wrap(x: number, period: number): number {
  const r = x - Math.floor(x / period) * period;
  return r >= period ? r - period : r;
}

interface Placed {
  readonly center: Vec3;
  readonly axis: Axis;
}

// ウォームとホイールの位相の関係（接点でウォームのねじ山の中心とホイールの歯溝の中心が重なる）。
// W = ウォーム、H = ホイール（歯数 z）、n = W の中心から H の中心への単位ベクトル、
// θ_c = n の W の軸まわりの角度、α_c = −n の H の軸まわりの角度、s = (e_W × n)·e_H とすると
//   z·(φ_H − α_c)/2π + 1/2 ≡ s·(θ_c − φ_W)/2π  (mod 1)
// （ウォームのねじ山は回転角 2π で π·m 進み、その向きはホイールの接点での周速の向きの s 倍）。
// 時間で微分すると z·ω_H + s·ω_W = 0 で、拘束の式と一致する
function wormContact(worm: Placed, wheel: Placed): { thetaC: number; alphaC: number; s: number } {
  const d = sub(wheel.center, worm.center);
  return {
    thetaC: angleAround(worm.axis, d),
    alphaC: angleAround(wheel.axis, scale(d, -1)),
    s: skewSign(worm.axis, worm.center, wheel.axis, wheel.center),
  };
}

// ウォームの位相 φ_W からホイールの basePhase を [0, 2π/z) で求める
export function wheelPhaseFromWorm(
  worm: Placed & { readonly phase: number },
  wheel: Placed,
  wheelTeeth: number,
): number {
  const { thetaC, alphaC, s } = wormContact(worm, wheel);
  const pitch = toothPitchAngle(wheelTeeth);
  const fraction = (s * (thetaC - worm.phase)) / (2 * Math.PI) - 0.5;
  return wrap(alphaC + pitch * fraction, pitch);
}

// ホイールの位相 φ_H からウォームの basePhase を [0, 2π) で求める（1 条なので位相の周期は 2π）
export function wormPhaseFromWheel(
  wheel: Placed & { readonly phase: number },
  wheelTeeth: number,
  worm: Placed,
): number {
  const { thetaC, alphaC, s } = wormContact(worm, wheel);
  const fraction = (wheelTeeth * (wheel.phase - alphaC)) / (2 * Math.PI) + 0.5;
  return wrap(thetaC - 2 * Math.PI * s * fraction, 2 * Math.PI);
}

// ねじ歯車の組（S2-04）の位相の関係（接点で親の歯の中心と子の歯溝の中心が重なる）。ウォームとホイールの式の、
// ウォームの条数 1 を親の歯数 z_P に置き換えたもの。P = 親（歯数 z_P、位相 φ_P）、C = 子（歯数 z_C）、
// n = P の中心から C の中心への単位ベクトル、θ_c = n の P の軸まわりの角度、α_c = −n の C の軸まわりの角度、
// s = (e_P × n)·e_C とすると
//   z_C·(φ_C − α_c)/2π + 1/2 ≡ s·z_P·(θ_c − φ_P)/2π  (mod 1)
// （右ねじれ 45° 同士は接点で歯すじが平行にそろい、P の歯 1 つぶんの回転で C が歯 1 つぶん s の向きに進む）。
// 時間で微分すると z_C·ω_C + s·z_P·ω_P = 0 で、拘束の式と一致する。P と C を入れ替えても同じ関係になる
export function crossedHelicalPhase(
  parent: Placed & { readonly phase: number },
  parentTeeth: number,
  child: Placed,
  childTeeth: number,
): number {
  const d = sub(child.center, parent.center);
  const thetaC = angleAround(parent.axis, d);
  const alphaC = angleAround(child.axis, scale(d, -1));
  const s = skewSign(parent.axis, parent.center, child.axis, child.center);
  const pitch = toothPitchAngle(childTeeth);
  const fraction = (s * parentTeeth * (thetaC - parent.phase)) / (2 * Math.PI) - 0.5;
  return wrap(alphaC + pitch * fraction, pitch);
}
