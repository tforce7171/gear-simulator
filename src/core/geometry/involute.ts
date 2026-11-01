import { PRESSURE_ANGLE } from '../constants';
import { hasTooth, type ToothArc } from './partial-gear';

// 平歯車の 2D の歯形（要件 §3.2、§8）。
// 向きの取り決め（design.md §5）: 歯車の中心が原点、0 番目の歯の中心線が +x 軸に乗り、
// 点は反時計回りに並ぶ。最後の点で最初の点を繰り返さない。

export type Vec2 = readonly [number, number];

export interface SpurDimensions {
  module: number;
  teeth: number;
  pitchRadius: number;
  baseRadius: number;
  addendumRadius: number; // 歯先円
  dedendumRadius: number; // 歯底円
}

export function spurDimensions(module: number, teeth: number): SpurDimensions {
  const pitchRadius = (module * teeth) / 2;
  return {
    module,
    teeth,
    pitchRadius,
    baseRadius: pitchRadius * Math.cos(PRESSURE_ANGLE),
    addendumRadius: pitchRadius + module,
    dedendumRadius: pitchRadius - 1.25 * module,
  };
}

// インボリュート関数 inv(α) = tan α − α
export function involuteFn(alpha: number): number {
  return Math.tan(alpha) - alpha;
}

// 半径 r（r ≥ r_b）での、歯の中心線から歯面までの角度（歯厚の半分の角度）
// ψ(r) = π/(2z) + inv(PRESSURE_ANGLE) − inv(acos(r_b / r))
export function toothHalfAngleAt(module: number, teeth: number, r: number): number {
  const { baseRadius } = spurDimensions(module, teeth);
  // r = r_b のときに丸め誤差で 1 をわずかに超えないようにする
  const ratio = Math.min(1, baseRadius / r);
  return Math.PI / (2 * teeth) + involuteFn(PRESSURE_ANGLE) - involuteFn(Math.acos(ratio));
}

export interface OutlineOptions {
  flankSegments?: number; // 歯面 1 本を何本の線分で近似するか（初期値 8）
  tipSegments?: number; // 歯先の円弧の分割数（初期値 2）
  rootSegments?: number; // 歯底の円弧の分割数（初期値 3）
  // 欠け歯車（S5-05）。残す歯の弧。省くか null なら全部の歯。外の歯は歯底円の弧にする（点の数は歯のある周期と同じ）
  toothArc?: ToothArc | null;
}

const DEFAULT_FLANK_SEGMENTS = 8;
const DEFAULT_TIP_SEGMENTS = 2;
const DEFAULT_ROOT_SEGMENTS = 3;

function segmentCount(value: number | undefined, fallback: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`${name} は 1 以上の整数: ${n}`);
  }
  return n;
}

function polar(r: number, angle: number): Vec2 {
  return [r * Math.cos(angle), r * Math.sin(angle)];
}

// 閉じた多角形。反時計回り。0 番目の歯が +x 軸の上
export function spurOutline(module: number, teeth: number, options?: OutlineOptions): Vec2[] {
  const flankSegments = segmentCount(
    options?.flankSegments,
    DEFAULT_FLANK_SEGMENTS,
    'flankSegments',
  );
  const tipSegments = segmentCount(options?.tipSegments, DEFAULT_TIP_SEGMENTS, 'tipSegments');
  const rootSegments = segmentCount(options?.rootSegments, DEFAULT_ROOT_SEGMENTS, 'rootSegments');

  const { baseRadius: rb, addendumRadius: ra, dedendumRadius: rf } = spurDimensions(module, teeth);
  // 歯面の半径方向の範囲は max(r_b, r_f) から r_a まで
  const rStart = Math.max(rb, rf);
  const hasRadialLine = rb > rf; // 歯数が少ないとき、基礎円より内側を半径方向の直線で下ろす
  const pitchAngle = (2 * Math.PI) / teeth;
  const halfAngle = (r: number) => toothHalfAngleAt(module, teeth, r);

  // 歯面の半径。インボリュートの展開角 t（r = r_b·√(1+t²)）を等分して、曲がりの強い基礎円の近くを細かくする
  const tStart = Math.sqrt(Math.max(0, (rStart / rb) ** 2 - 1));
  const tEnd = Math.sqrt((ra / rb) ** 2 - 1);
  const flankRadii: number[] = [];
  for (let i = 0; i <= flankSegments; i++) {
    if (i === 0) flankRadii.push(rStart);
    else if (i === flankSegments) flankRadii.push(ra);
    else {
      const t = tStart + ((tEnd - tStart) * i) / flankSegments;
      flankRadii.push(rb * Math.sqrt(1 + t * t));
    }
  }

  const psiStart = halfAngle(rStart); // 歯底円での歯面（または直線）の角度
  const psiTip = halfAngle(ra);

  // 0 番目の歯の 1 周期分。角度 −π/z 付近（手前の歯底）から +ψ(r_start) まで、反時計回り
  const template: [number, number][] = []; // [半径, 角度]
  // 手前の歯底の円弧。1 つ前の歯の歯面の下端（角度 ψ_start − 2π/z）から、この歯の −ψ_start まで。
  // 始点は 1 つ前の歯の周期に含まれるので、ここでは含めない
  const rootFrom = psiStart - pitchAngle;
  const rootTo = -psiStart;
  for (let i = 1; i < rootSegments; i++) {
    template.push([rf, rootFrom + ((rootTo - rootFrom) * i) / rootSegments]);
  }
  // 下側の歯面（中心線より −側）。歯底円から歯先へ
  if (hasRadialLine) template.push([rf, -psiStart]);
  for (const r of flankRadii) template.push([r, -halfAngle(r)]);
  // 歯先の円弧（両端は歯面の点）
  for (let i = 1; i < tipSegments; i++) {
    template.push([ra, -psiTip + (2 * psiTip * i) / tipSegments]);
  }
  // 上側の歯面（中心線より +側）。歯先から歯底円へ
  for (let i = flankSegments; i >= 0; i--) {
    const r = flankRadii[i] as number;
    template.push([r, halfAngle(r)]);
  }
  if (hasRadialLine) template.push([rf, psiStart]);

  // 歯の無い周期（S5-05）: 手前の歯底の円弧の始まり（含めない）から、次の周期の始まり（ψ_start）までの歯底円の弧。
  // 点の数を歯のある周期と同じにして、toothStart を 1 増やすと点の並びも 1 周期ずれるだけにする
  const n = template.length;
  const blank: [number, number][] = [];
  for (let i = 1; i <= n; i++) blank.push([rf, rootFrom + ((psiStart - rootFrom) * i) / n]);

  const arc = options?.toothArc ?? null;
  const out: Vec2[] = [];
  for (let j = 0; j < teeth; j++) {
    const offset = j * pitchAngle;
    const period = hasTooth(arc, teeth, j) ? template : blank;
    for (const [r, angle] of period) out.push(polar(r, angle + offset));
  }
  return out;
}
