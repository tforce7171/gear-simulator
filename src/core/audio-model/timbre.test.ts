import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MeshKind } from '../geometry/can-mesh';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import { resolveLayout } from '../layout/resolve';
import type { Scene } from '../scene/types';
import {
  computeMeshVoices,
  MESH_KINDS,
  meshTimbre,
  SLIDE_NOISE_FULL_SPEED,
  slideNoiseLevel,
} from './index';

// S2-05: かみ合いの種類ごとの音色

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

function voicesOf(scene: Scene) {
  const layout = resolveLayout(scene);
  const motion = solveMotion(scene, layout, initialMotionState());
  return computeMeshVoices(scene, layout, motion);
}

describe('meshTimbre', () => {
  it("'helical' の click は 'spur' より小さい", () => {
    expect(meshTimbre('helical').click).toBeLessThan(meshTimbre('spur').click);
  });

  it("'spur'・'bevel' は段階 1 と同じ（1, 1, 0）", () => {
    expect(meshTimbre('spur')).toEqual({ click: 1, hum: 1, slideNoise: 0 });
    expect(meshTimbre('bevel')).toEqual({ click: 1, hum: 1, slideNoise: 0 });
  });

  it("'worm' の slideNoise > 0、'spur'・'bevel'・'helical' の slideNoise = 0", () => {
    expect(meshTimbre('worm').slideNoise).toBeGreaterThan(0);
    for (const kind of ['spur', 'bevel', 'helical'] as const) {
      expect(meshTimbre(kind).slideNoise).toBe(0);
    }
  });

  it("'crossedHelical' の slideNoise は 'worm' より小さく 0 より大きい", () => {
    const crossed = meshTimbre('crossedHelical').slideNoise;
    expect(crossed).toBeGreaterThan(0);
    expect(crossed).toBeLessThan(meshTimbre('worm').slideNoise);
  });

  it('資料の倍率: ハスバのクリック 0.4、ウォームのクリック 0.2、ねじ歯車のすべり = ウォームの 0.3 倍', () => {
    expect(meshTimbre('helical').click).toBeCloseTo(0.4, 12);
    expect(meshTimbre('worm').click).toBeCloseTo(0.2, 12);
    expect(meshTimbre('crossedHelical').click).toBe(meshTimbre('helical').click);
    expect(meshTimbre('crossedHelical').hum).toBe(meshTimbre('helical').hum);
    expect(meshTimbre('crossedHelical').slideNoise).toBeCloseTo(
      0.3 * meshTimbre('worm').slideNoise,
      12,
    );
    expect(meshTimbre('helical').hum).toBeGreaterThan(meshTimbre('spur').hum);
  });

  it('すべての MeshKind に係数がある', () => {
    const kinds: readonly MeshKind[] = MESH_KINDS;
    expect([...kinds].sort()).toEqual([
      'bevel',
      'crossedHelical',
      'helical',
      'internal',
      'spur',
      'worm',
    ]);
    for (const kind of kinds) {
      const t = meshTimbre(kind);
      expect(t.click).toBeGreaterThan(0);
      expect(t.hum).toBeGreaterThan(0);
      expect(t.slideNoise).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('slideNoiseLevel', () => {
  it("slideNoiseLevel('worm', 0) = 0", () => {
    expect(slideNoiseLevel('worm', 0)).toBe(0);
  });

  it('周速が上がると単調に増え、1 を超えない', () => {
    const speeds = [0, 5, 10, 20, 40, 80, SLIDE_NOISE_FULL_SPEED * 0.99];
    const levels = speeds.map((v) => slideNoiseLevel('worm', v));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1] as number);
    }
    for (const v of [SLIDE_NOISE_FULL_SPEED, SLIDE_NOISE_FULL_SPEED * 2, 1e6]) {
      expect(slideNoiseLevel('worm', v)).toBeLessThanOrEqual(1);
      expect(slideNoiseLevel('worm', v)).toBeCloseTo(1, 12);
    }
  });

  it('向き（負の周速）は問わない。NaN は 0', () => {
    expect(slideNoiseLevel('worm', -40)).toBe(slideNoiseLevel('worm', 40));
    expect(slideNoiseLevel('worm', Number.NaN)).toBe(0);
  });

  it('すべりの無い種類は 0、ねじ歯車はウォームの 0.3 倍', () => {
    for (const kind of ['spur', 'bevel', 'helical'] as const) {
      expect(slideNoiseLevel(kind, 100)).toBe(0);
    }
    expect(slideNoiseLevel('crossedHelical', 40)).toBeCloseTo(
      0.3 * slideNoiseLevel('worm', 40),
      12,
    );
  });
});

describe('computeMeshVoices の種類（S2-05）', () => {
  it('worm-basic（ウォーム 60 rpm、ホイール 30 歯）→ f = 1 Hz、kind: worm', () => {
    const voices = voicesOf(fixture('worm-basic'));
    expect(voices).toHaveLength(1);
    const [v] = voices;
    expect(v?.frequency).toBeCloseTo(1, 9);
    expect(v?.kind).toBe('worm');
    expect(v?.slide).toBeGreaterThan(0);
  });

  it('helical-pair（A 20 歯 60 rpm）→ f = 20 Hz、kind: helical', () => {
    const voices = voicesOf(fixture('helical-pair'));
    expect(voices).toHaveLength(1);
    const [v] = voices;
    expect(v?.frequency).toBeCloseTo(20, 9);
    expect(v?.kind).toBe('helical');
    expect(v?.slide).toBe(0);
  });

  it('worm-basic の周速はウォームのピッチ円（5m = 10 mm）× ω で、slide はその値の slideNoiseLevel', () => {
    const [v] = voicesOf(fixture('worm-basic'));
    expect(v?.slide).toBeCloseTo(slideNoiseLevel('worm', 10 * 2 * Math.PI), 9);
  });
});
