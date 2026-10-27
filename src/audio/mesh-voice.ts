import { type ClickParams, MATERIALS } from '../core/audio-model';
import type { AudioMaterialId } from '../core/theme';

// かみ合い 1 組分の合成（S1-25）: 連続音（倍音の発振器 → ローパス）＋ざらつきのノイズと、予約するクリック

// 連続音の高さ・音量を追いかける時定数（秒）。値を飛ばさずに滑らかに変えてプツッと鳴らさない
const PARAM_SMOOTHING = 0.02;
// 音源を消すときのフェードアウト（秒）
const RELEASE_SEC = 0.1;
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
  setMaterial(material: AudioMaterialId): void;
  // フェードアウトして止め、ノードを切り離す
  dispose(): void;
}

function periodicWave(ctx: BaseAudioContext, harmonics: readonly number[]): PeriodicWave {
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
): MeshVoiceSynth {
  let material = initialMaterial;
  let level = 0;
  const output = ctx.createGain();
  output.connect(destination);

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

  const applyMaterial = (): void => {
    const tone = MATERIALS[material].tone;
    osc.setPeriodicWave(periodicWave(ctx, tone.harmonics));
    toneFilter.frequency.setTargetAtTime(tone.lowpass, ctx.currentTime, PARAM_SMOOTHING);
    gritGain.gain.setTargetAtTime(level * tone.noise, ctx.currentTime, PARAM_SMOOTHING);
  };
  toneFilter.frequency.value = MATERIALS[material].tone.lowpass;
  applyMaterial();
  osc.start();
  grit.start(0, Math.random() * noise.duration);

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
      if (disposed || gain <= 0) return;
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
    },
    setMaterial(next) {
      if (disposed || next === material) return;
      material = next;
      applyMaterial();
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
      osc.onended = () => output.disconnect();
    },
  };
}

// 短い立ち上がりのあと、時定数 decay で指数に減衰する音量
function envelope(param: AudioParam, time: number, peak: number, decay: number): void {
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + CLICK_ATTACK_SEC);
  param.setTargetAtTime(0, time + CLICK_ATTACK_SEC, decay);
}
