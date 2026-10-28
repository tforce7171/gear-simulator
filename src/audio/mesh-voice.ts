import {
  type ClickParams,
  MATERIALS,
  slideNoiseParams,
  VOICE_FADE_SEC,
} from '../core/audio-model';
import type { Vec3 } from '../core/math/vec3';
import type { AudioMaterialId } from '../core/theme';
import { createPanner, type Panner } from './panner';

// かみ合い 1 組分の合成（S1-25）: 連続音（倍音の発振器 → ローパス）＋ざらつきのノイズと、予約するクリック。
// ウォーム・ねじ歯車の組（S2-05）は、すべりの雑音（ループするノイズ → 帯域を絞ったフィルタ）を足す。
// 出力は PannerNode で 3D に置く（S1-26）。作るときに 100 ms でフェードインする

// 連続音の高さ・音量を追いかける時定数（秒）。値を飛ばさずに滑らかに変えてプツッと鳴らさない
const PARAM_SMOOTHING = 0.02;
// 音源を消すときのフェードアウト（秒）
const RELEASE_SEC = VOICE_FADE_SEC;
// クリックのエンベロープの立ち上がり（秒）。0 から急に上げるとプツッと鳴るため
const CLICK_ATTACK_SEC = 0.001;
// 指数の減衰で鳴り終わったとみなす時間（減衰時間の倍数。約 −52 dB）
const CLICK_TAIL_FACTOR = 6;
// ざらつきのノイズを通す帯域フィルタの Q
const GRIT_Q = 1.5;
// クリックのノイズの音量（クリックの音量に対する比）
const CLICK_NOISE_RATIO = 0.8;

export interface MeshVoiceSynth {
  // 連続音の基本周波数（Hz）と音量
  setTone(frequency: number, level: number): void;
  // time（コンテキストの時刻）にクリックを 1 回鳴らす。gain はクロスフェードの重み
  click(params: ClickParams, time: number, gain: number): void;
  // すべりの雑音の強さ（0〜1。slideNoiseLevel。S2-05）
  setSlide(level: number): void;
  setMaterial(material: AudioMaterialId): void;
  // 音源の位置（かみ合いの接点。mm）
  setPosition(position: Vec3): void;
  // フェードアウトして止め、ノードを切り離す
  dispose(): void;
}

export function periodicWave(ctx: BaseAudioContext, harmonics: readonly number[]): PeriodicWave {
  const real = new Float32Array(harmonics.length + 1);
  const imag = new Float32Array(harmonics.length + 1);
  harmonics.forEach((amp, i) => {
    imag[i + 1] = amp;
  });
  return ctx.createPeriodicWave(real, imag);
}

export function createMeshVoiceSynth(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  initialMaterial: AudioMaterialId,
  position: Vec3,
): MeshVoiceSynth {
  let material = initialMaterial;
  let level = 0;
  const panner: Panner = createPanner(ctx, destination, position);
  const output = ctx.createGain();
  // 入れ替わりでプツッと鳴らないように、0 から 100 ms で上げる
  output.gain.setValueAtTime(0, ctx.currentTime);
  output.gain.linearRampToValueAtTime(1, ctx.currentTime + VOICE_FADE_SEC);
  output.connect(panner.node);

  // 連続音: 倍音を持つ発振器 → ローパス → 音量
  const osc = ctx.createOscillator();
  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  const toneGain = ctx.createGain();
  toneGain.gain.value = 0;
  osc.connect(toneFilter).connect(toneGain).connect(output);

  // ざらつき: ノイズ → 基本周波数のまわりの帯域 → 音量（連続音の音量 × 材質のノイズの量）
  const grit = ctx.createBufferSource();
  grit.buffer = noise;
  grit.loop = true;
  const gritFilter = ctx.createBiquadFilter();
  gritFilter.type = 'bandpass';
  gritFilter.Q.value = GRIT_Q;
  const gritGain = ctx.createGain();
  gritGain.gain.value = 0;
  grit.connect(gritFilter).connect(gritGain).connect(output);

  // すべりの雑音（S2-05）: ノイズ → 帯域を絞ったフィルタ → 音量。強さ 0 の組では音量 0 のまま
  let slideLevel = 0;
  const slide = ctx.createBufferSource();
  slide.buffer = noise;
  slide.loop = true;
  const slideFilter = ctx.createBiquadFilter();
  slideFilter.type = 'bandpass';
  const slideGain = ctx.createGain();
  slideGain.gain.value = 0;
  slide.connect(slideFilter).connect(slideGain).connect(output);
  const applySlide = (): void => {
    const p = slideNoiseParams(slideLevel, material);
    const now = ctx.currentTime;
    slideFilter.frequency.setTargetAtTime(p.frequency, now, PARAM_SMOOTHING);
    slideFilter.Q.setTargetAtTime(p.q, now, PARAM_SMOOTHING);
    slideGain.gain.setTargetAtTime(p.gain, now, PARAM_SMOOTHING);
  };

  const applyMaterial = (): void => {
    const tone = MATERIALS[material].tone;
    osc.setPeriodicWave(periodicWave(ctx, tone.harmonics));
    toneFilter.frequency.setTargetAtTime(tone.lowpass, ctx.currentTime, PARAM_SMOOTHING);
    gritGain.gain.setTargetAtTime(level * tone.noise, ctx.currentTime, PARAM_SMOOTHING);
    applySlide();
  };
  const initialSlide = slideNoiseParams(0, material);
  slideFilter.frequency.value = initialSlide.frequency;
  slideFilter.Q.value = initialSlide.q;
  toneFilter.frequency.value = MATERIALS[material].tone.lowpass;
  applyMaterial();
  osc.start();
  grit.start(0, Math.random() * noise.duration);
  slide.start(0, Math.random() * noise.duration);

  let disposed = false;
  return {
    setTone(frequency, nextLevel) {
      if (disposed) return;
      level = nextLevel;
      const now = ctx.currentTime;
      osc.frequency.setTargetAtTime(frequency, now, PARAM_SMOOTHING);
      gritFilter.frequency.setTargetAtTime(frequency * 2, now, PARAM_SMOOTHING);
      toneGain.gain.setTargetAtTime(nextLevel, now, PARAM_SMOOTHING);
      gritGain.gain.setTargetAtTime(
        nextLevel * MATERIALS[material].tone.noise,
        now,
        PARAM_SMOOTHING,
      );
    },
    click(params, time, gain) {
      if (disposed) return;
      playClick(ctx, output, noise, params, time, gain);
    },
    setSlide(next) {
      if (disposed || next === slideLevel) return;
      slideLevel = next;
      applySlide();
    },
    setMaterial(next) {
      if (disposed || next === material) return;
      material = next;
      applyMaterial();
    },
    setPosition(next) {
      if (disposed) return;
      panner.setPosition(next);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + RELEASE_SEC);
      osc.stop(now + RELEASE_SEC + 0.01);
      grit.stop(now + RELEASE_SEC + 0.01);
      slide.stop(now + RELEASE_SEC + 0.01);
      osc.onended = () => {
        output.disconnect();
        panner.dispose();
      };
    },
  };
}

// time（コンテキストの時刻）にクリックを 1 回鳴らす。gain はクリックの音量に掛ける倍率
export function playClick(
  ctx: BaseAudioContext,
  output: AudioNode,
  noise: AudioBuffer,
  params: ClickParams,
  time: number,
  gain: number,
): void {
  if (gain <= 0) return;
  const peak = params.gain * gain;
  // 共鳴の部分音: 正弦波を指数で減衰させる。高い部分音ほど小さく（1, 1/2, 1/3, …）
  params.partials.forEach((partial, i) => {
    const o = ctx.createOscillator();
    o.frequency.value = partial.frequency;
    const g = ctx.createGain();
    envelope(g.gain, time, (peak / (i + 1)) * 0.6, partial.decay);
    o.connect(g).connect(output);
    const end = time + CLICK_ATTACK_SEC + partial.decay * CLICK_TAIL_FACTOR;
    o.start(time);
    o.stop(end);
    o.onended = () => g.disconnect();
  });
  // ノイズの成分: 材質のフィルタを通した短いノイズ
  const n = ctx.createBufferSource();
  n.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = params.noise.type;
  f.frequency.value = params.noise.frequency;
  const g = ctx.createGain();
  envelope(g.gain, time, peak * CLICK_NOISE_RATIO, params.noise.decay);
  n.connect(f).connect(g).connect(output);
  const end = time + CLICK_ATTACK_SEC + params.noise.decay * CLICK_TAIL_FACTOR;
  n.start(time, Math.random() * Math.max(0, noise.duration - 0.2));
  n.stop(end);
  n.onended = () => g.disconnect();
}

// 短い立ち上がりのあと、時定数 decay で指数に減衰する音量
export function envelope(param: AudioParam, time: number, peak: number, decay: number): void {
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + CLICK_ATTACK_SEC);
  param.setTargetAtTime(0, time + CLICK_ATTACK_SEC, decay);
}
