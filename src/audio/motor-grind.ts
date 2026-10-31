import {
  MOTOR_GRIND_AM_HZ,
  MOTOR_GRIND_LEVEL,
  MOTOR_GRIND_Q,
  VOICE_FADE_SEC,
} from '../core/audio-model';
import type { Vec3 } from '../core/math/vec3';
import { createPanner } from './panner';

// モーターのきしみ（S1-26）: 逆に回されているときだけ、帯域ノイズ（中心 grindFrequency、Q 4）を 7 Hz の不規則な
// 振幅変調で鳴らす。S4-06 でのこぎり波のうなり（「ジー」）はやめた

const PARAM_SMOOTHING = 0.03;
// きしみの振幅変調の 1 回ごとの変化の時定数（秒）
const GRIND_AM_SMOOTHING = 0.015;

export interface MotorGrindParams {
  readonly grind: number;
  readonly grindFrequency: number;
  readonly position: Vec3;
}

export interface MotorGrindSynth {
  // 毎フレーム。dt は経過時間（秒。きしみの振幅変調を進める）
  update(params: MotorGrindParams, dt: number): void;
  dispose(): void;
}

export function createMotorGrindSynth(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  position: Vec3,
  random: () => number,
): MotorGrindSynth {
  const panner = createPanner(ctx, destination, position);
  const output = ctx.createGain();
  output.gain.setValueAtTime(0, ctx.currentTime);
  output.gain.linearRampToValueAtTime(1, ctx.currentTime + VOICE_FADE_SEC);
  output.connect(panner.node);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = MOTOR_GRIND_Q;
  const grindGain = ctx.createGain();
  grindGain.gain.value = 0;
  src.connect(band).connect(grindGain).connect(output);
  src.start(0, Math.random() * noise.duration);

  // 振幅変調: 平均 1/7 秒ごとに、間隔と強さを乱数で揺らして次の目標の音量を決める
  let untilNext = 0;
  let disposed = false;
  return {
    update(params, dt) {
      if (disposed) return;
      const now = ctx.currentTime;
      band.frequency.setTargetAtTime(params.grindFrequency, now, PARAM_SMOOTHING);
      panner.setPosition(params.position);
      if (params.grind <= 0) {
        grindGain.gain.setTargetAtTime(0, now, PARAM_SMOOTHING);
        untilNext = 0;
        return;
      }
      untilNext -= dt;
      if (untilNext > 0) return;
      untilNext = (0.6 + 0.8 * random()) / MOTOR_GRIND_AM_HZ;
      const depth = 0.25 + 0.75 * random();
      grindGain.gain.setTargetAtTime(
        MOTOR_GRIND_LEVEL * params.grind * depth,
        now,
        GRIND_AM_SMOOTHING,
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + VOICE_FADE_SEC);
      src.stop(now + VOICE_FADE_SEC + 0.01);
      src.onended = () => {
        output.disconnect();
        panner.dispose();
      };
    },
  };
}
