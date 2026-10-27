import {
  activeVoices,
  CLICK_LATENCY,
  clickParams,
  MASTER_GAIN,
  type MeshVoice,
  MUTE_RAMP_SEC,
  shouldScheduleClicks,
  toneParams,
  toothPassTimes,
} from '../core/audio-model';
import type { ShaftId } from '../core/scene/types';
import type { AudioMaterialId } from '../core/theme';
import { createMeshVoiceSynth, type MeshVoiceSynth } from './mesh-voice';

// 音の再生（S1-25）。AudioContext の開始、主音量とミュート、かみ合いごとの音源の出し入れと毎フレームの更新。
// 何を鳴らすかの計算は core/audio-model に任せ、ここは結果をノードに流すだけ

// ノイズの素（白色雑音）の長さ（秒）。実行時に作る（録音素材は使わない）
const NOISE_SECONDS = 1;

export interface AudioState {
  contextState: 'none' | AudioContextState; // 作る前は 'none'
  muted: boolean;
  material: AudioMaterialId;
  // 今鳴らしている（鳴らす対象の）かみ合い。frequency は歯の通過頻度（Hz）
  voices: Array<{ key: string; frequency: number; click: number; tone: number }>;
}

export interface AudioEngine {
  // AudioContext を作って resume する（2 回目以降は止まっていれば resume するだけ）。ユーザー操作の中で呼ぶ
  start(): void;
  setMuted(muted: boolean): void;
  setMaterial(material: AudioMaterialId): void;
  // 毎フレーム: かみ合いの音源の状態と、シャフトの角度、前のフレームからの経過時間（秒）
  update(voices: readonly MeshVoice[], angles: Readonly<Record<ShaftId, number>>, dt: number): void;
  state(): AudioState;
}

export interface AudioEngineOptions {
  readonly createContext?: () => AudioContext;
  readonly random?: () => number; // クリックの高さの揺らぎ
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
}

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const createContext = options.createContext ?? (() => new AudioContext());
  const random = options.random ?? Math.random;
  let muted = options.muted ?? false;
  let material: AudioMaterialId = options.material ?? 'metal';
  let graph: Graph | null = null;
  let active: MeshVoice[] = [];
  const synths = new Map<string, MeshVoiceSynth>();
  // 前のフレームで鳴らしていた組の、クリックの時刻を求める歯車のシャフトの角度
  const prevAngles = new Map<string, number>();

  const targetGain = (): number => (muted ? 0 : MASTER_GAIN);

  const resume = (ctx: AudioContext): void => {
    if (ctx.state !== 'suspended') return;
    ctx.resume().catch((err: unknown) => {
      console.warn('音を開始できなかった', err);
    });
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
      graph = { ctx, master, noise: createNoiseBuffer(ctx) };
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
    },
    update(voices, angles, dt) {
      active = activeVoices(voices);
      const keys = new Set(active.map((v) => v.key));
      for (const [key, synth] of synths) {
        if (keys.has(key)) continue;
        synth.dispose();
        synths.delete(key);
      }
      for (const key of [...prevAngles.keys()]) {
        if (!keys.has(key)) prevAngles.delete(key);
      }
      const ctx = graph?.ctx;
      for (const voice of active) {
        const angle = angles[voice.shaftId] ?? 0;
        const prev = prevAngles.get(voice.key);
        prevAngles.set(voice.key, angle);
        if (graph === null || ctx === undefined) continue;
        let synth = synths.get(voice.key);
        if (synth === undefined) {
          synth = createMeshVoiceSynth(ctx, graph.master, graph.noise, material);
          synths.set(voice.key, synth);
        }
        const tone = toneParams(voice.frequency, material);
        synth.setTone(tone.frequency, tone.level);
        if (prev === undefined || voice.click <= 0) continue;
        // 歯の境目を跨いだ時刻をフレームの中で補間し、遅れを足して予約する
        const times = toothPassTimes(prev, angle, voice.teeth, dt);
        if (!shouldScheduleClicks(times.length, dt)) continue;
        const now = ctx.currentTime;
        for (const t of times) {
          const time = Math.max(now, now - dt + t + CLICK_LATENCY);
          synth.click(clickParams(material, random), time, voice.click);
        }
      }
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
        })),
      };
    },
  };
}
