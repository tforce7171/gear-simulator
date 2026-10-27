import {
  BACKGROUND_NOISE_Q,
  BACKGROUND_NOISE_RATIO,
  MATERIALS,
  VOICE_FADE_SEC,
} from '../core/audio-model';
import type { AudioMaterialId } from '../core/theme';
import { periodicWave } from './mesh-voice';

// 背景のうなり（S1-26）: 選ばれなかったかみ合いをまとめた、パンなしの 1 つの音源。
// 材質の倍音の連続音 ＋ 同じ周波数を中心にした帯域ノイズ（Q 1、連続音の 0.5 倍）

const PARAM_SMOOTHING = 0.05;

export interface BackgroundSynth {
  // null で止める（100 ms で 0 へ）
  set(params: { level: number; frequency: number } | null): void;
  setMaterial(material: AudioMaterialId): void;
}

export function createBackgroundSynth(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  initialMaterial: AudioMaterialId,
): BackgroundSynth {
  let material = initialMaterial;
  const osc = ctx.createOscillator();
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = MATERIALS[material].tone.lowpass;
  const toneGain = ctx.createGain();
  toneGain.gain.value = 0;
  osc.connect(lowpass).connect(toneGain).connect(destination);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = BACKGROUND_NOISE_Q;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  src.connect(band).connect(noiseGain).connect(destination);

  const applyMaterial = (): void => {
    const tone = MATERIALS[material].tone;
    osc.setPeriodicWave(periodicWave(ctx, tone.harmonics));
    lowpass.frequency.setTargetAtTime(tone.lowpass, ctx.currentTime, PARAM_SMOOTHING);
  };
  applyMaterial();
  osc.start();
  src.start(0, Math.random() * noise.duration);

  return {
    set(params) {
      const now = ctx.currentTime;
      if (params === null) {
        // 時定数 = 100 ms の 1/3 で、100 ms でほぼ 0 にする
        toneGain.gain.setTargetAtTime(0, now, VOICE_FADE_SEC / 3);
        noiseGain.gain.setTargetAtTime(0, now, VOICE_FADE_SEC / 3);
        return;
      }
      osc.frequency.setTargetAtTime(params.frequency, now, PARAM_SMOOTHING);
      band.frequency.setTargetAtTime(params.frequency, now, PARAM_SMOOTHING);
      toneGain.gain.setTargetAtTime(params.level, now, PARAM_SMOOTHING);
      noiseGain.gain.setTargetAtTime(params.level * BACKGROUND_NOISE_RATIO, now, PARAM_SMOOTHING);
    },
    setMaterial(next) {
      if (next === material) return;
      material = next;
      applyMaterial();
    },
  };
}
