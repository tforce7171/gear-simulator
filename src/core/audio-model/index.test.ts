import { describe, expect, it } from 'vitest';
import { MAX_AUDIO_VOICES } from '../constants';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import { resolveLayout } from '../layout/resolve';
import type { Scene } from '../scene/types';
import type { AudioMaterialId } from '../theme';
import {
  activeVoices,
  CLICK_JITTER,
  CLICK_MAX_HZ,
  clickParams,
  clickToneMix,
  computeMeshVoices,
  MATERIALS,
  type MeshVoice,
  meshKey,
  shouldScheduleClicks,
  TONE_MAX_HZ,
  TONE_MIN_HZ,
  toneParams,
  toothPassFrequency,
  toothPassTimes,
} from './index';

// S1-25: 音の計算

const MATERIAL_IDS: readonly AudioMaterialId[] = ['metal', 'wood'];

// シーン A（S1-23）: シャフト s1（モーター 小、60 rpm、向き +1）に歯車 g1（小、12 枚）。
// g1 の外周に g2（小、36 枚）、g2 の外周に g3（小、24 枚）
function sceneA(motor: { on?: boolean; rpm?: number } = {}): Scene {
  return {
    shafts: {
      shaft_s1: { id: 'shaft_s1', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
      shaft_s2: {
        id: 'shaft_s2',
        placement: { kind: 'mesh', parentGearId: 'gear_g1', childGearId: 'gear_g2', angle: 0 },
      },
      shaft_s3: {
        id: 'shaft_s3',
        placement: { kind: 'mesh', parentGearId: 'gear_g2', childGearId: 'gear_g3', angle: 0 },
      },
    },
    gears: {
      gear_g1: {
        id: 'gear_g1',
        kind: 'spur',
        shaftId: 'shaft_s1',
        size: 'S',
        teeth: 12,
        offset: 0,
      },
      gear_g2: {
        id: 'gear_g2',
        kind: 'spur',
        shaftId: 'shaft_s2',
        size: 'S',
        teeth: 36,
        offset: 0,
      },
      gear_g3: {
        id: 'gear_g3',
        kind: 'spur',
        shaftId: 'shaft_s3',
        size: 'S',
        teeth: 24,
        offset: 0,
      },
    },
    motors: {
      motor_m1: {
        id: 'motor_m1',
        shaftId: 'shaft_s1',
        size: 'S',
        rpm: motor.rpm ?? 60,
        direction: 1,
        on: motor.on ?? true,
      },
    },
  };
}

function voicesOf(scene: Scene): MeshVoice[] {
  const layout = resolveLayout(scene);
  const motion = solveMotion(scene, layout, initialMotionState());
  return computeMeshVoices(scene, layout, motion);
}

describe('定数', () => {
  it('境目は 15 Hz・30 Hz、連続音の上限は 2000 Hz', () => {
    expect(CLICK_MAX_HZ).toBe(15);
    expect(TONE_MIN_HZ).toBe(30);
    expect(TONE_MAX_HZ).toBe(2000);
  });
});

describe('meshKey', () => {
  it('2 つの ID を文字列順に並べて | でつなぐ', () => {
    expect(meshKey('gear_b', 'gear_a')).toBe('gear_a|gear_b');
    expect(meshKey('gear_a', 'gear_b')).toBe('gear_a|gear_b');
  });
});

describe('toothPassFrequency', () => {
  it('12 枚・60 rpm で 12 Hz、36 枚・逆向き 60 rpm で 36 Hz（向きは関係しない）', () => {
    expect(toothPassFrequency(12, 2 * Math.PI)).toBeCloseTo(12, 12);
    expect(toothPassFrequency(36, -2 * Math.PI)).toBeCloseTo(36, 12);
  });

  it('止まっていれば 0', () => {
    expect(toothPassFrequency(24, 0)).toBe(0);
  });
});

describe('clickToneMix', () => {
  it.each([
    [0, 1, 0],
    [10, 1, 0],
    [15, 1, 0],
    [22.5, Math.SQRT1_2, Math.SQRT1_2],
    [30, 0, 1],
    [200, 0, 1],
  ])('f = %f → click %f、tone %f', (f, click, tone) => {
    const mix = clickToneMix(f);
    expect(mix.click).toBeCloseTo(click, 4);
    expect(mix.tone).toBeCloseTo(tone, 4);
  });

  it('全域で click² + tone² ≈ 1（等パワー）', () => {
    for (let f = 0; f <= 60; f += 0.25) {
      const { click, tone } = clickToneMix(f);
      expect(click * click + tone * tone).toBeCloseTo(1, 9);
      expect(click).toBeGreaterThanOrEqual(0);
      expect(tone).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('toneParams', () => {
  it.each(MATERIAL_IDS)('%s: f = 5000 → 周波数 2000 にクランプ', (material) => {
    expect(toneParams(5000, material).frequency).toBe(2000);
  });

  it.each(MATERIAL_IDS)('%s: f = 30 → level = 0.6 × 材質の連続音の音量', (material) => {
    expect(toneParams(30, material).level).toBeCloseTo(0.6 * MATERIALS[material].tone.gain, 9);
  });

  it.each(MATERIAL_IDS)('%s: f = 400 と 800 で level が同じ（400 Hz 以上は 1.0）', (material) => {
    expect(toneParams(400, material).level).toBeCloseTo(toneParams(800, material).level, 12);
    expect(toneParams(400, material).level).toBeCloseTo(MATERIALS[material].tone.gain, 9);
  });

  it('f = 100 は基本周波数 100、クリックの範囲では level 0', () => {
    expect(toneParams(100, 'metal').frequency).toBe(100);
    expect(toneParams(10, 'metal').level).toBe(0);
  });

  it('クロスフェードの範囲では連続音の重みが掛かる（周波数は下限 30 にクランプ）', () => {
    const p = toneParams(24, 'metal');
    expect(p.frequency).toBe(TONE_MIN_HZ);
    expect(p.level).toBeGreaterThan(0);
    expect(p.level).toBeLessThan(0.6 * MATERIALS.metal.tone.gain * clickToneMix(24).tone + 1e-9);
  });
});

describe('toothPassTimes', () => {
  it('0 → 3.5 歯分（12 枚）を 0.1 秒で → 3 個、昇順、0〜0.1、1 個目 ≈ 0.1 × (1/3.5)', () => {
    const times = toothPassTimes(0, (2 * Math.PI * 3.5) / 12, 12, 0.1);
    expect(times).toHaveLength(3);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(0.1);
    }
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[0]).toBeCloseTo(0.1 * (1 / 3.5), 9);
  });

  it('逆回転（next < prev）でも同じ個数で、昇順', () => {
    const times = toothPassTimes((2 * Math.PI * 3.5) / 12, 0, 12, 0.1);
    expect(times).toHaveLength(3);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(0.1);
    }
  });

  it('跨がない（0 → 0.1 rad、12 枚）→ []', () => {
    expect(toothPassTimes(0, 0.1, 12, 0.1)).toEqual([]);
  });

  it('続けて呼んでも同じ境目を 2 回数えない（行き来しても 1 回ずつ）', () => {
    const step = (2 * Math.PI) / 12 / 4; // 1/4 歯ずつ
    let count = 0;
    let angle = 0.01;
    for (let i = 0; i < 40; i += 1) {
      const next = angle + step;
      count += toothPassTimes(angle, next, 12, 0.01).length;
      angle = next;
    }
    expect(count).toBe(10);
    for (let i = 0; i < 40; i += 1) {
      const next = angle - step;
      count += toothPassTimes(angle, next, 12, 0.01).length;
      angle = next;
    }
    expect(count).toBe(20);
  });

  it('dt が 0 以下なら []', () => {
    expect(toothPassTimes(0, 10, 12, 0)).toEqual([]);
  });
});

describe('clickParams', () => {
  it.each(MATERIAL_IDS)('%s: random = 0.5 なら揺らぎ 0（部分音が表の値ちょうど）', (material) => {
    const p = clickParams(material, () => 0.5);
    expect(p.partials.map((x) => x.frequency)).toEqual(
      MATERIALS[material].click.partials.map((x) => x.frequency),
    );
    expect(p.partials.map((x) => x.decay)).toEqual(
      MATERIALS[material].click.partials.map((x) => x.decay),
    );
    expect(p.noise).toEqual(MATERIALS[material].click.noise);
    expect(p.gain).toBe(MATERIALS[material].click.gain);
  });

  it.each(MATERIAL_IDS)('%s: random = 0 / 1 で −3% / +3%', (material) => {
    const base = MATERIALS[material].click.partials;
    const low = clickParams(material, () => 0);
    const high = clickParams(material, () => 1);
    expect(CLICK_JITTER).toBe(0.03);
    base.forEach((partial, i) => {
      expect(low.partials[i]?.frequency).toBeCloseTo(partial.frequency * 0.97, 9);
      expect(high.partials[i]?.frequency).toBeCloseTo(partial.frequency * 1.03, 9);
    });
  });

  it('表の値: 真鍮は 2400 / 3900 / 6100 Hz とハイパス、木は 420 / 950 Hz とローパス', () => {
    expect(MATERIALS.metal.click.partials.map((p) => p.frequency)).toEqual([2400, 3900, 6100]);
    expect(MATERIALS.metal.click.partials.map((p) => p.decay)).toEqual([0.08, 0.06, 0.04]);
    expect(MATERIALS.metal.click.noise).toEqual({
      type: 'highpass',
      frequency: 3000,
      decay: 0.008,
    });
    expect(MATERIALS.wood.click.partials.map((p) => p.frequency)).toEqual([420, 950]);
    expect(MATERIALS.wood.click.partials.map((p) => p.decay)).toEqual([0.025, 0.015]);
    expect(MATERIALS.wood.click.noise).toEqual({ type: 'lowpass', frequency: 1200, decay: 0.012 });
    expect(MATERIALS.metal.tone.harmonics).toEqual([1, 0.6, 0.45, 0.3, 0.2, 0.12]);
    expect(MATERIALS.wood.tone.harmonics).toEqual([1, 0.3, 0.1]);
    expect([MATERIALS.metal.tone.lowpass, MATERIALS.wood.tone.lowpass]).toEqual([4000, 900]);
    expect([MATERIALS.metal.tone.noise, MATERIALS.wood.tone.noise]).toEqual([0.05, 0.15]);
    expect([MATERIALS.metal.click.gain, MATERIALS.metal.tone.gain]).toEqual([0.5, 0.25]);
    expect([MATERIALS.wood.click.gain, MATERIALS.wood.tone.gain]).toEqual([0.6, 0.2]);
  });
});

describe('MATERIALS', () => {
  it.each(MATERIAL_IDS)('%s: 全周波数が 20〜20000 Hz、全減衰時間が正', (material) => {
    const m = MATERIALS[material];
    const frequencies = [
      ...m.click.partials.map((p) => p.frequency),
      m.click.noise.frequency,
      m.tone.lowpass,
    ];
    const decays = [...m.click.partials.map((p) => p.decay), m.click.noise.decay];
    for (const f of frequencies) {
      expect(f).toBeGreaterThanOrEqual(20);
      expect(f).toBeLessThanOrEqual(20000);
    }
    for (const d of decays) expect(d).toBeGreaterThan(0);
  });
});

describe('computeMeshVoices', () => {
  it('シーン A（12 枚 60 rpm → 36 枚 → 24 枚）で 2 組、f はともに 12 Hz', () => {
    const voices = voicesOf(sceneA());
    expect(voices.map((v) => v.key).sort()).toEqual(['gear_g1|gear_g2', 'gear_g2|gear_g3']);
    for (const v of voices) {
      expect(v.frequency).toBeCloseTo(12, 6);
      expect(v.click).toBeCloseTo(1, 9);
      expect(v.tone).toBeCloseTo(0, 9);
    }
  });

  it('モーター OFF で f はともに 0', () => {
    const voices = voicesOf(sceneA({ on: false }));
    expect(voices).toHaveLength(2);
    for (const v of voices) expect(v.frequency).toBe(0);
  });

  it('120 rpm では 24 Hz でクロスフェード（click ≈ 0.588、tone ≈ 0.809）', () => {
    const voice = voicesOf(sceneA({ rpm: 120 })).find((v) => v.key === 'gear_g1|gear_g2');
    expect(voice?.frequency).toBeCloseTo(24, 6);
    expect(voice?.click).toBeCloseTo(0.588, 3);
    expect(voice?.tone).toBeCloseTo(0.809, 3);
  });

  it('クリックの時刻に使う歯車は key の先頭の歯車で、その歯数とシャフトを持つ', () => {
    const voice = voicesOf(sceneA()).find((v) => v.key === 'gear_g2|gear_g3');
    expect(voice?.gearId).toBe('gear_g2');
    expect(voice?.shaftId).toBe('shaft_s2');
    expect(voice?.teeth).toBe(36);
  });
});

describe('activeVoices', () => {
  const voice = (key: string, frequency: number): MeshVoice => ({
    key,
    gearId: key,
    shaftId: key,
    teeth: 12,
    frequency,
    ...clickToneMix(frequency),
  });

  it('動いている組だけを、並びのまま最初の max 組まで残す', () => {
    const voices = [voice('a', 0), voice('b', 12), voice('c', 40), voice('d', 0), voice('e', 5)];
    expect(activeVoices(voices, 2).map((v) => v.key)).toEqual(['b', 'c']);
    expect(activeVoices(voices).map((v) => v.key)).toEqual(['b', 'c', 'e']);
  });

  it('既定の上限は MAX_AUDIO_VOICES（16）', () => {
    const voices = Array.from({ length: 21 }, (_, i) => voice(`k${i}`, 24));
    expect(MAX_AUDIO_VOICES).toBe(16);
    expect(activeVoices(voices)).toHaveLength(16);
  });
});

describe('shouldScheduleClicks', () => {
  it('跨いだ数 ÷ dt が 30 Hz 未満のときだけ予約する', () => {
    expect(shouldScheduleClicks(1, 0.1)).toBe(true); // 10 Hz 相当
    expect(shouldScheduleClicks(2, 0.1)).toBe(true); // 20 Hz 相当
    expect(shouldScheduleClicks(3, 0.1)).toBe(false); // 30 Hz 相当
    expect(shouldScheduleClicks(1, 1 / 60)).toBe(false); // 60 Hz 相当
    expect(shouldScheduleClicks(0, 0.1)).toBe(false);
    expect(shouldScheduleClicks(1, 0)).toBe(false);
  });
});
