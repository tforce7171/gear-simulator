import { LOCK_OMEGA_EPS } from '../constants';
import type { Layout } from '../layout/types';
import type { CarrierId, GearId, MotorId, RackId, Scene, ShaftId } from '../scene/types';
import { currentEngagement } from './engagement';
import { speedRatio } from './graph';
import { anchoredMeshGraphOf, meshGraphOf } from './motion';
import type { MotionState } from './types';

// 情報表示の値（S1-23、要件 §7.3）。歯車ごとの rpm・回転方向・ギア比

export interface GearInfo {
  readonly gearId: GearId;
  readonly rpm: number; // 絶対値。|ω| < LOCK_OMEGA_EPS なら 0
  readonly direction: 1 | -1 | 0; // ω の符号（軸の正の向きから見て、正は反時計回り）。止まっていれば 0
  readonly ratio: number | null; // 基準の速度 ÷ この歯車の速度 の絶対値。決まらなければ null
  readonly referenceMotorId: MotorId | null;
  // ウォームの組（S2-05）に入っていれば、その組のギア比（ホイールの歯数 : ウォームの条数）。入っていなければ null
  readonly wormRatio: WormRatio | null;
}

export interface WormRatio {
  readonly wheelTeeth: number;
  readonly threads: number;
}

// 歯車ごとの、ウォームの組のギア比（Layout.meshes の kind 'worm' の順で最初の組）
function wormRatios(scene: Scene, layout: Layout): Map<GearId, WormRatio> {
  const result = new Map<GearId, WormRatio>();
  for (const mesh of layout.meshes) {
    if (mesh.kind !== 'worm') continue;
    const a = scene.gears[mesh.a];
    const b = scene.gears[mesh.b];
    if (a === undefined || b === undefined) continue;
    const worm = a.kind === 'worm' ? a : b;
    const wheel = worm === a ? b : a;
    const ratio = { wheelTeeth: wheel.teeth, threads: worm.teeth };
    for (const id of [mesh.a, mesh.b]) if (!result.has(id)) result.set(id, ratio);
  }
  return result;
}

// ロケールに依らない符号単位の順（決定的にするため）
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const RPM_PER_RAD_PER_SEC = 60 / (2 * Math.PI);

// rpm・向きは運動の解（motion.omegas）から、ギア比は歯数から決まる速度比（S1-05）から求める。
// ギア比はモーターの ON/OFF・一時停止・ロックの止まり方に依らない
export function computeGearInfo(
  scene: Scene,
  layout: Layout,
  motion: MotionState,
): Record<GearId, GearInfo> {
  const worms = wormRatios(scene, layout);
  const result: Record<GearId, GearInfo> = {};
  const ofShaft = shaftInfoOf(scene, layout, motion);
  for (const gear of Object.values(scene.gears)) {
    result[gear.id] = {
      gearId: gear.id,
      ...ofShaft(gear.shaftId),
      wormRatio: worms.get(gear.id) ?? null,
    };
  }
  return result;
}

// シャフトの rpm・向き・ギア比（歯車とキャリアで共通。S3-05）
function shaftInfoOf(
  scene: Scene,
  layout: Layout,
  motion: MotionState,
): (shaftId: ShaftId) => Omit<GearInfo, 'gearId' | 'wormRatio'> {
  // 欠け歯車（S5-05）のかみ合いは、今の角度でかかっている組だけでギア比を求める（欠け歯車が無ければ全部）
  const masks = currentEngagement(scene, layout, motion.angles);
  const graph = meshGraphOf(scene, layout, masks);
  // 固定具（S3-01）で自由度が減ると速度比が決まることがある（S3-03 の遊星歯車など）ので、固定具の拘束を入れた
  // グラフで先に求め、決まらなければ（固定具で止まった成分など）かみ合いだけのグラフで求める
  const anchoredGraph = anchoredMeshGraphOf(scene, layout, masks);
  // 連結成分ごとの基準のモーター: ID の文字列順で最初のもの（ON/OFF は問わない）
  const referenceOf = new Map<number, { motorId: MotorId; shaftId: string }>();
  const motors = Object.values(scene.motors).sort((a, b) => compareIds(a.id, b.id));
  for (const motor of motors) {
    const index = graph.componentOfShaft[motor.shaftId];
    if (index === undefined || referenceOf.has(index)) continue;
    referenceOf.set(index, { motorId: motor.id, shaftId: motor.shaftId });
  }
  return (shaftId) => {
    const omega = motion.omegas[shaftId] ?? 0;
    const moving = Math.abs(omega) >= LOCK_OMEGA_EPS;
    const index = graph.componentOfShaft[shaftId];
    const reference = index === undefined ? undefined : referenceOf.get(index);
    let ratio: number | null = null;
    if (reference !== undefined) {
      // ω_shaft / ω_ref。自由度が 1 でない（矛盾・段階 3 の 2 以上）と null
      const r =
        speedRatio(anchoredGraph, reference.shaftId, shaftId) ??
        speedRatio(graph, reference.shaftId, shaftId);
      ratio = r === null || r === 0 ? null : Math.abs(1 / r);
    }
    return {
      rpm: moving ? Math.abs(omega) * RPM_PER_RAD_PER_SEC : 0,
      direction: moving ? (omega > 0 ? 1 : -1) : 0,
      ratio,
      referenceMotorId: reference?.motorId ?? null,
    };
  };
}

// キャリアの情報（S3-05）: キャリアのシャフトの rpm・向き・ギア比
export interface CarrierInfo {
  readonly carrierId: CarrierId;
  readonly rpm: number;
  readonly direction: 1 | -1 | 0;
  readonly ratio: number | null;
}

export function computeCarrierInfo(
  scene: Scene,
  layout: Layout,
  motion: MotionState,
): Record<CarrierId, CarrierInfo> {
  const ofShaft = shaftInfoOf(scene, layout, motion);
  const result: Record<CarrierId, CarrierInfo> = {};
  for (const carrier of Object.values(scene.carriers)) {
    const { rpm, direction, ratio } = ofShaft(carrier.shaftId);
    result[carrier.id] = { carrierId: carrier.id, rpm, direction, ratio };
  }
  return result;
}

// ラックの速さがこれ未満なら止まっているとみなす（mm/s）
export const RACK_SPEED_EPS = 1e-6;

// ラックの情報（S3-05）: 速さ（mm/s、絶対値）と、動く向き（direction の軸の正・負。止まっていれば 0）
export interface RackInfo {
  readonly rackId: RackId;
  readonly speed: number;
  readonly direction: 1 | -1 | 0;
}

export function computeRackInfo(scene: Scene, motion: MotionState): Record<RackId, RackInfo> {
  const result: Record<RackId, RackInfo> = {};
  for (const rack of Object.values(scene.racks)) {
    const v = motion.rackVelocities[rack.id] ?? 0;
    const moving = Math.abs(v) >= RACK_SPEED_EPS;
    result[rack.id] = {
      rackId: rack.id,
      speed: moving ? Math.abs(v) : 0,
      direction: moving ? (v > 0 ? 1 : -1) : 0,
    };
  }
  return result;
}

// ラックの速さの数（"62.8"。1000 以上は整数。単位は辞書の info.speed で付ける）
export function formatSpeed(speed: number): string {
  const value = Math.abs(speed);
  return Number(value.toFixed(1)) >= 1000 ? String(Math.round(value)) : value.toFixed(1);
}

// 情報を出すキャリアとラック（S3-05。ID の昇順）。ON なら全部、OFF なら選択中のもの
export function visibleInfoPartIds(
  scene: Scene,
  selection: string | null,
  infoOverlay: boolean,
): { carriers: CarrierId[]; racks: RackId[] } {
  if (infoOverlay) {
    return {
      carriers: Object.keys(scene.carriers).sort(compareIds),
      racks: Object.keys(scene.racks).sort(compareIds),
    };
  }
  return {
    carriers: selection !== null && scene.carriers[selection] !== undefined ? [selection] : [],
    racks: selection !== null && scene.racks[selection] !== undefined ? [selection] : [],
  };
}

// "20.0 rpm"。1000 以上は整数で "1235 rpm"
export function formatRpm(rpm: number): string {
  const value = Math.abs(rpm);
  const rounded = Number(value.toFixed(1));
  return rounded >= 1000 ? `${Math.round(value)} rpm` : `${value.toFixed(1)} rpm`;
}

// "3.00 : 1"。決まらなければ "—"
export function formatRatio(ratio: number | null): string {
  return ratio === null ? '—' : `${ratio.toFixed(2)} : 1`;
}

// ウォームの組のギア比 "30:1"（S2-05）。null なら ""
export function formatWormRatio(ratio: WormRatio | null): string {
  return ratio === null ? '' : `${ratio.wheelTeeth}:${ratio.threads}`;
}

// 情報を出す歯車（ID の昇順）。ON なら全歯車、OFF なら選択中の歯車だけ（歯車でなければ無し）
export function visibleInfoGearIds(
  scene: Scene,
  selection: string | null,
  infoOverlay: boolean,
): GearId[] {
  if (infoOverlay) return Object.keys(scene.gears).sort(compareIds);
  if (selection !== null && scene.gears[selection] !== undefined) return [selection];
  return [];
}
