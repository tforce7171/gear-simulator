import {
  buzzLevel,
  CLICK_LATENCY,
  canPlayImpact,
  clickParams,
  clickPitch,
  clickRate,
  diffLocks,
  grainLevel,
  LOCK_IMPACT_WINDOW_SEC,
  lockKey,
  MASTER_GAIN,
  MAX_MOTOR_VOICES,
  type MeshVoice,
  type MotorVoice,
  MUTE_RAMP_SEC,
  meshGrainTimes,
  meshTimbre,
  rackEndHits,
  selectVoices,
  summarizeBackground,
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
import { createMotorGrindSynth, type MotorGrindSynth } from './motor-grind';
import { applyListener, type ListenerPose } from './panner';

// 音の再生（S1-25・S1-26）。AudioContext の開始、主音量とミュート、かみ合いごとの音源の出し入れと毎フレームの更新、
// リスナー（カメラ）、背景のざわざわ、モーターのきしみ、ロックの音（S4-06 で連続音とモーターのうなりをやめ、粒の音にした）。
// 何を鳴らすかの計算は core/audio-model に任せ、ここは結果をノードに流すだけ

// ノイズの素（白色雑音）の長さ（秒）。実行時に作る（録音素材は使わない）
const NOISE_SECONDS = 1;

export interface AudioState {
  contextState: 'none' | AudioContextState; // 作る前は 'none'
  muted: boolean;
  material: AudioMaterialId;
  // 今鳴らしている（鳴らす対象の）かみ合い。frequency は歯の通過頻度（Hz）、position は接点、
  // kind はかみ合いの種類（音色。S2-05。ラックの組は 'rack'。S3-05）、slide はすべりの雑音の強さ（0〜1。S2-05）。
  // S4-06: rate は毎秒の粒の数（clickRate）、pitch は粒の中心周波数（Hz。clickPitch × 種類の pitch）、
  // clicks はこの組で予約した粒の数（鳴らし始めてからの累計）
  voices: Array<{
    key: string;
    frequency: number;
    rate: number;
    pitch: number;
    clicks: number;
    position: Vec3;
    kind: VoiceKind;
    slide: number;
  }>;
  // 選ばれなかった組をまとめた背景（粒のざわざわ。rate は毎秒の粒の数。S4-06）。無ければ null
  background: { level: number; frequency: number; rate: number } | null;
  // 今鳴らしているモーターの音源（motorId の昇順）。strain が負荷、grind が過負荷のきしみの強さ（S4-06 でうなりの周波数をやめた）
  motors: Array<{ motorId: MotorId; strain: number; grind: number }>;
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
  readonly motors: readonly MotorVoice[]; // computeMotorVoices（一時停止中は空）
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
  readonly random?: () => number; // 粒の高さ・時刻の揺らぎ、きしみの振幅変調
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
type Background = { level: number; frequency: number; rate: number };

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const createContext = options.createContext ?? (() => new AudioContext());
  const random = options.random ?? Math.random;
  let muted = options.muted ?? false;
  let material: AudioMaterialId = options.material ?? 'metal';
  let graph: Graph | null = null;
  let active: Selected[] = [];
  let background: Background | null = null;
  let activeMotors: MotorVoice[] = [];
  const synths = new Map<string, MeshVoiceSynth>();
  const motorSynths = new Map<MotorId, MotorGrindSynth>();
  const rattles = new Map<string, LockRattle>();
  // 前のフレームで鳴らしていた組の、粒の時刻を求める歯車のシャフトの角度
  const prevAngles = new Map<string, number>();
  // 鳴らしている組の、間引いて打つときの端数（meshGrainTimes の carry）と、予約した粒の数
  const carries = new Map<string, number>();
  const clickCounts = new Map<string, number>();
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
      level: grainLevel(v.frequency, material),
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
    for (const map of [prevAngles, carries, clickCounts]) {
      for (const key of [...map.keys()]) {
        if (!keys.has(key)) map.delete(key);
      }
    }
    graph?.background.set(background, frame.dt);
    const ctx = graph?.ctx;
    for (const voice of active) {
      // 遊星のかみ合い（S3-05）は、キャリアに対する相対の角度で歯の通過を数える
      const carrierAngle =
        voice.carrierShaftId === undefined ? 0 : (frame.angles[voice.carrierShaftId] ?? 0);
      const angle = (frame.angles[voice.shaftId] ?? 0) - carrierAngle;
      const prev = prevAngles.get(voice.key);
      prevAngles.set(voice.key, angle);
      // 粒の時刻（S4-06）: 遅ければ歯の通過ごと、速ければ毎秒 CLICK_RATE_MAX 粒に間引き、時刻を少し揺らす
      let times: number[] = [];
      if (prev !== undefined) {
        const grains = meshGrainTimes(
          prev,
          angle,
          voice.teeth,
          frame.dt,
          voice.frequency,
          carries.get(voice.key) ?? 0,
          random,
        );
        carries.set(voice.key, grains.carry);
        times = grains.times;
        clickCounts.set(voice.key, (clickCounts.get(voice.key) ?? 0) + times.length);
      }
      if (graph === null || ctx === undefined) continue;
      let synth = synths.get(voice.key);
      if (synth === undefined) {
        synth = createMeshVoiceSynth(ctx, graph.master, graph.noise, material, voice.position);
        synths.set(voice.key, synth);
      } else {
        synth.setPosition(voice.position);
      }
      // 種類ごとの音色（S2-05）: 粒の音量と高さに倍率を掛け、すべりの雑音を足す。
      // 速く回した金属の組の「ジー」（S5-03）も同じ経路で鳴らす（強さはすべりの雑音との大きいほう）
      const timbre = meshTimbre(voice.kind);
      synth.setSlide(Math.max(voice.slide, buzzLevel(voice.frequency, material, voice.kind)));
      // 歯の境目を跨いだ時刻をフレームの中で補間し、遅れを足して予約する
      const now = ctx.currentTime;
      for (const t of times) {
        const time = Math.max(now, now - frame.dt + t + CLICK_LATENCY);
        synth.click(
          clickParams(material, random, voice.frequency, timbre.pitch),
          time,
          timbre.click,
        );
      }
    }
  };

  const updateMotors = (frame: AudioFrame, listener: Vec3): void => {
    // 選び方は距離だけで決める（モーターの音源には歯の通過頻度が無いので、動いている候補として 1 を渡す）
    const candidates = frame.motors.map((m) => ({ ...m, key: m.motorId, frequency: 1, level: 0 }));
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
        synth = createMotorGrindSynth(graph.ctx, graph.master, graph.noise, m.position, random);
        motorSynths.set(m.motorId, synth);
      }
      synth.update(m, frame.dt);
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
      // 背景のざわざわはパンなしで主音量に直接つなぐ（ミュートが効く）
      const bg = createBackgroundSynth(ctx, master, noise, material, random);
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
          rate: clickRate(v.frequency),
          pitch: clickPitch(v.frequency, material) * meshTimbre(v.kind).pitch,
          clicks: clickCounts.get(v.key) ?? 0,
          position: v.position,
          kind: v.kind,
          slide: v.slide,
        })),
        background: background === null ? null : { ...background },
        motors: activeMotors.map((m) => ({
          motorId: m.motorId,
          strain: m.strain,
          grind: m.grind,
        })),
        lockSounds: { impacts, rattling: [...rattling], rackHits },
      };
    },
  };
}
