import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scene } from '../scene/types';
import { allowedPlanetCounts, planetaryTeethChoices } from './commands';

// S3-05: プロパティパネルの選択肢（遊星の数、遊星歯車機構の中の歯数）

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

describe('allowedPlanetCounts', () => {
  it('planetary-ring-fixed（z_s 24・z_p 12・z_r 48）→ 1・2・3・4・6（5 は (24 + 48)/5 が整数でない）', () => {
    expect(allowedPlanetCounts(fixture('planetary-ring-fixed'), 'carrier_k')).toEqual([
      1, 2, 3, 4, 6,
    ]);
  });

  it('無いキャリアは空', () => {
    expect(allowedPlanetCounts(fixture('planetary-ring-fixed'), 'carrier_x')).toEqual([]);
  });
});

describe('planetaryTeethChoices', () => {
  const scene = fixture('planetary-ring-fixed');

  it('リングは役割 ring で、直接は選べない（空）', () => {
    expect(planetaryTeethChoices(scene, 'gear_r')).toEqual({ role: 'ring', teeth: [] });
  });

  it('太陽は今の歯数を含み、条件を満たす歯数だけ（25 は (25 + 49)/3 が整数でないので入らない）', () => {
    const choices = planetaryTeethChoices(scene, 'gear_s');
    expect(choices?.role).toBe('sun');
    expect(choices?.teeth).toContain(24);
    expect(choices?.teeth).not.toContain(25);
    expect(choices?.teeth).toContain(27); // (27 + 51)/3 = 26
    // リング（中の内歯車は 60 歯まで）に収まらない歯数は入らない: z_s + 24 ≤ 60
    expect(Math.max(...(choices?.teeth ?? []))).toBeLessThanOrEqual(36);
  });

  it('遊星は役割 planet', () => {
    const choices = planetaryTeethChoices(scene, 'gear_p1');
    expect(choices?.role).toBe('planet');
    expect(choices?.teeth).toContain(12);
  });

  it('機構の外の歯車は null', () => {
    expect(planetaryTeethChoices(fixture('two-spur'), 'gear_1')).toBeNull();
  });
});
