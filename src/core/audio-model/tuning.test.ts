import { describe, expect, it } from 'vitest';
import type { AudioMaterialId } from '../theme';
import {
  buzzLevel,
  CLICK_RATE_MAX,
  clickParams,
  type GrainMaterial,
  MATERIALS,
  MESH_TIMBRES,
  type VoiceKind,
} from './index';

const AUDIO_MATERIAL_IDS: readonly AudioMaterialId[] = ['metal', 'wood'];

// S5-03: 金属の音を歯車らしく（短く乾いたクリック）、木の音を重く（低い成分を足し、高い成分を削る）

// S4-06 の時点の値（調整の前）
const BEFORE = {
  metal: { maxDecay: 0.025, q: 10, noiseToPartial: 0.8 / 0.6 },
  wood: { pitch: 520, maxDecay: 0.018, highLevel: 0.3, noiseLevel: 0.8 },
} as const;

function maxDecay(m: GrainMaterial): number {
  return Math.max(m.noiseDecay, ...m.partials.map((p) => p.decay));
}

// 粒の音の重みで平均した周波数（中心 = 1 とした比）。ノイズは中心の周波数にあるとみなす
function weightedRatio(m: GrainMaterial): number {
  const parts = [...m.partials.map((p) => [p.ratio, p.level]), [1, m.noiseLevel]] as const;
  const total = parts.reduce((s, [, w]) => s + w, 0);
  return parts.reduce((s, [r, w]) => s + r * w, 0) / total;
}

describe('金属の粒（S5-03）', () => {
  const metal = MATERIALS.metal.click;

  it('粒の長さ（最も長い減衰の時定数）が今（25 ms）より短い', () => {
    expect(maxDecay(metal)).toBeLessThan(BEFORE.metal.maxDecay);
  });

  it('帯域通過の Q が今（10）より低い', () => {
    expect(metal.q).toBeLessThan(BEFORE.metal.q);
  });

  it('音程感を弱める: 部分音は 3 つより少なく、基音以外は整数比から外れ、ノイズの割合が今より高い', () => {
    expect(metal.partials.length).toBeLessThan(3);
    for (const p of metal.partials.slice(1)) {
      expect(Math.abs(p.ratio - Math.round(p.ratio))).toBeGreaterThan(0.1);
    }
    const loudest = Math.max(...metal.partials.map((p) => p.level));
    expect(metal.noiseLevel / loudest).toBeGreaterThan(BEFORE.metal.noiseToPartial);
  });

  it('clickParams は部分音ごとの音量とノイズの音量を材質の値のまま渡す', () => {
    const p = clickParams('metal', () => 0.5, 24);
    expect(p.partials.map((x) => x.level)).toEqual(metal.partials.map((x) => x.level));
    expect(p.noise.level).toBe(metal.noiseLevel);
  });
});

describe('木の粒（S5-03）', () => {
  const wood = MATERIALS.wood.click;

  it('主な周波数が今（520 Hz）より低く、重みで平均した周波数も今より低い', () => {
    expect(wood.pitch).toBeLessThan(BEFORE.wood.pitch);
    // 前は部分音 ×1（0.6）・×2.26（0.3）とノイズ ×1（0.8）
    const before = (1 * 0.6 + 2.26 * 0.3 + 1 * 0.8) / (0.6 + 0.3 + 0.8);
    expect(wood.pitch * weightedRatio(wood)).toBeLessThan(BEFORE.wood.pitch * before);
  });

  it('中心より低い成分（ratio < 1）がある', () => {
    expect(wood.partials.some((p) => p.ratio < 1 && p.level > 0)).toBe(true);
  });

  it('高い成分（ratio > 2）とノイズの重みが今より小さい', () => {
    for (const p of wood.partials.filter((x) => x.ratio > 2)) {
      expect(p.level).toBeLessThan(BEFORE.wood.highLevel);
    }
    expect(wood.noiseLevel).toBeLessThan(BEFORE.wood.noiseLevel);
  });

  it('余韻の時定数は今（18 ms）以下', () => {
    expect(maxDecay(wood)).toBeLessThanOrEqual(BEFORE.wood.maxDecay);
  });
});

describe('種類ごとの音色の倍率をかけた大小関係（S5-03 で変わらない）', () => {
  // 粒の音量の順（小さい順）。S4-06 の時点: ウォーム < はすば = ねじ歯車 < 平歯車 = かさ = 内歯車 = ラック
  const ORDER: readonly (readonly VoiceKind[])[] = [
    ['worm'],
    ['helical', 'crossedHelical'],
    ['spur', 'bevel', 'internal', 'rack'],
  ];

  it.each(AUDIO_MATERIAL_IDS)('%s: 粒の音量（材質 × 種類の click）の大小が今と同じ', (material) => {
    const gain = (k: VoiceKind) => MATERIALS[material].click.gain * MESH_TIMBRES[k].click;
    for (let i = 0; i < ORDER.length; i += 1) {
      const group = ORDER[i] ?? [];
      for (const k of group) expect(gain(k)).toBeCloseTo(gain(group[0] ?? 'spur'), 12);
      const next = ORDER[i + 1]?.[0];
      if (next !== undefined) expect(gain(group[0] ?? 'spur')).toBeLessThan(gain(next));
    }
  });

  it.each(AUDIO_MATERIAL_IDS)('%s: 内歯車の組は平歯車より低い（こもる）', (material) => {
    const pitch = (k: VoiceKind) => clickParams(material, () => 0.5, 24, MESH_TIMBRES[k].pitch);
    expect(pitch('internal').noise.frequency).toBeLessThan(pitch('spur').noise.frequency);
  });

  it('速いときの金属の「ジー」も、はすば < 平歯車、ウォームのすべりの雑音（1）を超えない', () => {
    const f = CLICK_RATE_MAX * 20;
    expect(buzzLevel(f, 'metal', 'helical')).toBeLessThan(buzzLevel(f, 'metal', 'spur'));
    expect(buzzLevel(f, 'metal', 'worm')).toBeLessThan(buzzLevel(f, 'metal', 'helical'));
    expect(buzzLevel(f, 'metal', 'spur')).toBeLessThan(MESH_TIMBRES.worm.slideNoise);
  });
});

describe('buzzLevel（S5-03: 速く回した金属の「ジー」）', () => {
  it('粒を間引かない速さ（CLICK_RATE_MAX 以下）では 0', () => {
    for (const f of [0, 5, CLICK_RATE_MAX]) expect(buzzLevel(f, 'metal', 'spur')).toBe(0);
  });

  it('CLICK_RATE_MAX を超えると速いほど強く、頭打ちになる', () => {
    const levels = [60, 120, 240, 2000, 20000].map((f) => buzzLevel(f, 'metal', 'spur'));
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] ?? 0).toBeGreaterThanOrEqual(levels[i - 1] ?? 0);
    }
    expect(levels[0] ?? 0).toBeGreaterThan(0);
    expect(levels[4]).toBeCloseTo(levels[3] ?? 0, 12);
    expect(levels[4] ?? 0).toBeLessThanOrEqual(1);
  });

  it('木は速くても鳴らさない（コトコトのまま）', () => {
    expect(buzzLevel(2000, 'wood', 'spur')).toBe(0);
  });

  it('NaN・負は 0', () => {
    expect(buzzLevel(Number.NaN, 'metal', 'spur')).toBe(0);
    expect(buzzLevel(-500, 'metal', 'spur')).toBe(0);
  });
});
