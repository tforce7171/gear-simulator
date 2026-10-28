import {
  backgroundToneLevel,
  CLICK_LATENCY,
  canPlayImpact,
  clickParams,
  diffLocks,
  LOCK_IMPACT_WINDOW_SEC,
  lockKey,
  MASTER_GAIN,
  MAX_MOTOR_VOICES,
  type MeshVoice,
  type MotorHum,
  MUTE_RAMP_SEC,
  meshTimbre,
  rackEndHits,
  selectVoices,
  shouldScheduleClicks,
  summarizeBackground,
  toneParams,
  toothPassTimes,
  type VoiceKind,
} from '../core/audio-model';
import { MAX_AUDIO_VOICES } from '../core/constants';
import type { LockInfo } from '../core/kinematics/types';
import type { Vec3 } from '../core/math/vec3';
import type { MotorId, ShaftId } from '../core/scene/types';
import type { AudioMaterialId } from '../core/theme';
import { type BackgroundSynth, createBackgroundSynth } from './background';
import { createLockRattle, type LockRattle, playLockImpact, playRackHit } from './lock-sound';
import { createMeshVoiceSynth, type MeshVoiceSynth } from './mesh-voice';
import { createMotorHumSynth, type MotorHumSynth } from './motor-hum';
import { applyListener, type ListenerPose } from './panner';

// 音の再生（S1-25・S1-26）。AudioContext の開始、主音量とミュート、かみ合いごとの音源の出し入れと毎フレームの更新、
// リスナー（カメラ）、背景のうなり、モーターのうなり、ロックの音。
// 何を鳴らすかの計算は core/audio-model に任せ、ここは結果をノードに流すだけ

// ノイズの素（白色雑音）の長さ（秒）。実行時に作る（録音素材は使わない）
const NOISE_SECONDS = 1;

export interface AudioState {
  contextState: 'none' | AudioContextState; // 作る前は 'none'
  muted: boolean;
  material: AudioMaterialId;
  // 今鳴らしている（鳴らす対象の）かみ合い。frequency は歯の通過頻度（Hz）、position は接点、
  // kind はかみ合いの種類（音色。S2-05。ラックの組は 'rack'。S3-05）、slide はすべりの雑音の強さ（0〜1。S2-05）
  voices: Array<{
    key: string;
    frequency: number;
    click: number;
    tone: number;
    position: Vec3;
    kind: VoiceKind;
    slide: number;
  }>;
  // 選ばれなかった組をまとめた背景のうなり。無ければ null
  background: { level: number; frequency: number } | null;
  // 今鳴らしているモーターのうなり（motorId の昇順）
  motors: Array<{ motorId: MotorId; frequency: number; strain: number; grind: number }>;
  // 起動からの衝撃音の回数と、ガタガタ中のロックのキー（昇順）。rackHits はラックが端に当たった音の回数（S3-05。
  // 端のロックはロックの衝撃音の代わりにこれを鳴らすので impacts には数えない）
  lockSounds: { impacts: number; rattling: string[]; rackHits: number };
}

// 1 フレーム分の入力
export interface AudioFrame {
  readonly voices: readonly MeshVoice[]; // computeMeshVoices
  readonly angles: Readonly<Record<ShaftId, number>>; // シャフトの角度（クリックの時刻）
  readonly dt: number; // 前のフレームからの経過時間（秒）
  readonly listener: ListenerPose; // カメラ
  readonly motors: readonly MotorHum[]; // computeMotorHums（一時停止中は空）
  // 今のロックと、その音の位置（ロックしている歯車の中心の平均。求まらなければ null）
  readonly locks: ReadonlyArray<{ readonly info: LockInfo; readonly position: Vec3 | null }>;
}

export interface AudioEngine {
  // AudioContext を作って resume する（2 回目以降は止まっていれば resume するだけ）。ユーザー操作の中で呼ぶ
  start(): void;
  setMuted(muted: boolean): void;
  setMaterial(material: AudioMaterialId): void;
  // 毎フレーム
  update(frame: AudioFrame): void;
  state(): AudioState;
}

export interface AudioEngineOptions {
  readonly createContext?: () => AudioContext;
  readonly random?: () => number; // クリックの高さの揺らぎ、きしみの振幅変調
  readonly material?: AudioMaterialId;
  readonly muted?: boolean;
}

function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

interface Graph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly noise: AudioBuffer;
  readonly background: BackgroundSynth;
}

type Selected = MeshVoice & { readonly level: number };

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const createContext = options.createContext ?? (() => new AudioContext());
  const random = options.random ?? Math.random;
  let muted = options.muted ?? false;
  let material: AudioMaterialId = options.material ?? 'metal';
  let graph: Graph | null = null;
  let active: Selected[] = [];
  let background: { level: number; frequency: number } | null = null;
  let activeMotors: MotorHum[] = [];
  const synths = new Map<string, MeshVoiceSynth>();
  const motorSynths = new Map<MotorId, MotorHumSynth>();
  const rattles = new Map<string, LockRattle>();
  // 前のフレームで鳴らしていた組の、クリックの時刻を求める歯車のシャフトの角度
  const prevAngles = new Map<string, number>();
  let prevLocks: readonly LockInfo[] = [];
  let rattling: string[] = [];
  let impacts = 0;
  let rackHits = 0;
  let impactTimes: number[] = [];
  let clock = 0; // update の dt の積算（秒）。衝撃音の回数の制限に使う

  const targetGain = (): number => (muted ? 0 : MASTER_GAIN);

  const resume = (ctx: AudioContext): void => {
    if (ctx.state !== 'suspended') return;
    ctx.resume().catch((err: unknown) => {
      console.warn('音を開始できなかった', err);
    });
  };

  const updateMeshVoices = (frame: AudioFrame, listener: Vec3): void => {
    const candidates: Selected[] = frame.voices.map((v) => ({
      ...v,
      level: backgroundToneLevel(v.frequency, material),
    }));
    const previous = new Set(active.map((v) => v.key));
    const { selected, rest } = selectVoices(candidates, listener, previous, MAX_AUDIO_VOICES);
    active = selected;
    background = summarizeBackground(rest, listener);
    const keys = new Set(active.map((v) => v.key));
    for (const [key, synth] of synths) {
      if (keys.has(key)) continue;
      synth.dispose();
      synths.delete(key);
    }
    for (const key of [...prevAngles.keys()]) {
      if (!keys.has(key)) prevAngles.delete(key);
    }
    graph?.background.set(background);
    const ctx = graph?.ctx;
    for (const voice of active) {
      // 遊星のかみ合い（S3-05）は、キャリアに対する相対の角度で歯の通過を数える
      const carrierAngle =
        voice.carrierShaftId === undefined ? 0 : (frame.angles[voice.carrierShaftId] ?? 0);
      const angle = (frame.angles[voice.shaftId] ?? 0) - carrierAngle;
      const prev = prevAngles.get(voice.key);
      prevAngles.set(voice.key, angle);
      if (graph === null || ctx === undefined) continue;
      let synth = synths.get(voice.key);
      if (synth === undefined) {
        synth = createMeshVoiceSynth(ctx, graph.master, graph.noise, material, voice.position);
        synths.set(voice.key, synth);
      } else {
        synth.setPosition(voice.position);
      }
      // 種類ごとの音色（S2-05）: 連続音とクリックの音量に倍率を掛け、すべりの雑音を足す
      const timbre = meshTimbre(voice.kind);
      const tone = toneParams(voice.frequency, material);
      synth.setTone(tone.frequency, tone.level * timbre.hum);
      synth.setLowpassScale(timbre.lowpass);
      synth.setSlide(voice.slide);
      if (prev === undefined || voice.click <= 0) continue;
      // 歯の境目を跨いだ時刻をフレームの中で補間し、遅れを足して予約する
      const times = toothPassTimes(prev, angle, voice.teeth, frame.dt);
      if (!shouldScheduleClicks(times.length, frame.dt)) continue;
      const now = ctx.currentTime;
      for (const t of times) {
        const time = Math.max(now, now - frame.dt + t + CLICK_LATENCY);
        synth.click(clickParams(material, random), time, voice.click * timbre.click);
      }
    }
  };

  const updateMotors = (frame: AudioFrame, listener: Vec3): void => {
    const candidates = frame.motors.map((m) => ({ ...m, key: m.motorId }));
    const previous = new Set(activeMotors.map((m) => m.motorId));
    const { selected } = selectVoices(candidates, listener, previous, MAX_MOTOR_VOICES);
    activeMotors = selected.sort((a, b) => (a.motorId < b.motorId ? -1 : 1));
    const ids = new Set(activeMotors.map((m) => m.motorId));
    for (const [id, synth] of motorSynths) {
      if (ids.has(id)) continue;
      synth.dispose();
      motorSynths.delete(id);
    }
    if (graph === null) return;
    for (const m of activeMotors) {
      let synth = motorSynths.get(m.motorId);
      if (synth === undefined) {
        synth = createMotorHumSynth(
          graph.ctx,
          graph.master,
          graph.noise,
          m.size,
          m.position,
          random,
        );
        motorSynths.set(m.motorId, synth);
      }
      synth.update(m, frame.dt);
    }
  };

  // 大きさが変わったモーターは、ローパスの周波数が変わるので音源を作り直す
  const motorSizes = new Map<MotorId, string>();
  const dropResizedMotors = (motors: readonly MotorHum[]): void => {
    for (const m of motors) {
      const before = motorSizes.get(m.motorId);
      if (before !== undefined && before !== m.size) {
        motorSynths.get(m.motorId)?.dispose();
        motorSynths.delete(m.motorId);
      }
      motorSizes.set(m.motorId, m.size);
    }
  };

  const updateLocks = (frame: AudioFrame): void => {
    const next = frame.locks.map((l) => l.info);
    const { entered } = diffLocks(prevLocks, next);
    // ラックが端に当たった瞬間（S3-05）は、ロックの衝撃音の代わりに当たる音を 1 回鳴らす（その後はガタガタ）
    const hits = new Set(rackEndHits(prevLocks, next).map(lockKey));
    prevLocks = next;
    const positions = new Map(frame.locks.map((l) => [lockKey(l.info), l.position]));
    impactTimes = impactTimes.filter((t) => t > clock - LOCK_IMPACT_WINDOW_SEC);
    for (const key of hits) {
      rackHits += 1;
      const position = positions.get(key);
      if (graph !== null && position !== null && position !== undefined) {
        playRackHit(graph.ctx, graph.master, graph.noise, material, position, random);
      }
    }
    for (const key of entered) {
      if (hits.has(key)) continue;
      if (!canPlayImpact(impactTimes, clock)) break;
      impactTimes.push(clock);
      impacts += 1;
      const position = positions.get(key);
      if (graph !== null && position !== null && position !== undefined) {
        playLockImpact(graph.ctx, graph.master, graph.noise, material, position, random);
      }
    }
    rattling = [...positions.keys()].sort();
    for (const [key, rattle] of rattles) {
      if (positions.has(key)) continue;
      rattle.dispose();
      rattles.delete(key);
    }
    if (graph === null) return;
    for (const [key, position] of positions) {
      if (position === null || position === undefined) continue;
      const rattle = rattles.get(key);
      if (rattle === undefined) {
        rattles.set(
          key,
          createLockRattle(graph.ctx, graph.master, graph.noise, material, position),
        );
      } else {
        rattle.setPosition(position);
      }
    }
  };

  return {
    start() {
      if (graph !== null) {
        resume(graph.ctx);
        return;
      }
      let ctx: AudioContext;
      try {
        ctx = createContext();
      } catch (err) {
        console.warn('AudioContext を作れなかった', err);
        return;
      }
      // 主音量 → 重なったときに割れないようにするリミッター → 出力
      const master = ctx.createGain();
      master.gain.value = targetGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.ratio.value = 12;
      master.connect(limiter).connect(ctx.destination);
      const noise = createNoiseBuffer(ctx);
      // 背景のうなりはパンなしで主音量に直接つなぐ（ミュートが効く）
      const bg = createBackgroundSynth(ctx, master, noise, material);
      graph = { ctx, master, noise, background: bg };
      resume(ctx);
    },
    setMuted(next) {
      if (next === muted) return;
      muted = next;
      if (graph === null) return;
      // 主音量を 50 ms で滑らかに変える（プツッと鳴らさない）
      const { ctx, master } = graph;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(targetGain(), now + MUTE_RAMP_SEC);
    },
    setMaterial(next) {
      if (next === material) return;
      material = next;
      for (const synth of synths.values()) synth.setMaterial(next);
      graph?.background.setMaterial(next);
    },
    update(frame) {
      clock += Math.max(0, frame.dt);
      const listener = frame.listener.position;
      if (graph !== null) applyListener(graph.ctx, frame.listener);
      updateMeshVoices(frame, listener);
      dropResizedMotors(frame.motors);
      updateMotors(frame, listener);
      updateLocks(frame);
    },
    state() {
      return {
        contextState: graph === null ? 'none' : graph.ctx.state,
        muted,
        material,
        voices: active.map((v) => ({
          key: v.key,
          frequency: v.frequency,
          click: v.click,
          tone: v.tone,
          position: v.position,
          kind: v.kind,
          slide: v.slide,
        })),
        background: background === null ? null : { ...background },
        motors: activeMotors.map((m) => ({
          motorId: m.motorId,
          frequency: m.frequency,
          strain: m.strain,
          grind: m.grind,
        })),
        lockSounds: { impacts, rattling: [...rattling], rackHits },
      };
    },
  };
}
