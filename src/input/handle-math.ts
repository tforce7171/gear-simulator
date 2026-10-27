import { AXIAL_SNAP } from '../core/constants';
import { axisFrame } from '../core/math/axis';
import { dot, sub, type Vec3 } from '../core/math/vec3';
import type { Axis } from '../core/scene/types';
import { snap } from './placement';

// ハンドルのドラッグの計算（S1-19。S1-21 の手で回すも angleAroundAxis・unwrapDelta を使う）。
// 純粋関数のみで、three と DOM に触れない

// rad。かみ合いへの吸着の範囲（UI だけで使う）
export const ARC_MESH_SNAP = (5 * Math.PI) / 180;

const TWO_PI = 2 * Math.PI;

// 2 直線がほぼ平行とみなすしきい値（向きのなす角の sin²）
const PARALLEL_SIN2 = 1e-6;
// 接する（解が 1 つ）とみなす cos の誤差
const TANGENT_EPS = 1e-9;
// 相手の中心が親の軸上にあるとみなす距離（mm）
const ON_AXIS_EPS = 1e-9;

// [0, 2π) に正規化する
function normalize(angle: number): number {
  const r = angle - Math.floor(angle / TWO_PI) * TWO_PI;
  return r >= TWO_PI ? 0 : r + 0;
}

// 2 つの角度の、2π の折り返しを考えた差の絶対値（0〜π）
function angularDistance(a: number, b: number): number {
  const d = normalize(a - b);
  return Math.min(d, TWO_PI - d);
}

// 軸 axis（中心 center）まわりの、点 p の角度。基準は S1-09 の angle と同じ
// （cos(angle)·u + sin(angle)·v の向き）。[0, 2π)
export function angleAroundAxis(p: Vec3, center: Vec3, axis: Axis): number {
  const { u, v } = axisFrame(axis);
  const d = sub(p, center);
  return normalize(Math.atan2(dot(d, v), dot(d, u)));
}

// 前回の角度から今回の角度への変化量を −π〜π に巻き戻す
export function unwrapDelta(prev: number, next: number): number {
  const d = normalize(next - prev);
  return d > Math.PI ? d - TWO_PI : d;
}

// stepRad の倍数のうち最も近いもの
export function snapAngle(angle: number, stepRad: number): number {
  return snap(angle, stepRad);
}

// レイに最も近い、直線（origin + t·dir）上の点のパラメーター t。ほぼ平行なら null。
// 2 直線の最近点: a = L·L、b = L·R、c = R·R、w = lineOrigin − rayOrigin、d = L·w、e = R·w のとき
// t = (b·e − c·d) / (a·c − b²)
export function closestParamOnLine(
  rayOrigin: Vec3,
  rayDir: Vec3,
  lineOrigin: Vec3,
  lineDir: Vec3,
): number | null {
  const a = dot(lineDir, lineDir);
  const b = dot(lineDir, rayDir);
  const c = dot(rayDir, rayDir);
  const denom = a * c - b * b;
  if (a === 0 || c === 0 || denom <= PARALLEL_SIN2 * a * c) return null;
  const w = sub(lineOrigin, rayOrigin);
  const d = dot(lineDir, w);
  const e = dot(rayDir, w);
  return (b * e - c * d) / denom;
}

// 開始時の offset に、軸方向の移動量を AXIAL_SNAP の単位に丸めて足す
export function axialOffsetFromDrag(startOffset: number, deltaAlongAxis: number): number {
  return startOffset + snap(deltaAlongAxis, AXIAL_SNAP) + 0;
}

// 親の中心 parentCenter・軸 axis のまわりを半径 radius（中心距離）で回る子（ピッチ円半径 childPitchRadius）が、
// targets のどれかとちょうどかみ合う角度の一覧（S1-09 の angle の定義、[0, 2π)、昇順）。
// target の中心は親の面に射影して扱う。中心が親の軸上にある相手（どの角度でも距離が同じ）は吸着先を出さない
export function meshSnapAngles(
  parentCenter: Vec3,
  axis: Axis,
  radius: number,
  childPitchRadius: number,
  targets: ReadonlyArray<{ center: Vec3; pitchRadius: number }>,
): number[] {
  const { u, v } = axisFrame(axis);
  const angles: number[] = [];
  for (const target of targets) {
    const d = sub(target.center, parentCenter);
    const x = dot(d, u);
    const y = dot(d, v);
    const r = Math.hypot(x, y);
    if (r <= ON_AXIS_EPS || radius <= 0) continue;
    const phi = Math.atan2(y, x);
    const want = childPitchRadius + target.pitchRadius;
    // 余弦定理: want² = radius² + r² − 2·radius·r·cos(α − φ)
    const cos = (radius * radius + r * r - want * want) / (2 * radius * r);
    if (cos > 1 + TANGENT_EPS || cos < -1 - TANGENT_EPS) continue;
    if (Math.abs(cos) >= 1 - TANGENT_EPS) {
      angles.push(normalize(cos > 0 ? phi : phi + Math.PI));
      continue;
    }
    const delta = Math.acos(cos);
    angles.push(normalize(phi - delta), normalize(phi + delta));
  }
  return angles.sort((a, b) => a - b);
}

// angle から range 以内（2π の折り返しを考える）で最も近い吸着の角度。無ければ null
export function nearestSnapAngle(
  angle: number,
  snapAngles: readonly number[],
  range: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const s of snapAngles) {
    const d = angularDistance(angle, s);
    if (d <= range && d < bestDistance) {
      best = s;
      bestDistance = d;
    }
  }
  return best;
}

// 連続値の角度 from から to へ動いたときに、間で通り過ぎた吸着の角度（両端は除く）を、通った順に
// from・to と同じ連続値（巻き数込み）で返す。1 回のポインターの移動で吸着の範囲を飛び越えても、
// 通ってきた吸着の角度で止まれるようにするため
export function crossedSnapAngles(
  from: number,
  to: number,
  snapAngles: readonly number[],
): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const crossed: number[] = [];
  for (const s of snapAngles) {
    for (let k = Math.ceil((lo - s) / TWO_PI); s + k * TWO_PI < hi; k++) {
      const value = s + k * TWO_PI;
      if (value > lo) crossed.push(value);
    }
  }
  return crossed.sort((a, b) => (from < to ? a - b : b - a));
}
