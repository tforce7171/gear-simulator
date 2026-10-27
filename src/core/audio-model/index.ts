import type { MotionState } from '../kinematics/types';
import type { Layout } from '../layout/types';
import type { Vec3 } from '../math/vec3';
import type { GearId, Motor, MotorId, Scene, ShaftId, SizeKey } from '../scene/types';
import type { AudioMaterialId } from '../theme';
import { meshContactPoint, motorHumParams } from './spatial';

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

export interface AudioMaterialParams {
  readonly click: ClickParams;
  readonly tone: ToneMaterial;
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
  },
};

// かみ合い 1 組の音源のキー。2 つの歯車の ID を文字列順に並べて | でつなぐ
export function meshKey(a: GearId, b: GearId): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

// 歯の通過頻度（Hz）= z × |ω| / 2π。かみ合う 2 枚のどちらで求めても同じ
export function toothPassFrequency(teeth: number, omega: number): number {
  return (teeth * Math.abs(omega)) / (2 * Math.PI);
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
  readonly key: string; // meshKey
  // クリックの時刻を求める歯車（key の先頭の歯車）とそのシャフト・歯数
  readonly gearId: GearId;
  readonly shaftId: ShaftId;
  readonly teeth: number;
  readonly frequency: number; // 歯の通過頻度（Hz。クランプしない）
  readonly click: number; // clickToneMix の重み
  readonly tone: number;
  readonly position: Vec3; // かみ合いの接点（meshContactPoint。S1-26）
}

// Layout.meshes の順に、かみ合い 1 組ずつの音源の状態を返す（止まっている組も含む）
export function computeMeshVoices(scene: Scene, layout: Layout, motion: MotionState): MeshVoice[] {
  const voices: MeshVoice[] = [];
  for (const mesh of layout.meshes) {
    const [gearId = mesh.a] = [mesh.a, mesh.b].sort();
    const gear = scene.gears[gearId];
    if (gear === undefined) continue;
    const omega = motion.omegas[gear.shaftId] ?? 0;
    const frequency = toothPassFrequency(gear.teeth, omega);
    voices.push({
      key: meshKey(mesh.a, mesh.b),
      gearId,
      shaftId: gear.shaftId,
      teeth: gear.teeth,
      frequency,
      ...clickToneMix(frequency),
      position: meshContactPoint(layout, mesh),
    });
  }
  return voices;
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
