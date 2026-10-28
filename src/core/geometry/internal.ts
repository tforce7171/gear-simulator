import { GEAR_SIZES, INTERNAL_WEB_GAP, INTERNAL_WEB_THICKNESS } from '../constants';
import type { SizeKey } from '../scene/types';
import { toothHalfAngleAt, type Vec2 } from './involute';
import { pitchRadius } from './mesh';

// 内歯車の寸法と軸方向の範囲（S3-02。design.md §4・§5）。
// R = m·z/2、歯先（内側）R − m、歯底（外側）R + 1.25m、リムの外側 R + 3.25m。
// カップの形: 歯のあるリング（歯幅の区画）の webSide の側に、INTERNAL_WEB_GAP の隙間（外周の薄い筒でつなぐ）をあけて
// ウェブ（円板とボス。軸方向に INTERNAL_WEB_THICKNESS）がある。反対側は開いている

interface InternalLike {
  readonly size: SizeKey;
  readonly offset: number;
  readonly webSide: 1 | -1;
}

// 歯先円（内側）の半径 R − m。中空の円柱の内側の半径
export function internalTipRadius(size: SizeKey, teeth: number): number {
  return pitchRadius(size, teeth) - GEAR_SIZES[size].module;
}

// 歯底円（外側）の半径 R + 1.25m
export function internalRootRadius(size: SizeKey, teeth: number): number {
  return pitchRadius(size, teeth) + 1.25 * GEAR_SIZES[size].module;
}

// リムの外側の半径 R + 3.25m。中空の円柱・つなぎの筒・ウェブの外側の半径
export function internalRimRadius(size: SizeKey, teeth: number): number {
  return pitchRadius(size, teeth) + 3.25 * GEAR_SIZES[size].module;
}

// シャフトの原点からの軸方向の範囲 [lo, hi]（offset と同じ座標）
export type AxialRange = readonly [number, number];

// 歯のあるリング（区画）: [offset, offset + 歯幅]
export function internalRingRange(gear: InternalLike): AxialRange {
  return [gear.offset, gear.offset + GEAR_SIZES[gear.size].faceWidth];
}

// ウェブ（円板とボス）: リングの webSide の側の面から INTERNAL_WEB_GAP 離れた位置から、INTERNAL_WEB_THICKNESS
export function internalWebRange(gear: InternalLike): AxialRange {
  const [lo, hi] = internalRingRange(gear);
  if (gear.webSide === -1) {
    return [lo - INTERNAL_WEB_GAP - INTERNAL_WEB_THICKNESS, lo - INTERNAL_WEB_GAP];
  }
  return [hi + INTERNAL_WEB_GAP, hi + INTERNAL_WEB_GAP + INTERNAL_WEB_THICKNESS];
}

// 中空の部分（リングとつなぎの筒）: リングと、ウェブまでの隙間
export function internalHollowRange(gear: InternalLike): AxialRange {
  const [lo, hi] = internalRingRange(gear);
  return gear.webSide === -1 ? [lo - INTERNAL_WEB_GAP, hi] : [lo, hi + INTERNAL_WEB_GAP];
}

// 内歯車全体（リング・筒・ウェブ）が軸方向に占める範囲。どの端も AXIAL_SNAP の倍数
export function internalExtent(gear: InternalLike): AxialRange {
  const [hollowLo, hollowHi] = internalHollowRange(gear);
  const [webLo, webHi] = internalWebRange(gear);
  return [Math.min(hollowLo, webLo), Math.max(hollowHi, webHi)];
}

// 自分のシャフトが受け持つ範囲: ウェブ（ボス）だけ。シャフトはウェブの外側の面から SHAFT_END_MARGIN 伸び、
// 内側はウェブの内側の面で止まる（中の空洞をシャフトが通らないように。内側に置いた歯車と干渉させない）
export function internalShaftRange(gear: InternalLike): AxialRange {
  return internalWebRange(gear);
}

// x を [0, period) に正規化する
function wrap(x: number, period: number): number {
  const r = x - Math.floor(x / period) * period;
  return r >= period ? r - period : r;
}

// 内歯車と外歯車の木の親子（mesh の配置）の、子の basePhase を [0, 2π/z_子) で返す（S3-02）。
// 接点で、外歯車の歯の中心と内歯車の歯溝の中心が重なるようにする。内歯車の位相 0 は 0 番目の歯（内向き）の中心線が +x。
// 接点の向き β（両方の中心から見て同じ向き）: 親が内歯車なら子のある向き α、親が外歯車なら α + π（子の内歯車は親を囲み、
// 接点は親から見て子の中心と反対側）。接点での歯の位置（ピッチを 1 とした端数）f は、同じ向きに回るので
// f_子 = f_親 + 1/2（歯溝の中心に歯が入る）。φ_子 = β − (2π/z_子)·f_子
export function internalMeshPhase(
  parentPhase: number,
  parentTeeth: number,
  parentIsInternal: boolean,
  childTeeth: number,
  angle: number,
): number {
  const contact = parentIsInternal ? angle : angle + Math.PI;
  const raw = ((contact - parentPhase) * parentTeeth) / (2 * Math.PI);
  const fParent = raw - Math.floor(raw);
  const pitch = (2 * Math.PI) / childTeeth;
  return wrap(contact - pitch * (fParent + 0.5), pitch);
}

// 内歯の 2D 輪郭（S3-02。リングの内側の縁）。外歯車の歯形と同じインボリュートで、歯と歯溝を入れ替えたもの:
// 半径 ρ での歯溝の幅の半分の角度は外歯車の歯厚の半分と同じ ψ(ρ)（toothHalfAngleAt。基礎円より内側は半径方向の直線）。
// 歯溝は歯先（内側 R − m）から歯底（外側 R + 1.25m）へ向かって狭くなる。
// 0 番目の歯（内向き）の中心線が +x、歯溝の中心は (j + 1/2)·2π/z。点は反時計回り、最後の点で最初の点を繰り返さない
export function internalOutline(module: number, teeth: number, flankSegments = 8): Vec2[] {
  const R = (module * teeth) / 2;
  const tip = R - module;
  const root = R + 1.25 * module;
  const pitch = (2 * Math.PI) / teeth;
  // 歯底で溝の幅が 0 にならないように、わずかに残す
  const psi = (r: number) => Math.max(toothHalfAngleAt(module, teeth, r), 0.05 * pitch);
  const radii: number[] = [];
  for (let i = 0; i <= flankSegments; i++) radii.push(tip + ((root - tip) * i) / flankSegments);
  const TIP_SEGMENTS = 3;
  const ROOT_SEGMENTS = 2;
  const out: Vec2[] = [];
  const polar = (r: number, a: number): Vec2 => [r * Math.cos(a), r * Math.sin(a)];
  for (let j = 0; j < teeth; j++) {
    const c = (j + 0.5) * pitch;
    // 歯先の円弧（j 番目の歯。前の溝の縁から、この溝の縁まで。始点は前の周期の終点なので含めない）
    const tipFrom = c - pitch + psi(tip);
    const tipTo = c - psi(tip);
    for (let i = 1; i < TIP_SEGMENTS; i++) {
      out.push(polar(tip, tipFrom + ((tipTo - tipFrom) * i) / TIP_SEGMENTS));
    }
    // 溝の手前側の縁（歯先から歯底へ）
    for (const r of radii) out.push(polar(r, c - psi(r)));
    // 歯底の円弧
    for (let i = 1; i < ROOT_SEGMENTS; i++) {
      out.push(polar(root, c - psi(root) + (2 * psi(root) * i) / ROOT_SEGMENTS));
    }
    // 溝の向こう側の縁（歯底から歯先へ）
    for (let i = radii.length - 1; i >= 0; i--) {
      const r = radii[i] as number;
      out.push(polar(r, c + psi(r)));
    }
  }
  return out;
}
