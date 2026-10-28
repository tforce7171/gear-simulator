import type { MeshKind } from '../geometry/can-mesh';

export type { MeshKind } from '../geometry/can-mesh';

import { GEAR_SIZES } from '../constants';
import type { LockInfo, MotionState } from '../kinematics/types';
import type { Layout } from '../layout/types';
import { gearWorldCenter } from '../layout/world';
import { axisVector } from '../math/axis';
import type { Vec3 } from '../math/vec3';
import { scale, sub } from '../math/vec3';
import type { GearId, Motor, MotorId, Scene, ShaftId, SizeKey } from '../scene/types';
import type { AudioMaterialId } from '../theme';
import { lockKey, meshContactPoint, motorHumParams } from './spatial';

export * from './spatial';

// 音の計算（S1-25、要件 §9）。Web Audio には触れず、src/audio/ がこの結果をノードに流す

// 歯の通過頻度の境目（Hz）。CLICK_MAX_HZ 以下はクリックだけ、TONE_MIN_HZ 以上は連続音だけ、
// その間は等パワーでクロスフェードする
export const CLICK_MAX_HZ = 15;
export const TONE_MIN_HZ = 30;
// 連続音の基本周波数の上限（Hz）。歯の通過頻度はこれを超えうるが、それ以上は耳障りなだけ
export const TONE_MAX_HZ = 2000;
// 連続音の音量が 1.0 に達する歯の通過頻度（Hz）
export const TONE_FULL_LEVEL_HZ = 400;
// クリックの高さの揺らぎ（±3%）
export const CLICK_JITTER = 0.03;
// クリックを予約するときに足す遅れ（秒）
export const CLICK_LATENCY = 0.03;
// 主音量
export const MASTER_GAIN = 0.5;
// すべりの雑音が頭打ちになる周速（mm/s。S2-05）。中のウォーム（ピッチ円半径 10 mm）で約 190 rpm
export const SLIDE_NOISE_FULL_SPEED = 200;
// ミュートの切り替えで主音量を変える時間（秒）
export const MUTE_RAMP_SEC = 0.05;

export interface ClickPartial {
  readonly frequency: number; // Hz
  readonly decay: number; // 秒
}

export interface ClickNoise {
  readonly type: 'highpass' | 'lowpass';
  readonly frequency: number; // フィルタの周波数（Hz）
  readonly decay: number; // 秒
}

export interface ClickParams {
  readonly partials: readonly ClickPartial[]; // 共鳴の部分音
  readonly noise: ClickNoise;
  readonly gain: number; // クリックの音量
}

export interface ToneMaterial {
  readonly harmonics: readonly number[]; // 1, 2, 3, … 倍音の振幅
  readonly lowpass: number; // Hz
  readonly noise: number; // 加えるノイズ（ざらつき）の量。連続音の音量に対する比
  readonly gain: number; // 連続音の音量
}

// すべりの雑音（S2-05）: ループするノイズ → 帯域通過フィルタ。強さ 0〜1 に gain を掛ける。
// 中心の周波数は強さに合わせて frequency × (1 − spread/2 + spread × 強さ) まで動かす（速いほど高く）
export interface SlideNoiseMaterial {
  readonly frequency: number; // 帯域の中心（Hz）
  readonly q: number; // 帯域の鋭さ
  readonly spread: number; // 強さで中心を動かす幅（frequency に対する比）
  readonly gain: number; // 強さ 1 のときの音量
}

export interface AudioMaterialParams {
  readonly click: ClickParams;
  readonly tone: ToneMaterial;
  readonly slide: SlideNoiseMaterial;
}

// 材質のパラメータ（S1-25 の資料の表）。時間は秒
export const MATERIALS: Readonly<Record<AudioMaterialId, AudioMaterialParams>> = {
  metal: {
    click: {
      partials: [
        { frequency: 2400, decay: 0.08 },
        { frequency: 3900, decay: 0.06 },
        { frequency: 6100, decay: 0.04 },
      ],
      noise: { type: 'highpass', frequency: 3000, decay: 0.008 },
      gain: 0.5,
    },
    tone: { harmonics: [1, 0.6, 0.45, 0.3, 0.2, 0.12], lowpass: 4000, noise: 0.05, gain: 0.25 },
    slide: { frequency: 2600, q: 4, spread: 0.4, gain: 0.12 },
  },
  wood: {
    click: {
      partials: [
        { frequency: 420, decay: 0.025 },
        { frequency: 950, decay: 0.015 },
      ],
      noise: { type: 'lowpass', frequency: 1200, decay: 0.012 },
      gain: 0.6,
    },
    tone: { harmonics: [1, 0.3, 0.1], lowpass: 900, noise: 0.15, gain: 0.2 },
    slide: { frequency: 900, q: 3, spread: 0.4, gain: 0.14 },
  },
};

// 音源の種類（S3-05）: かみ合いの種類（MeshKind）と、ラックとピニオンの組 'rack'
export type VoiceKind = MeshKind | 'rack';

// かみ合いの種類ごとの音色（S2-05）。平歯車を 1 とした倍率で、click はクリックの音量、hum は連続音の音量、
// slideNoise はすべりの雑音の強さの上限（0〜1）、lowpass は連続音のローパスの周波数に掛ける倍率
// （1 未満でこもる。S3-05 の内歯車）。手で聞いて調整したら資料（S2-05・S3-05）の表も直す
export interface MeshTimbre {
  readonly click: number;
  readonly hum: number;
  readonly slideNoise: number;
  readonly lowpass: number;
}

// ねじ歯車のすべりの雑音は、ウォームのこの倍
const CROSSED_SLIDE_RATIO = 0.3;
const WORM_SLIDE = 1;
// ハスバ・ねじ歯車・ウォームの連続音の倍率（なめらかにかみ合ってうなりが勝つ）
const SMOOTH_HUM = 1.5;
// 内歯車の組のこもり（S3-05）: 連続音のローパスを材質の値のこの倍にする（高域を落とす）
const INTERNAL_LOWPASS = 0.45;

export const MESH_TIMBRES: Readonly<Record<VoiceKind, MeshTimbre>> = {
  spur: { click: 1, hum: 1, slideNoise: 0, lowpass: 1 },
  bevel: { click: 1, hum: 1, slideNoise: 0, lowpass: 1 },
  helical: { click: 0.4, hum: SMOOTH_HUM, slideNoise: 0, lowpass: 1 },
  crossedHelical: {
    click: 0.4,
    hum: SMOOTH_HUM,
    slideNoise: CROSSED_SLIDE_RATIO * WORM_SLIDE,
    lowpass: 1,
  },
  worm: { click: 0.2, hum: SMOOTH_HUM, slideNoise: WORM_SLIDE, lowpass: 1 },
  // 内歯車の組（S3-02）: 平歯車と同じ音色で、うなりを少しこもらせる（S3-05）
  internal: { click: 1, hum: 1, slideNoise: 0, lowpass: INTERNAL_LOWPASS },
  // ラックとピニオンの組（S3-05）: 平歯車と同じ
  rack: { click: 1, hum: 1, slideNoise: 0, lowpass: 1 },
};

export const VOICE_KINDS = Object.keys(MESH_TIMBRES) as readonly VoiceKind[];
// かみ合いの種類（Layout.meshes の kind）だけ
export const MESH_KINDS = VOICE_KINDS.filter((k): k is MeshKind => k !== 'rack');

export function meshTimbre(kind: VoiceKind): MeshTimbre {
  return MESH_TIMBRES[kind];
}

// すべりの雑音の強さ（0〜1）。周速（mm/s。向きは問わない）に比例して上がり、SLIDE_NOISE_FULL_SPEED で
// 種類の上限（meshTimbre の slideNoise）に頭打ちになる
export function slideNoiseLevel(kind: VoiceKind, pitchLineSpeed: number): number {
  const speed = Math.abs(pitchLineSpeed);
  if (!(speed > 0)) return 0;
  return MESH_TIMBRES[kind].slideNoise * Math.min(1, speed / SLIDE_NOISE_FULL_SPEED);
}

// すべりの雑音の帯域の中心（Hz）と音量。level は slideNoiseLevel
export function slideNoiseParams(
  level: number,
  material: AudioMaterialId,
): { frequency: number; q: number; gain: number } {
  const slide = MATERIALS[material].slide;
  const l = clamp(level, 0, 1);
  return {
    frequency: slide.frequency * (1 - slide.spread / 2 + slide.spread * l),
    q: slide.q,
    gain: slide.gain * l,
  };
}

// かみ合い 1 組の音源のキー。2 つの歯車の ID を文字列順に並べて | でつなぐ
export function meshKey(a: GearId, b: GearId): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

// 歯の通過頻度（Hz）= z × |ω| / 2π。かみ合う 2 枚のどちらで求めても同じ
export function toothPassFrequency(teeth: number, omega: number): number {
  return (teeth * Math.abs(omega)) / (2 * Math.PI);
}

// ラックの組の歯の通過頻度（Hz）= |v| / (π·m)（S3-05）。v はラックの速度（mm/s）、π·m は歯のピッチ（mm）
export function rackToothPassFrequency(velocity: number, module: number): number {
  return Math.abs(velocity) / (Math.PI * module);
}

// 遊星のかみ合いの歯の通過頻度（Hz）= z × |ω − ω_c| / 2π（S3-05）。キャリアに対する相対の回転で数える
// （ω_c はキャリアのシャフトの角速度）。太陽と遊星、遊星とリングのどちらの歯車で求めても同じ
export function planetToothPassFrequency(
  teeth: number,
  omega: number,
  carrierOmega: number,
): number {
  return toothPassFrequency(teeth, omega - carrierOmega);
}

// クリックと連続音の重み（それぞれ 0〜1、click² + tone² = 1）
export function clickToneMix(f: number): { click: number; tone: number } {
  if (f <= CLICK_MAX_HZ) return { click: 1, tone: 0 };
  if (f >= TONE_MIN_HZ) return { click: 0, tone: 1 };
  const w = (f - CLICK_MAX_HZ) / (TONE_MIN_HZ - CLICK_MAX_HZ);
  return { click: Math.cos((w * Math.PI) / 2), tone: Math.sin((w * Math.PI) / 2) };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// 連続音の音量の素（30 Hz で 0.6、400 Hz 以上で 1.0。その間は log2 で直線。30 Hz 未満も 0.6）
function toneLevelOf(f: number): number {
  const rise = Math.log2(f / TONE_MIN_HZ) / Math.log2(TONE_FULL_LEVEL_HZ / TONE_MIN_HZ);
  return 0.6 + 0.4 * clamp(rise, 0, 1);
}

// 連続音の基本周波数（クランプ済み）と音量（toneLevel × 材質の音量 × クロスフェードの重み）。
// toneLevel は 30 Hz で 0.6、400 Hz 以上で 1.0（その間は log2 で直線）
export function toneParams(
  f: number,
  material: AudioMaterialId,
): { frequency: number; level: number } {
  const frequency = clamp(f, TONE_MIN_HZ, TONE_MAX_HZ);
  const { tone } = clickToneMix(f);
  if (tone === 0) return { frequency, level: 0 };
  return { frequency, level: toneLevelOf(f) * MATERIALS[material].tone.gain * tone };
}

// 背景のうなりに使う推定の音量（S1-26）: クリックの範囲の組も連続音とみなした、連続音の level
// （クロスフェードの重みを掛けない toneLevel × 材質の連続音の音量）
export function backgroundToneLevel(f: number, material: AudioMaterialId): number {
  if (!(f > 0)) return 0;
  return toneLevelOf(f) * MATERIALS[material].tone.gain;
}

// 前後のフレームの角度から、歯の通過（シャフトの角度 × z / 2π が整数を跨いだ点）の時刻を返す。
// 時刻は前のフレームからの秒（0〜dt、昇順）で、跨いだ点を線形補間して求める。向きは問わない。
// 境目 k は「小さいほうの値 < k ≤ 大きいほうの値」で数えるので、続けて呼んでも同じ境目を 2 回数えない
export function toothPassTimes(
  prevAngle: number,
  nextAngle: number,
  teeth: number,
  dt: number,
): number[] {
  if (!(dt > 0)) return [];
  const p0 = (prevAngle * teeth) / (2 * Math.PI);
  const p1 = (nextAngle * teeth) / (2 * Math.PI);
  if (p0 === p1) return [];
  const lo = Math.min(p0, p1);
  const hi = Math.max(p0, p1);
  const times: number[] = [];
  for (let k = Math.floor(lo) + 1; k <= hi; k += 1) {
    times.push(clamp((dt * (k - p0)) / (p1 - p0), 0, dt));
  }
  return times.sort((a, b) => a - b);
}

// 1 回のクリックのパラメータ。部分音とノイズのフィルタの周波数を同じ割合で ±3% ずらす
// （random() が 0 → −3%、0.5 → 0、1 → +3%）
export function clickParams(material: AudioMaterialId, random: () => number): ClickParams {
  const base = MATERIALS[material].click;
  const factor = 1 + CLICK_JITTER * (2 * clamp(random(), 0, 1) - 1);
  return {
    partials: base.partials.map((p) => ({ frequency: p.frequency * factor, decay: p.decay })),
    noise: { ...base.noise, frequency: base.noise.frequency * factor },
    gain: base.gain,
  };
}

// かみ合いごとの音源の状態
export interface MeshVoice {
  readonly key: string; // meshKey（ラックの組は meshKey(ピニオン, ラック)。S3-05）
  // クリックの時刻を求める歯車（key の先頭の歯車。ラックの組はピニオン）とそのシャフト・歯数
  readonly gearId: GearId;
  readonly shaftId: ShaftId;
  readonly teeth: number;
  // 遊星のかみ合い（S3-05）のキャリアのシャフト。クリックはこのシャフトに対する相対の角度で数える
  readonly carrierShaftId?: ShaftId;
  readonly frequency: number; // 歯の通過頻度（Hz。クランプしない）
  readonly click: number; // clickToneMix の重み
  readonly tone: number;
  readonly position: Vec3; // かみ合いの接点（meshContactPoint。S1-26）
  readonly kind: VoiceKind; // かみ合いの種類（音色を決める。S2-05。ラックの組は 'rack'。S3-05）
  readonly slide: number; // すべりの雑音の強さ（slideNoiseLevel。S2-05）
}

// Layout.meshes の順に、かみ合い 1 組ずつの音源の状態を返し（止まっている組も含む）、続けて Layout.rackMeshes の順に
// ラックの組（S3-05）を返す。遊星のかみ合い（Mesh.carrierShaftId がある組。S3-03）は歯の通過頻度をキャリアに対する
// 相対の回転で求め（planetToothPassFrequency）、位置は公転した今の接点。内歯車の組は kind 'internal' のまま返し、
// 音色（こもり）は MESH_TIMBRES が決める
export function computeMeshVoices(scene: Scene, layout: Layout, motion: MotionState): MeshVoice[] {
  const voices: MeshVoice[] = [];
  for (const mesh of layout.meshes) {
    const [gearId = mesh.a] = [mesh.a, mesh.b].sort();
    const gear = scene.gears[gearId];
    if (gear === undefined) continue;
    const carrier = mesh.carrierShaftId;
    const carrierOmega = carrier === undefined ? 0 : (motion.omegas[carrier] ?? 0);
    const omega = motion.omegas[gear.shaftId] ?? 0;
    const frequency = planetToothPassFrequency(gear.teeth, omega, carrierOmega);
    // 周速は 2 枚のピッチ円の周速の大きいほう（ウォームの組ではウォームの周速がすべりの速さに近い）。
    // 遊星のかみ合いはキャリアに対する相対の周速
    let speed = 0;
    for (const id of [mesh.a, mesh.b]) {
      const g = scene.gears[id];
      const r = layout.gears[id]?.pitchRadius ?? 0;
      if (g === undefined) continue;
      speed = Math.max(speed, r * Math.abs((motion.omegas[g.shaftId] ?? 0) - carrierOmega));
    }
    const voice: MeshVoice = {
      key: meshKey(mesh.a, mesh.b),
      gearId,
      shaftId: gear.shaftId,
      teeth: gear.teeth,
      frequency,
      ...clickToneMix(frequency),
      position: meshContactPoint(layout, mesh, motion),
      kind: mesh.kind,
      slide: slideNoiseLevel(mesh.kind, speed),
    };
    voices.push(carrier === undefined ? voice : { ...voice, carrierShaftId: carrier });
  }
  for (const rm of layout.rackMeshes) {
    const gear = scene.gears[rm.gear];
    const rack = scene.racks[rm.rack];
    const placed = layout.racks[rm.rack];
    const gearLayout = layout.gears[rm.gear];
    if (gear === undefined || rack === undefined || placed === undefined) continue;
    if (gearLayout === undefined) continue;
    const frequency = rackToothPassFrequency(
      motion.rackVelocities[rack.id] ?? 0,
      GEAR_SIZES[rack.size].module,
    );
    // 接点はピニオンのピッチ円とピッチ線の接する点（ラックが動いても動かない）: ピニオンの中心 − r·normalSign·normal
    const position = sub(
      gearWorldCenter(layout, motion, gear.id),
      scale(axisVector(placed.normal), gearLayout.pitchRadius * placed.normalSign),
    );
    voices.push({
      key: meshKey(gear.id, rack.id),
      gearId: gear.id,
      shaftId: gear.shaftId,
      teeth: gear.teeth,
      frequency,
      ...clickToneMix(frequency),
      position,
      kind: 'rack',
      slide: 0,
    });
  }
  return voices;
}

// ラックが端に当たった瞬間（S3-05）: 前のフレームの locks に無く、今のフレームにある 'rackEnd' のロック
// （lockKey の昇順）。続くフレームで同じロックが続いても、もう返さない
export function rackEndHits(prev: readonly LockInfo[], next: readonly LockInfo[]): LockInfo[] {
  const before = new Set(prev.map(lockKey));
  return next
    .filter((lock) => lock.reason === 'rackEnd' && !before.has(lockKey(lock)))
    .sort((a, b) => (lockKey(a) < lockKey(b) ? -1 : lockKey(a) > lockKey(b) ? 1 : 0));
}

// 1 フレームで跨いだ歯の数が多い（f ≥ TONE_MIN_HZ 相当）ときはクリックを予約しない
export function shouldScheduleClicks(count: number, dt: number): boolean {
  return count > 0 && dt > 0 && count / dt < TONE_MIN_HZ;
}

// モーターのうなりの音源（S1-26）
export interface MotorHum {
  readonly motorId: MotorId;
  readonly size: SizeKey;
  readonly position: Vec3; // モーターの描画位置
  readonly frequency: number;
  readonly level: number;
  readonly strain: number;
  readonly grind: number; // backDriven に入っていないモーターは 0
}

// ON のモーターのうなり（ID の昇順）。一時停止中は空。位置が求まらない（シャフトが無い）モーターは除く
export function computeMotorHums(
  scene: Scene,
  motion: MotionState,
  paused: boolean,
  positionOf: (motor: Motor) => Vec3 | null,
): MotorHum[] {
  if (paused) return [];
  const backDriven = new Set(motion.backDriven);
  const hums: MotorHum[] = [];
  const motors = Object.values(scene.motors).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const motor of motors) {
    if (!motor.on) continue;
    const position = positionOf(motor);
    if (position === null) continue;
    const omega = motion.omegas[motor.shaftId] ?? 0;
    const p = motorHumParams(motor.size, motor.rpm, motor.direction, omega);
    hums.push({
      motorId: motor.id,
      size: motor.size,
      position,
      frequency: p.frequency,
      level: p.level,
      strain: p.strain,
      grind: backDriven.has(motor.id) ? p.grind : 0,
    });
  }
  return hums;
}
