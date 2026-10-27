import {
  clickParams,
  LOCK_IMPACT,
  LOCK_IMPACT_LEVEL,
  LOCK_RATTLE_HZ,
  LOCK_RATTLE_LEVEL,
  LOCK_RATTLE_RELEASE_SEC,
  MATERIALS,
} from '../core/audio-model';
import type { Vec3 } from '../core/math/vec3';
import type { AudioMaterialId } from '../core/theme';
import { envelope, playClick } from './mesh-voice';
import { createPanner } from './panner';

// ロックの音（S1-26）: ロックした瞬間の衝撃音（1 回）と、ロック中のガタガタ

// ガタガタのノイズを通す帯域フィルタの Q
const RATTLE_Q = 2;
// 衝撃音の低音が鳴り終わったとみなす時間（時定数の倍数）
const IMPACT_TAIL_FACTOR = 6;

// 衝撃音: 減衰する低音（金属 120 Hz・150 ms、木 90 Hz・80 ms）＋ 材質のクリック（金属は 3 倍）
export function playLockImpact(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  material: AudioMaterialId,
  position: Vec3,
  random: () => number,
): void {
  const p = LOCK_IMPACT[material];
  const panner = createPanner(ctx, destination, position);
  const time = ctx.currentTime;
  // 低音: 「長さ」を、指数の減衰が −52 dB 程度になるまでの時間とみなす（時定数 = 長さ / 6）
  const o = ctx.createOscillator();
  o.frequency.value = p.frequency;
  const g = ctx.createGain();
  const decay = p.duration / IMPACT_TAIL_FACTOR;
  envelope(g.gain, time, LOCK_IMPACT_LEVEL, decay);
  o.connect(g).connect(panner.node);
  o.start(time);
  o.stop(time + p.duration + 0.01);
  playClick(ctx, panner.node, noise, clickParams(material, random), time, p.clickGain);
  // クリックの尾より長く待ってから切り離す
  const tail = Math.max(p.duration, ...MATERIALS[material].click.partials.map((x) => x.decay * 6));
  o.onended = () => {
    g.disconnect();
    setTimeout(() => panner.dispose(), tail * 1000 + 50);
  };
}

export interface LockRattle {
  setPosition(position: Vec3): void;
  // 100 ms で止めて切り離す
  dispose(): void;
}

// ガタガタ: ノイズ → 材質のクリックの最初の部分音を中心にした帯域 → 18 Hz で振幅変調 → 音量 0.1
export function createLockRattle(
  ctx: BaseAudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  material: AudioMaterialId,
  position: Vec3,
): LockRattle {
  const panner = createPanner(ctx, destination, position);
  const output = ctx.createGain();
  output.gain.setValueAtTime(0, ctx.currentTime);
  output.gain.linearRampToValueAtTime(LOCK_RATTLE_LEVEL, ctx.currentTime + 0.02);
  output.connect(panner.node);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = MATERIALS[material].click.partials[0]?.frequency ?? 1000;
  band.Q.value = RATTLE_Q;
  // 振幅変調: 0〜1 を 18 Hz で行き来する（0.5 + 0.5 × 矩形波）
  const am = ctx.createGain();
  am.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = LOCK_RATTLE_HZ;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(am.gain);
  src.connect(band).connect(am).connect(output);
  src.start(0, Math.random() * noise.duration);
  lfo.start();

  let disposed = false;
  return {
    setPosition(p) {
      if (!disposed) panner.setPosition(p);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + LOCK_RATTLE_RELEASE_SEC);
      src.stop(now + LOCK_RATTLE_RELEASE_SEC + 0.01);
      lfo.stop(now + LOCK_RATTLE_RELEASE_SEC + 0.01);
      src.onended = () => {
        output.disconnect();
        panner.dispose();
      };
    },
  };
}
