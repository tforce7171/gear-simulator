import {
  BACKGROUND_TIME_JITTER,
  CLICK_LATENCY,
  clickParams,
  grainTimes,
  jitterTimes,
} from '../core/audio-model';
import type { AudioMaterialId } from '../core/theme';
import { playClick } from './mesh-voice';

// 背景（S1-26）: 選ばれなかったかみ合いをまとめた、パンなしの 1 つの音源。
// S4-06 で持続音（倍音の連続音＋帯域ノイズ）をやめ、粒の音を重ねたざわざわにした: 毎秒 rate 粒を、時刻を大きく揺らして
// 打つ。粒の高さは代表の歯の通過頻度 frequency の clickPitch、音量は level

export interface BackgroundParams {
  readonly level: number;
  readonly frequency: number;
  readonly rate: number;
}

export interface BackgroundSynth {
  // 毎フレーム。null で止める（もう粒を打たない）。dt は前のフレームからの経過時間（秒）
  set(params: BackgroundParams | null, dt: number): void;
  setMaterial(material: AudioMaterialId): void;
}

export function createBackgroundSynth(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  initialMaterial: AudioMaterialId,
  random: () => number,
): BackgroundSynth {
  let material = initialMaterial;
  let carry = 0;
  return {
    set(params, dt) {
      if (params === null || !(params.level > 0) || !(params.rate > 0)) {
        carry = 0;
        return;
      }
      const base = grainTimes(params.rate, dt, carry);
      carry = base.carry;
      const times = jitterTimes(
        base.times,
        1 / params.rate,
        BACKGROUND_TIME_JITTER,
        Number.POSITIVE_INFINITY,
        random,
      );
      const now = ctx.currentTime;
      for (const t of times) {
        const time = Math.max(now, now - dt + t + CLICK_LATENCY);
        playClick(
          ctx,
          destination,
          noise,
          clickParams(material, random, params.frequency),
          time,
          params.level,
        );
      }
    },
    setMaterial(next) {
      material = next;
    },
  };
}
