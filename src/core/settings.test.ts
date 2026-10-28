import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  type Settings,
  serializeSettings,
} from './settings';

const d = defaultSettings('ja-JP');

describe('defaultSettings', () => {
  it('言語はブラウザの言語で決まる', () => {
    expect(defaultSettings('ja-JP').language).toBe('ja');
    expect(defaultSettings('en-US').language).toBe('en');
    expect(defaultSettings('fr').language).toBe('en');
  });

  it('theme brass・quality high・muted false・inputDevice auto・trackpadScroll pan', () => {
    expect(d).toEqual({
      theme: 'brass',
      quality: 'high',
      muted: false,
      inputDevice: 'auto',
      trackpadScroll: 'pan',
      language: 'ja',
    });
  });
});

describe('parseSettings', () => {
  it('キーと version', () => {
    expect(SETTINGS_STORAGE_KEY).toBe('gear-simulator:settings');
    expect(SETTINGS_VERSION).toBe(1);
  });

  it.each([undefined, null, 1, 'x', []])('%j は初期値', (raw) => {
    expect(parseSettings(raw, d)).toEqual(d);
  });

  it('正しい項目だけ生かし、欠けた項目は初期値', () => {
    expect(parseSettings({ version: 1, theme: 'wood' }, d)).toEqual({ ...d, theme: 'wood' });
  });

  it('不正な値はその項目だけ初期値', () => {
    const s = parseSettings({ version: 1, theme: 'gold', quality: 'low', muted: 'yes' }, d);
    expect(s.theme).toBe('brass');
    expect(s.quality).toBe('low');
    expect(s.muted).toBe(false);
    expect(s).toEqual({ ...d, quality: 'low' });
  });

  it('version が 1 でなければ全項目を初期値', () => {
    expect(parseSettings({ version: 2, theme: 'wood' }, d)).toEqual(d);
    expect(parseSettings({ theme: 'wood' }, d)).toEqual(d);
    expect(parseSettings({ version: '1', theme: 'wood' }, d)).toEqual(d);
  });

  it('知らない項目は捨てる', () => {
    const s = parseSettings({ version: 1, unknown: 1 }, d);
    expect(s).not.toHaveProperty('unknown');
    expect(s).not.toHaveProperty('version');
  });
});

describe('serializeSettings', () => {
  it('往復: すべての項目を初期値と違う値にしても元に戻る', () => {
    const changed: Settings = {
      quality: 'low',
      inputDevice: 'trackpad',
      trackpadScroll: 'orbit',
      language: 'en',
      theme: 'wood',
      muted: true,
    };
    for (const key of Object.keys(d) as Array<keyof Settings>) {
      expect(changed[key]).not.toBe(d[key]);
    }
    expect(parseSettings(JSON.parse(serializeSettings(changed)), d)).toEqual(changed);
  });

  it('version 1 と全項目を書く', () => {
    expect(JSON.parse(serializeSettings(d))).toEqual({ version: 1, ...d });
  });
});
