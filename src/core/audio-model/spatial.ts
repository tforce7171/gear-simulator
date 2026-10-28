import type { LockInfo, MotionState } from '../kinematics/types';
import type { Layout, Mesh } from '../layout/types';
import { gearWorldCenter } from '../layout/world';
import { add, length, scale, sub, type Vec3 } from '../math/vec3';
import type { SizeKey } from '../scene/types';
import type { AudioMaterialId } from '../theme';

// 音の空間配置・鳴らす音源の選び方・背景のうなり・専用音（S1-26、要件 §9）。
// Web Audio には触れず、src/audio/ がこの結果をノードに流す

// 同時に鳴らすモーターのうなりの数（かみ合いの MAX_AUDIO_VOICES とは別に数える）
export const MAX_MOTOR_VOICES = 4;
// 前のフレームで鳴っていた音源は、距離をこの倍率にして比べる（ちらつき防止）
export const VOICE_HYSTERESIS = 0.9;
// 音源を入れ替えるときのフェードイン・アウト（秒）
export const VOICE_FADE_SEC = 0.1;

// PannerNode の距離の設定（長さは mm のまま渡す）
export const PANNER = {
  panningModel: 'HRTF',
  distanceModel: 'inverse',
  refDistance: 150,
  rolloffFactor: 1,
  maxDistance: 10000,
} as const;

// 背景のうなり
export const BACKGROUND_MAX_LEVEL = 0.5;
export const BACKGROUND_MIN_HZ = 30;
export const BACKGROUND_MAX_HZ = 2000;
export const BACKGROUND_NOISE_Q = 1;
export const BACKGROUND_NOISE_RATIO = 0.5; // 帯域ノイズの音量（連続音に対する比）

// ロックの音
export const LOCK_IMPACT_LIMIT = 4; // 1 秒あたりの衝撃音の上限
export const LOCK_IMPACT_WINDOW_SEC = 1;
export const LOCK_RATTLE_HZ = 18; // ガタガタの振幅変調の周波数
export const LOCK_RATTLE_LEVEL = 0.1;
export const LOCK_RATTLE_RELEASE_SEC = 0.1;
export interface LockImpactParams {
  readonly frequency: number; // 低音の周波数（Hz）
  readonly duration: number; // 低音の長さ（秒）
  readonly clickGain: number; // 材質のクリックに掛ける倍率
}
export const LOCK_IMPACT: Readonly<Record<AudioMaterialId, LockImpactParams>> = {
  metal: { frequency: 120, duration: 0.15, clickGain: 3 },
  wood: { frequency: 90, duration: 0.08, clickGain: 1 },
};
// 衝撃音の低音の音量（資料に無いので決めた値。implementation-log を参照）
export const LOCK_IMPACT_LEVEL = 0.6;

// モーターのうなり
export const MOTOR_HUM_BASE_HZ: Readonly<Record<SizeKey, number>> = { S: 220, M: 140, L: 90 };
export const MOTOR_HUM_LOWPASS_RATIO = 6; // ローパスの周波数 = 基準 × 6
export const MOTOR_GRIND_RATIO = 3; // きしみの帯域の中心 = うなりの周波数 × 3
export const MOTOR_GRIND_Q = 4;
export const MOTOR_GRIND_AM_HZ = 7;
export const MOTOR_GRIND_LEVEL = 0.15;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

// かみ合いの接点: a の中心から b の中心へ向かう線分上で、a の中心からピッチ円半径 r_a の点。
// motion を渡すと、遊星の歯車（S3-03）は公転した今の位置で求める
export function meshContactPoint(layout: Layout, mesh: Mesh, motion?: MotionState): Vec3 {
  const a = layout.gears[mesh.a];
  const b = layout.gears[mesh.b];
  const centerOf = (id: string, fallback: Vec3): Vec3 =>
    motion === undefined ? fallback : gearWorldCenter(layout, motion, id);
  if (a === undefined) return b === undefined ? [0, 0, 0] : centerOf(mesh.b, b.center);
  const ca = centerOf(mesh.a, a.center);
  if (b === undefined) return ca;
  const d = sub(centerOf(mesh.b, b.center), ca);
  const len = length(d);
  if (len === 0) return ca;
  return add(ca, scale(d, a.pitchRadius / len));
}

// PannerNode の inverse の距離の減衰（refDistance 未満は refDistance、maxDistance 超は maxDistance として扱う）
export function distanceGain(dist: number): number {
  const { refDistance, rolloffFactor, maxDistance } = PANNER;
  const d = clamp(dist, refDistance, maxDistance);
  return refDistance / (refDistance + rolloffFactor * (d - refDistance));
}

export interface VoiceCandidate {
  readonly key: string;
  readonly position: Vec3;
  readonly frequency: number;
  readonly level: number;
}

function compareKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 動いている（f > 0）候補のうち、リスナーに近い順に max 個を選ぶ。前のフレームで鳴っていた候補は
// 距離を VOICE_HYSTERESIS 倍して比べる。同じなら key の文字列順。rest は選ばれなかった動いている候補（同じ順）
export function selectVoices<T extends VoiceCandidate>(
  candidates: readonly T[],
  listener: Vec3,
  previous: ReadonlySet<string>,
  max: number,
): { selected: T[]; rest: T[] } {
  const ranked = candidates
    .filter((c) => c.frequency > 0)
    .map((c) => {
      const d = distance(c.position, listener);
      return { c, d: previous.has(c.key) ? d * VOICE_HYSTERESIS : d };
    })
    .sort((x, y) => x.d - y.d || compareKey(x.c.key, y.c.key));
  const limit = Math.max(0, max);
  return {
    selected: ranked.slice(0, limit).map((r) => r.c),
    rest: ranked.slice(limit).map((r) => r.c),
  };
}

// 選ばれなかった組をまとめた背景のうなり（rest が空なら null）。
// g_i = level × 距離の減衰、音量 = min(0.5, √Σg²)、周波数 = g で重み付けした log2(f) の平均（30〜2000 Hz）
export function summarizeBackground(
  rest: readonly VoiceCandidate[],
  listener: Vec3,
): { level: number; frequency: number } | null {
  const moving = rest.filter((c) => c.frequency > 0);
  if (moving.length === 0) return null;
  let sumSq = 0;
  let sumW = 0;
  let sumLog = 0;
  for (const c of moving) {
    const g = c.level * distanceGain(distance(c.position, listener));
    sumSq += g * g;
    sumW += g;
    sumLog += g * Math.log2(c.frequency);
  }
  // 重みが全部 0（level 0 の組だけ）のときは、重みなしの対数の平均
  const meanLog =
    sumW > 0
      ? sumLog / sumW
      : moving.reduce((s, c) => s + Math.log2(c.frequency), 0) / moving.length;
  return {
    level: Math.min(BACKGROUND_MAX_LEVEL, Math.sqrt(sumSq)),
    frequency: clamp(2 ** meanLog, BACKGROUND_MIN_HZ, BACKGROUND_MAX_HZ),
  };
}

// ロックのキー（理由とシャフトの ID をつないだ文字列）
export function lockKey(lock: LockInfo): string {
  return `${lock.reason}:${lock.shaftIds.join(',')}`;
}

// 前後のフレームのロックの差分（キーの昇順）
export function diffLocks(
  prev: readonly LockInfo[],
  next: readonly LockInfo[],
): { entered: string[]; exited: string[] } {
  const before = new Set(prev.map(lockKey));
  const after = new Set(next.map(lockKey));
  return {
    entered: [...after].filter((k) => !before.has(k)).sort(),
    exited: [...before].filter((k) => !after.has(k)).sort(),
  };
}

// ロックの音の位置: ロックしている歯車の中心の平均（歯車が無ければシャフトの原点の平均、どちらも無ければ null）
export function lockPosition(layout: Layout, lock: LockInfo): Vec3 | null {
  const points: Vec3[] = [];
  for (const id of lock.gearIds) {
    const g = layout.gears[id];
    if (g !== undefined) points.push(g.center);
  }
  if (points.length === 0) {
    for (const id of lock.shaftIds) {
      const s = layout.shafts[id];
      if (s !== undefined) points.push(s.origin);
    }
  }
  if (points.length === 0) return null;
  const sum = points.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]);
  return scale(sum, 1 / points.length);
}

// 衝撃音の回数の制限: 直近 1 秒（now − 1 < t ≤ now）に鳴らした回数が上限未満なら鳴らせる
export function canPlayImpact(history: readonly number[], now: number): boolean {
  const recent = history.filter((t) => t > now - LOCK_IMPACT_WINDOW_SEC);
  return recent.length < LOCK_IMPACT_LIMIT;
}

// モーターのうなり。strain = d·(d − ω/ω0) = 1 − d·ω/ω0（トルク ÷ 停動トルクを、モーターの向きを正として見た値）、周波数 = 基準 × (0.6 + 0.4 × clamp(|ω|/ω0, 0, 1.5))、
// 音量 = 0.08 + 0.07 × clamp(strain, 0, 1)、grind = clamp(strain − 1, 0, 1)
export function motorHumParams(
  size: SizeKey,
  rpm: number,
  direction: 1 | -1,
  omega: number,
): { frequency: number; level: number; strain: number; grind: number } {
  const omega0 = (rpm * 2 * Math.PI) / 60;
  const ratio = omega0 > 0 ? omega / omega0 : 0;
  const strain = 1 - direction * ratio;
  return {
    frequency: MOTOR_HUM_BASE_HZ[size] * (0.6 + 0.4 * clamp(Math.abs(ratio), 0, 1.5)),
    level: 0.08 + 0.07 * clamp(strain, 0, 1),
    strain,
    grind: clamp(strain - 1, 0, 1),
  };
}
