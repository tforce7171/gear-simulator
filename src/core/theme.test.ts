import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY,
  DEFAULT_THEME,
  nextTheme,
  QUALITY_PROFILES,
  THEME_AUDIO_MATERIAL,
  THEME_IDS,
} from './theme';

describe('テーマと品質（S1-24）', () => {
  it('標準は真鍮・高品質', () => {
    expect(DEFAULT_THEME).toBe('brass');
    expect(DEFAULT_QUALITY).toBe('high');
  });

  it('テーマの音の材質: brass → metal、wood → wood。全テーマにキーがある', () => {
    expect(THEME_AUDIO_MATERIAL.brass).toBe('metal');
    expect(THEME_AUDIO_MATERIAL.wood).toBe('wood');
    expect(Object.keys(THEME_AUDIO_MATERIAL).sort()).toEqual([...THEME_IDS].sort());
    expect(THEME_IDS).toEqual(['brass', 'wood']);
  });

  it('品質ごとの設定: 高品質は影あり、軽量は影なし・解像度 1・環境マップと木目が小さい', () => {
    const { high, low } = QUALITY_PROFILES;
    expect(high.shadows).toBe(true);
    expect(low.shadows).toBe(false);
    expect(low.pixelRatioCap).toBe(1);
    expect(low.envMapSize).toBeLessThan(high.envMapSize);
    expect(low.woodTextureSize).toBeLessThan(high.woodTextureSize);
  });

  it('nextTheme は真鍮と木製を行き来する', () => {
    expect(nextTheme('brass')).toBe('wood');
    expect(nextTheme('wood')).toBe('brass');
  });
});
