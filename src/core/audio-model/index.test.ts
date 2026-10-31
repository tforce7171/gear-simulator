import { describe, expect, it } from 'vitest';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import { resolveLayout } from '../layout/resolve';
import type { Scene } from '../scene/types';
import type { AudioMaterialId } from '../theme';
import {
  CLICK_JITTER,
  CLICK_PITCH_REF_HZ,
  CLICK_RATE_MAX,
  CLICK_TIME_JITTER_MAX_SEC,
  clickParams,
  clickPitch,
  clickRate,
  computeMeshVoices,
  grainTimes,
  IMPACT_CLICKS,
  impactClickParams,
  MATERIALS,
  type MeshVoice,
  meshGrainTimes,
  meshKey,
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
    anchors: {},
    carriers: {},
    racks: {},
  };
}

function voicesOf(scene: Scene): MeshVoice[] {
  const layout = resolveLayout(scene);
  const motion = solveMotion(scene, layout, initialMotionState());
  return computeMeshVoices(scene, layout, motion);
}

describe('定数', () => {
  it('粒を打つ回数の上限は毎秒 40 回（S4-06。連続音への切り替えは無い）', () => {
    expect(CLICK_RATE_MAX).toBe(40);
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

// S4-06: 粒の音（カタカタ）
describe('clickRate', () => {
  it('歯の通過頻度 5 Hz → 5（上限より遅ければ歯の通過ごとに 1 粒）', () => {
    expect(clickRate(5)).toBe(5);
  });

  it('歯の通過頻度 1000 Hz → 上限以下（間引く）', () => {
    expect(clickRate(1000)).toBeLessThanOrEqual(CLICK_RATE_MAX);
    expect(clickRate(1000)).toBeGreaterThan(0);
  });

  it('止まっている（0・負・NaN）→ 0', () => {
    expect(clickRate(0)).toBe(0);
    expect(clickRate(-3)).toBe(0);
    expect(clickRate(Number.NaN)).toBe(0);
  });

  it('上限までは歯の通過頻度に従って増え、上限を超えたら一定', () => {
    expect(clickRate(24)).toBe(24);
    expect(clickRate(CLICK_RATE_MAX)).toBe(CLICK_RATE_MAX);
    expect(clickRate(80)).toBe(CLICK_RATE_MAX);
  });
});

describe('clickPitch', () => {
  const FREQUENCIES = [0, 0.5, 1, 5, 10, 15, 24, 30, 40, 60, 100, 200, 500, 1000, 2000, 5000];

  it.each(MATERIAL_IDS)('%s: 歯の通過頻度について単調に増える', (material) => {
    for (let i = 1; i < FREQUENCIES.length; i += 1) {
      const lo = FREQUENCIES[i - 1] ?? 0;
      const hi = FREQUENCIES[i] ?? 0;
      expect(clickPitch(hi, material)).toBeGreaterThan(clickPitch(lo, material));
    }
  });

  it.each([0, 5, 24, 100, 1000])(
    '歯の通過頻度 %f Hz で metal と wood の値が違い、metal が高い',
    (f) => {
      expect(clickPitch(f, 'metal')).not.toBe(clickPitch(f, 'wood'));
      expect(clickPitch(f, 'metal')).toBeGreaterThan(clickPitch(f, 'wood'));
    },
  );

  it.each(MATERIAL_IDS)('%s: 止まりかけは材質の基準の高さ、基準の頻度で 1.2 倍', (material) => {
    const base = MATERIALS[material].click.pitch;
    expect(clickPitch(0, material)).toBeCloseTo(base, 9);
    expect(clickPitch(CLICK_PITCH_REF_HZ, material)).toBeCloseTo(base * 1.2, 9);
  });

  it.each(MATERIAL_IDS)('%s: どの速さでも可聴域（20〜20000 Hz）', (material) => {
    for (const f of FREQUENCIES) {
      expect(clickPitch(f, material)).toBeGreaterThanOrEqual(20);
      expect(clickPitch(f, material)).toBeLessThanOrEqual(20000);
    }
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

describe('clickParams（S4-06: 粒 1 つ）', () => {
  it.each(MATERIAL_IDS)(
    '%s: random = 0.5 なら揺らぎ 0。共鳴フィルタの中心は clickPitch',
    (material) => {
      const m = MATERIALS[material].click;
      const pitch = clickPitch(24, material);
      const p = clickParams(material, () => 0.5, 24);
      expect(p.noise.type).toBe('bandpass');
      expect(p.noise.frequency).toBeCloseTo(pitch, 9);
      expect(p.noise.q).toBe(m.q);
      expect(p.noise.decay).toBe(m.noiseDecay);
      m.partials.forEach((partial, i) => {
        expect(p.partials[i]?.frequency).toBeCloseTo(pitch * partial.ratio, 9);
        expect(p.partials[i]?.decay).toBe(partial.decay);
      });
      expect(p.gain).toBe(m.gain);
    },
  );

  it.each(MATERIAL_IDS)('%s: random = 0 / 1 で高さが −3% / +3%', (material) => {
    const pitch = clickPitch(100, material);
    expect(CLICK_JITTER).toBe(0.03);
    expect(clickParams(material, () => 0, 100).noise.frequency).toBeCloseTo(pitch * 0.97, 9);
    expect(clickParams(material, () => 1, 100).noise.frequency).toBeCloseTo(pitch * 1.03, 9);
  });

  it('速いほど粒が高い。pitchScale を掛ける（内歯車の組のこもり）', () => {
    const slow = clickParams('metal', () => 0.5, 5).noise.frequency;
    const fast = clickParams('metal', () => 0.5, 500).noise.frequency;
    expect(fast).toBeGreaterThan(slow);
    expect(clickParams('metal', () => 0.5, 5, 0.5).noise.frequency).toBeCloseTo(slow * 0.5, 9);
  });
});

describe('MATERIALS（S4-06: 粒の音色）', () => {
  it('真鍮は硬く高め（基準 2400 Hz、共鳴が鋭い）、木は柔らかく低め（基準 520 Hz、共鳴がゆるい）', () => {
    expect(MATERIALS.metal.click.pitch).toBe(2400);
    expect(MATERIALS.wood.click.pitch).toBe(520);
    expect(MATERIALS.metal.click.q).toBeGreaterThan(MATERIALS.wood.click.q);
    expect(MATERIALS.metal.click.partials.map((p) => p.ratio)).toEqual([1, 1.63, 2.54]);
    expect(MATERIALS.wood.click.partials.map((p) => p.ratio)).toEqual([1, 2.26]);
  });

  it.each(MATERIAL_IDS)(
    '%s: 連続音の欄は無い。減衰は正で短い（50 ms 未満。粒が重ならない）',
    (material) => {
      const m = MATERIALS[material];
      expect(Object.keys(m).sort()).toEqual(['click', 'slide']);
      const decays = [...m.click.partials.map((p) => p.decay), m.click.noiseDecay];
      for (const d of decays) {
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(0.05);
      }
    },
  );
});

describe('impactClickParams（ロック・ラック端の音のクリック。S4-06 の前と同じ）', () => {
  it('表の値: 真鍮は 2400 / 3900 / 6100 Hz とハイパス、木は 420 / 950 Hz とローパス', () => {
    expect(IMPACT_CLICKS.metal.partials.map((p) => p.frequency)).toEqual([2400, 3900, 6100]);
    expect(IMPACT_CLICKS.metal.partials.map((p) => p.decay)).toEqual([0.08, 0.06, 0.04]);
    expect(IMPACT_CLICKS.metal.noise).toEqual({ type: 'highpass', frequency: 3000, decay: 0.008 });
    expect(IMPACT_CLICKS.wood.partials.map((p) => p.frequency)).toEqual([420, 950]);
    expect(IMPACT_CLICKS.wood.partials.map((p) => p.decay)).toEqual([0.025, 0.015]);
    expect(IMPACT_CLICKS.wood.noise).toEqual({ type: 'lowpass', frequency: 1200, decay: 0.012 });
    expect([IMPACT_CLICKS.metal.gain, IMPACT_CLICKS.wood.gain]).toEqual([0.5, 0.6]);
  });

  it.each(MATERIAL_IDS)('%s: random = 0.5 で表の値ちょうど、0 / 1 で −3% / +3%', (material) => {
    const base = IMPACT_CLICKS[material];
    expect(impactClickParams(material, () => 0.5)).toEqual(base);
    base.partials.forEach((partial, i) => {
      expect(impactClickParams(material, () => 0).partials[i]?.frequency).toBeCloseTo(
        partial.frequency * 0.97,
        9,
      );
      expect(impactClickParams(material, () => 1).partials[i]?.frequency).toBeCloseTo(
        partial.frequency * 1.03,
        9,
      );
    });
  });
});

describe('computeMeshVoices', () => {
  it('シーン A（12 枚 60 rpm → 36 枚 → 24 枚）で 2 組、f はともに 12 Hz', () => {
    const voices = voicesOf(sceneA());
    expect(voices.map((v) => v.key).sort()).toEqual(['gear_g1|gear_g2', 'gear_g2|gear_g3']);
    for (const v of voices) expect(v.frequency).toBeCloseTo(12, 6);
  });

  it('モーター OFF で f はともに 0', () => {
    const voices = voicesOf(sceneA({ on: false }));
    expect(voices).toHaveLength(2);
    for (const v of voices) expect(v.frequency).toBe(0);
  });

  it('120 rpm では 24 Hz。連続音の重み（click・tone）は持たない（S4-06）', () => {
    const voice = voicesOf(sceneA({ rpm: 120 })).find((v) => v.key === 'gear_g1|gear_g2');
    expect(voice?.frequency).toBeCloseTo(24, 6);
    expect(voice).not.toHaveProperty('tone');
    expect(voice).not.toHaveProperty('click');
  });

  it('位置はかみ合いの接点（g1 の中心から g2 へ、g1 のピッチ円半径 6 mm の点）', () => {
    const scene = sceneA();
    const layout = resolveLayout(scene);
    const voice = voicesOf(scene).find((v) => v.key === 'gear_g1|gear_g2');
    const g1 = layout.gears.gear_g1;
    const g2 = layout.gears.gear_g2;
    if (voice === undefined || g1 === undefined || g2 === undefined) throw new Error('無い');
    const d = Math.hypot(...g2.center.map((x, i) => x - (g1.center[i] ?? 0)));
    for (let i = 0; i < 3; i += 1) {
      const expected = (g1.center[i] ?? 0) + (((g2.center[i] ?? 0) - (g1.center[i] ?? 0)) * 6) / d;
      expect(voice.position[i]).toBeCloseTo(expected, 9);
    }
  });

  it('クリックの時刻に使う歯車は key の先頭の歯車で、その歯数とシャフトを持つ', () => {
    const voice = voicesOf(sceneA()).find((v) => v.key === 'gear_g2|gear_g3');
    expect(voice?.gearId).toBe('gear_g2');
    expect(voice?.shaftId).toBe('shaft_s2');
    expect(voice?.teeth).toBe(36);
  });
});

describe('grainTimes', () => {
  it('毎秒 40 回を 0.1 秒 → 4 粒、間隔 1/40 秒。端数は次のフレームへ持ち越す', () => {
    const a = grainTimes(40, 0.1, 0);
    expect(a.times).toHaveLength(4);
    a.times.forEach((t, i) => {
      expect(t).toBeCloseTo((i + 1) / 40, 9);
    });
    expect(a.carry).toBeCloseTo(0, 9);
    const b = grainTimes(40, 1 / 60, 0);
    expect(b.times).toHaveLength(0);
    expect(b.carry).toBeCloseTo(40 / 60, 9);
    const c = grainTimes(40, 1 / 60, b.carry);
    expect(c.times).toHaveLength(1);
    expect(c.times[0]).toBeCloseTo((1 - 40 / 60) / 40, 9);
  });

  it('60 フレーム（1 秒）続けると 40 粒', () => {
    let carry = 0;
    let count = 0;
    for (let i = 0; i < 60; i += 1) {
      const r = grainTimes(40, 1 / 60, carry);
      count += r.times.length;
      carry = r.carry;
    }
    expect(count).toBe(40);
  });

  it('rate か dt が 0 以下なら粒は無い', () => {
    expect(grainTimes(0, 0.1, 0.5).times).toEqual([]);
    expect(grainTimes(40, 0, 0.5).times).toEqual([]);
  });
});

describe('meshGrainTimes（S4-06）', () => {
  const teeth = 12;
  const toothAngle = (2 * Math.PI) / teeth;

  it('上限より遅ければ歯の通過ごとに 1 粒（random = 0.5 なら揺らぎなし、toothPassTimes と同じ）', () => {
    const next = toothAngle * 3.5;
    const r = meshGrainTimes(0, next, teeth, 0.1, 35, 0, () => 0.5);
    expect(r.times).toEqual(toothPassTimes(0, next, teeth, 0.1));
  });

  it('上限を超えたら間引く: 1000 Hz で 1 秒回しても粒は毎秒 40 回', () => {
    const dt = 1 / 60;
    const omega = (1000 * 2 * Math.PI) / teeth;
    let angle = 0;
    let carry = 0;
    let count = 0;
    for (let i = 0; i < 60; i += 1) {
      const next = angle + omega * dt;
      const r = meshGrainTimes(angle, next, teeth, dt, 1000, carry, () => 0.5);
      count += r.times.length;
      carry = r.carry;
      angle = next;
    }
    expect(count).toBe(40);
  });

  it('間隔に揺らぎを入れる（random 0 / 1 で前後にずれ、ずれは間隔の 1/4 か上限まで）', () => {
    const dt = 0.1;
    const base = meshGrainTimes(0, 1, teeth, dt, 1000, 0, () => 0.5).times;
    const early = meshGrainTimes(0, 1, teeth, dt, 1000, 0, () => 0).times;
    const late = meshGrainTimes(0, 1, teeth, dt, 1000, 0, () => 1).times;
    const shift = Math.min(0.25 / CLICK_RATE_MAX, CLICK_TIME_JITTER_MAX_SEC);
    base.forEach((t, i) => {
      expect(early[i]).toBeCloseTo(Math.max(0, t - shift), 9);
      expect(late[i]).toBeCloseTo(t + shift, 9);
    });
    expect(shift).toBeGreaterThan(0);
  });

  it('時刻は 0 以上で昇順', () => {
    let seed = 0.123;
    const random = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const r = meshGrainTimes(0, 10, teeth, 0.2, 2000, 0.3, random);
    expect(r.times.length).toBeGreaterThan(0);
    for (const t of r.times) expect(t).toBeGreaterThanOrEqual(0);
    expect([...r.times].sort((a, b) => a - b)).toEqual(r.times);
  });

  it('止まっている・dt が 0 → 粒は無い', () => {
    expect(meshGrainTimes(1, 1, teeth, 0.1, 0, 0, () => 0.5).times).toEqual([]);
    expect(meshGrainTimes(0, 1, teeth, 0, 50, 0, () => 0.5).times).toEqual([]);
  });
});
