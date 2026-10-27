import { describe, expect, it } from 'vitest';
import { clickToneMix, type MeshVoice } from '../core/audio-model';
import { createAudioEngine } from './engine';

// S1-25: AudioContext を作る前の振る舞い（node には Web Audio が無いので、作った後は Playwright で確かめる）

function voice(key: string, frequency: number): MeshVoice {
  return { key, gearId: key, shaftId: key, teeth: 12, frequency, ...clickToneMix(frequency) };
}

describe('createAudioEngine（開始前）', () => {
  it('start するまで AudioContext を作らず、contextState は none', () => {
    let created = 0;
    const engine = createAudioEngine({
      createContext: () => {
        created += 1;
        throw new Error('作らないはず');
      },
    });
    engine.update([voice('a', 12)], { a: 0 }, 1 / 60);
    engine.setMuted(true);
    engine.setMaterial('wood');
    expect(created).toBe(0);
    expect(engine.state()).toEqual({
      contextState: 'none',
      muted: true,
      material: 'wood',
      voices: [{ key: 'a', frequency: 12, click: 1, tone: 0 }],
    });
  });

  it('初期値は metal・ミュートなし。鳴らす組は動いている組の先頭 16 組', () => {
    const engine = createAudioEngine();
    expect(engine.state()).toMatchObject({ muted: false, material: 'metal', voices: [] });
    const voices = [voice('stop', 0), ...Array.from({ length: 20 }, (_, i) => voice(`k${i}`, 24))];
    engine.update(voices, {}, 1 / 60);
    const keys = engine.state().voices.map((v) => v.key);
    expect(keys).toHaveLength(16);
    expect(keys[0]).toBe('k0');
    expect(keys).not.toContain('stop');
  });

  it('作るのに失敗しても例外を投げず、none のまま', () => {
    const engine = createAudioEngine({
      createContext: () => {
        throw new Error('no audio');
      },
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(() => engine.start()).not.toThrow();
    } finally {
      console.warn = warn;
    }
    expect(engine.state().contextState).toBe('none');
  });
});
