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
import { CLICK_RATE_MAX, lockKey, meshContactPoint, motorLoadParams } from './spatial';

export * from './spatial';

// 音の計算（S1-25、要件 §9）。Web Audio には触れず、src/audio/ がこの結果をノードに流す

// 粒の音（S4-06）: かみ合いの音は速さによらず粒（カタカタ）で鳴らす（連続音への切り替えは無い）。
// 粒を打つ回数は歯の通過頻度に従い、CLICK_RATE_MAX（毎秒 40。spatial.ts）を超えたら間引く
// 粒の高さ: clickPitch = 材質の基準 × (1 + CLICK_PITCH_SLOPE × log2(1 + f / CLICK_PITCH_REF_HZ))
export const CLICK_PITCH_REF_HZ = 10;
export const CLICK_PITCH_SLOPE = 0.2;
// 粒の時刻の揺らぎ: 間隔の ±CLICK_TIME_JITTER 倍（ただし ±CLICK_TIME_JITTER_MAX_SEC 秒まで）。一定の間隔で打つと
// ブーという音（間隔の周波数の連続音）に聞こえるため
export const CLICK_TIME_JITTER = 0.25;
export const CLICK_TIME_JITTER_MAX_SEC = 0.006;
// 粒の高さの揺らぎ（±3%）
export const CLICK_JITTER = 0.03;
// 粒を予約するときに足す遅れ（秒）
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
  readonly type: 'highpass' | 'lowpass' | 'bandpass';
  readonly frequency: number; // フィルタの周波数（Hz）
  readonly q?: number; // フィルタの Q（省けば既定のまま）
  readonly decay: number; // 秒
}

// 1 回のクリック（粒・衝撃音のクリック）の合成のパラメータ
export interface ClickParams {
  readonly partials: readonly ClickPartial[]; // 共鳴の部分音
  readonly noise: ClickNoise;
  readonly gain: number; // クリックの音量
}

// 粒 1 つの材質（S4-06）。ノイズを共鳴フィルタ（帯域通過、中心 = clickPitch、Q = q）に通し、
// 中心周波数の ratio 倍の減衰する部分音を重ねる
export interface GrainMaterial {
  readonly pitch: number; // 止まりかけ（f → 0）の粒の中心周波数（Hz）
  readonly partials: readonly { readonly ratio: number; readonly decay: number }[];
  readonly q: number; // 共鳴フィルタの Q（大きいほど硬く鳴る）
  readonly noiseDecay: number; // ノイズの減衰（秒）
  readonly gain: number; // 粒の音量
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
  readonly click: GrainMaterial;
  readonly slide: SlideNoiseMaterial;
}

// 材質のパラメータ（S4-06 で粒の音色にした）。時間は秒。metal は硬く高めのカタカタ（鋭い共鳴と高い部分音）、
// wood は柔らかく低めのコトコト（ゆるい共鳴）
export const MATERIALS: Readonly<Record<AudioMaterialId, AudioMaterialParams>> = {
  metal: {
    click: {
      pitch: 2400,
      partials: [
        { ratio: 1, decay: 0.025 },
        { ratio: 1.63, decay: 0.018 },
        { ratio: 2.54, decay: 0.012 },
      ],
      q: 10,
      noiseDecay: 0.004,
      gain: 0.5,
    },
    slide: { frequency: 2600, q: 4, spread: 0.4, gain: 0.12 },
  },
  wood: {
    click: {
      pitch: 520,
      partials: [
        { ratio: 1, decay: 0.018 },
        { ratio: 2.26, decay: 0.01 },
      ],
      q: 3,
      noiseDecay: 0.008,
      gain: 0.6,
    },
    slide: { frequency: 900, q: 3, spread: 0.4, gain: 0.14 },
  },
};

// 音源の種類（S3-05）: かみ合いの種類（MeshKind）と、ラックとピニオンの組 'rack'
export type VoiceKind = MeshKind | 'rack';

// かみ合いの種類ごとの音色（S2-05）。平歯車を 1 とした倍率で、click は粒の音量、
// slideNoise はすべりの雑音の強さの上限（0〜1）、pitch は粒の中心周波数に掛ける倍率
// （1 未満でこもる。S3-05 の内歯車。S4-06 で連続音の hum・lowpass をやめて pitch にした）。
// 手で聞いて調整したら資料（S2-05・S3-05）の表も直す
export interface MeshTimbre {
  readonly click: number;
  readonly slideNoise: number;
  readonly pitch: number;
}

// ねじ歯車のすべりの雑音は、ウォームのこの倍
const CROSSED_SLIDE_RATIO = 0.3;
const WORM_SLIDE = 1;
// 内歯車の組のこもり（S3-05）: 粒の中心周波数を材質の値のこの倍にする（S4-06。前は連続音のローパスの倍率 0.45）
const INTERNAL_PITCH = 0.6;

export const MESH_TIMBRES: Readonly<Record<VoiceKind, MeshTimbre>> = {
  spur: { click: 1, slideNoise: 0, pitch: 1 },
  bevel: { click: 1, slideNoise: 0, pitch: 1 },
  // ハスバ・ねじ歯車・ウォーム: なめらかにかみ合うので粒を小さく
  helical: { click: 0.4, slideNoise: 0, pitch: 1 },
  crossedHelical: { click: 0.4, slideNoise: CROSSED_SLIDE_RATIO * WORM_SLIDE, pitch: 1 },
  worm: { click: 0.2, slideNoise: WORM_SLIDE, pitch: 1 },
  // 内歯車の組（S3-02）: 平歯車と同じ音色で、少しこもらせる（S3-05）
  internal: { click: 1, slideNoise: 0, pitch: INTERNAL_PITCH },
  // ラックとピニオンの組（S3-05）: 平歯車と同じ
  rack: { click: 1, slideNoise: 0, pitch: 1 },
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

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// 毎秒の粒の数（S4-06）: 歯の通過頻度のまま、CLICK_RATE_MAX で頭打ち（超えたら間引く）。止まっていれば 0
export function clickRate(toothPassHz: number): number {
  if (!(toothPassHz > 0)) return 0;
  return Math.min(toothPassHz, CLICK_RATE_MAX);
}

// 粒の中心周波数（Hz。S4-06）: 回転が速いほど高い（f について単調に増える）。材質の基準 × (1 + 0.2 × log2(1 + f/10))
export function clickPitch(toothPassHz: number, material: AudioMaterialId): number {
  const f = Math.max(0, toothPassHz || 0); // NaN・負は 0
  return (
    MATERIALS[material].click.pitch *
    (1 + CLICK_PITCH_SLOPE * Math.log2(1 + f / CLICK_PITCH_REF_HZ))
  );
}

// 背景にまとめるときの組の音量の素（S4-06）: 動いている組は材質の粒の音量 × BACKGROUND_GRAIN_SCALE、止まっていれば 0
export const BACKGROUND_GRAIN_SCALE = 0.4;
export function grainLevel(toothPassHz: number, material: AudioMaterialId): number {
  if (!(toothPassHz > 0)) return 0;
  return MATERIALS[material].click.gain * BACKGROUND_GRAIN_SCALE;
}

const GRAIN_EPSILON = 1e-9;

// 一定の割合 rate（毎秒）で粒を打つ時刻（前のフレームからの秒、昇順）。carry は前のフレームまでの端数（0〜1 の粒）で、
// 返した carry を次のフレームに渡すと、フレームの長さによらず 1 秒に rate 粒になる
export function grainTimes(
  rate: number,
  dt: number,
  carry: number,
): { times: number[]; carry: number } {
  if (!(rate > 0) || !(dt > 0)) return { times: [], carry: rate > 0 ? carry : 0 };
  const p0 = carry;
  const p1 = carry + rate * dt;
  // 端数の足し合わせの丸めの誤差で、ちょうど整数になる粒を次のフレームに回さない
  const last = Math.floor(p1 + GRAIN_EPSILON);
  const times: number[] = [];
  for (let k = Math.floor(p0) + 1; k <= last; k += 1) times.push(Math.min(dt, (k - p0) / rate));
  return { times, carry: Math.max(0, p1 - last) };
}

// 時刻を ±amount × 間隔（±maxSec まで）だけ揺らす（random() が 0 → 早く、0.5 → そのまま、1 → 遅く）。0 未満は 0、昇順に並べ直す
export function jitterTimes(
  times: readonly number[],
  interval: number,
  amount: number,
  maxSec: number,
  random: () => number,
): number[] {
  const width = Math.min(amount * interval, maxSec);
  return times
    .map((t) => Math.max(0, t + width * (2 * clamp(random(), 0, 1) - 1)))
    .sort((a, b) => a - b);
}

// かみ合い 1 組の、1 フレームで打つ粒の時刻（S4-06）。frequency は歯の通過頻度。上限（CLICK_RATE_MAX）以下なら
// 歯の通過（toothPassTimes）ごとに 1 粒（回転の見た目と合う）、超えたら毎秒 CLICK_RATE_MAX 粒に間引く（grainTimes。
// carry を持ち越す）。どちらも時刻に揺らぎを入れる
export function meshGrainTimes(
  prevAngle: number,
  nextAngle: number,
  teeth: number,
  dt: number,
  frequency: number,
  carry: number,
  random: () => number,
): { times: number[]; carry: number } {
  const rate = clickRate(frequency);
  if (rate === 0 || !(dt > 0)) return { times: [], carry: 0 };
  const base =
    frequency <= CLICK_RATE_MAX
      ? { times: toothPassTimes(prevAngle, nextAngle, teeth, dt), carry: 0 }
      : grainTimes(rate, dt, carry);
  return {
    times: jitterTimes(base.times, 1 / rate, CLICK_TIME_JITTER, CLICK_TIME_JITTER_MAX_SEC, random),
    carry: base.carry,
  };
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

// 粒 1 つのパラメータ（S4-06）。共鳴フィルタの中心 = clickPitch(f) × pitchScale（種類の音色の pitch）を、
// 部分音とまとめて ±3% ずらす（random() が 0 → −3%、0.5 → 0、1 → +3%）
export function clickParams(
  material: AudioMaterialId,
  random: () => number,
  toothPassHz: number,
  pitchScale = 1,
): ClickParams {
  const m = MATERIALS[material].click;
  const factor = 1 + CLICK_JITTER * (2 * clamp(random(), 0, 1) - 1);
  const pitch = clickPitch(toothPassHz, material) * pitchScale * factor;
  return {
    partials: m.partials.map((p) => ({ frequency: pitch * p.ratio, decay: p.decay })),
    noise: { type: 'bandpass', frequency: pitch, q: m.q, decay: m.noiseDecay },
    gain: m.gain,
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

// モーターの音源（S1-26。S4-06 でうなりをやめ、過負荷のきしみだけにした）
export interface MotorVoice {
  readonly motorId: MotorId;
  readonly size: SizeKey;
  readonly position: Vec3; // モーターの描画位置
  readonly strain: number;
  readonly grind: number; // backDriven に入っていないモーターは 0
  readonly grindFrequency: number; // きしみの帯域の中心（Hz）
}

// ON のモーターの音源（ID の昇順）。一時停止中は空。位置が求まらない（シャフトが無い）モーターは除く
export function computeMotorVoices(
  scene: Scene,
  motion: MotionState,
  paused: boolean,
  positionOf: (motor: Motor) => Vec3 | null,
): MotorVoice[] {
  if (paused) return [];
  const backDriven = new Set(motion.backDriven);
  const voices: MotorVoice[] = [];
  const motors = Object.values(scene.motors).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const motor of motors) {
    if (!motor.on) continue;
    const position = positionOf(motor);
    if (position === null) continue;
    const omega = motion.omegas[motor.shaftId] ?? 0;
    const p = motorLoadParams(motor.size, motor.rpm, motor.direction, omega);
    voices.push({
      motorId: motor.id,
      size: motor.size,
      position,
      strain: p.strain,
      grind: backDriven.has(motor.id) ? p.grind : 0,
      grindFrequency: p.grindFrequency,
    });
  }
  return voices;
}
