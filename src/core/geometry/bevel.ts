import { GEAR_SIZES } from '../constants';
import { axisFrame, axisVector, stepAxis } from '../math/axis';
import { add, cross, dot, scale, sub, type Vec3 } from '../math/vec3';
import type { Axis, SizeKey } from '../scene/types';
import { pitchRadius, toothPitchAngle } from './mesh';

// かさ歯車の幾何（S2-02。design.md §4・§5）。交わる角度は 90°、歯数比 1:1（ピッチ円すい角 45°）のみ。
// R は大端のピッチ円半径 m·z/2、円すい距離（頂点から大端のピッチ円までの母線の長さ）は R·√2。
// かさ歯車は大きさの歯幅の区画を占め、大端の中心は区画の、頂点と反対側の面にある

export const BEVEL_COS = Math.SQRT1_2; // cos 45°

type BevelLike = { readonly size: SizeKey; readonly teeth: number; readonly apex: 1 | -1 };

// 円すい距離 R·√2
export function bevelConeDistance(size: SizeKey, teeth: number): number {
  return pitchRadius(size, teeth) * Math.SQRT2;
}

// 歯の幅 b（母線に沿った長さ）= min(大きさの歯幅, 円すい距離 / 3)。軸方向には b·cos45° を占める
export function bevelToothWidth(size: SizeKey, teeth: number): number {
  return Math.min(GEAR_SIZES[size].faceWidth, bevelConeDistance(size, teeth) / 3);
}

// 区画の中心 → 大端の中心（区画の、頂点と反対側の面）
export function bevelBigEndCenter(center: Vec3, axis: Axis, apex: 1 | -1, faceWidth: number): Vec3 {
  return sub(center, scale(axisVector(axis), (apex * faceWidth) / 2));
}

// 大端の中心 → ピッチ円すいの頂点
export function bevelApex(bigEndCenter: Vec3, axis: Axis, apex: 1 | -1, pitchRadius: number): Vec3 {
  return add(bigEndCenter, scale(axisVector(axis), apex * pitchRadius));
}

// 区画の中心と歯車から、大端の中心
export function bevelBigEndOf(center: Vec3, axis: Axis, gear: BevelLike): Vec3 {
  return bevelBigEndCenter(center, axis, gear.apex, GEAR_SIZES[gear.size].faceWidth);
}

// 区画の中心と歯車から、ピッチ円すいの頂点
export function bevelApexOf(center: Vec3, axis: Axis, gear: BevelLike): Vec3 {
  return bevelApex(
    bevelBigEndOf(center, axis, gear),
    axis,
    gear.apex,
    pitchRadius(gear.size, gear.teeth),
  );
}

// 干渉判定の円柱（歯のある円すい台に外接する円柱）。大端の中心から頂点の側へ b·cos45° の長さ、
// 半径は大端の歯先 R + m·cos45°
export function bevelCollisionCylinder(
  center: Vec3,
  axis: Axis,
  gear: BevelLike,
): { center: Vec3; radius: number; halfWidth: number } {
  const { module } = GEAR_SIZES[gear.size];
  const bigEnd = bevelBigEndOf(center, axis, gear);
  const length = bevelToothWidth(gear.size, gear.teeth) * BEVEL_COS;
  return {
    center: add(bigEnd, scale(axisVector(axis), (gear.apex * length) / 2)),
    radius: pitchRadius(gear.size, gear.teeth) + module * BEVEL_COS,
    halfWidth: length / 2,
  };
}

// 'bevel' の配置の子の向きと大端の中心（S2-02）。
// 子の軸 = stepAxis(親の軸, axisStep)、子の大端の中心 = 親の大端の中心 + R·side·(子の軸) + R·親の apex·(親の軸)、
// 子の apex = −side（親の頂点を向く。2 枚の頂点は一致する）
export function bevelChildFrame(
  parentBigEnd: Vec3,
  parentAxis: Axis,
  parentApex: 1 | -1,
  radius: number,
  axisStep: 1 | 2,
  side: 1 | -1,
): { axis: Axis; bigEnd: Vec3; apex: 1 | -1 } {
  const axis = stepAxis(parentAxis, axisStep);
  const bigEnd = add(
    parentBigEnd,
    add(scale(axisVector(axis), radius * side), scale(axisVector(parentAxis), radius * parentApex)),
  );
  return { axis, bigEnd, apex: side === 1 ? -1 : 1 };
}

// 子の offset を 0 としたときのシャフトの原点。子の大端の中心 = 原点 + (歯幅/2)·(1 + side)·軸
export function bevelChildOrigin(bigEnd: Vec3, axis: Axis, side: 1 | -1, faceWidth: number): Vec3 {
  return sub(bigEnd, scale(axisVector(axis), (faceWidth / 2) * (1 + side)));
}

// 軸まわりの方向 d の角度（radialDirection の逆）
export function angleAroundAxis(axis: Axis, d: Vec3): number {
  const { u, v } = axisFrame(axis);
  return Math.atan2(dot(d, v), dot(d, u));
}

function wrap(x: number, period: number): number {
  const r = x - Math.floor(x / period) * period;
  return r >= period ? r - period : r;
}

// 歯の並びの中での、軸まわりの角度 angle の位置（歯 1 ピッチを 1 とした端数、0〜1。0 が歯の中心）
export function toothFraction(phase: number, teeth: number, angle: number): number {
  const raw = ((angle - phase) * teeth) / (2 * Math.PI);
  return raw - Math.floor(raw);
}

// 2 つのかさ歯車（頂点が一致し、軸が直交する組）の大端のピッチ円の接点 P。
// a の大端の中心から、b の大端の中心へのベクトルの b の軸の成分だけ進んだ点
export function bevelContactPoint(
  a: { readonly bigEnd: Vec3 },
  b: { readonly axis: Axis; readonly bigEnd: Vec3 },
): Vec3 {
  const eB = axisVector(b.axis);
  return add(a.bigEnd, scale(eB, dot(sub(b.bigEnd, a.bigEnd), eB)));
}

// 'bevel' の配置の子の basePhase（[0, 2π/z)）。接点 P で、親の歯の中心と子の歯溝の中心が重なるようにする。
// P での周速の向き t = e × (P − 大端の中心) が親子で同じなら、子の端数 = 親の端数 + 1/2、
// 逆なら 1/2 − 親の端数（歯の並ぶ向きが逆になるため。平歯車の meshPhase と同じ考え方）
export function bevelPhase(
  parentPhase: number,
  parent: { readonly axis: Axis; readonly bigEnd: Vec3 },
  child: { readonly axis: Axis; readonly bigEnd: Vec3 },
  teeth: number,
): number {
  const p = bevelContactPoint(parent, child);
  const fromA = sub(p, parent.bigEnd);
  const fromB = sub(p, child.bigEnd);
  const tA = cross(axisVector(parent.axis), fromA);
  const tB = cross(axisVector(child.axis), fromB);
  const fA = toothFraction(parentPhase, teeth, angleAroundAxis(parent.axis, fromA));
  const fB = dot(tA, tB) > 0 ? fA + 0.5 : 0.5 - fA;
  const pitch = toothPitchAngle(teeth);
  return wrap(angleAroundAxis(child.axis, fromB) - pitch * fB, pitch);
}
