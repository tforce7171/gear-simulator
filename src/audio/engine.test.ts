import { describe, expect, it } from 'vitest';
import { clickToneMix, type MeshKind, type MeshVoice, type MotorHum } from '../core/audio-model';
import type { LockInfo } from '../core/kinematics/types';
import type { Vec3 } from '../core/math/vec3';
import { type AudioFrame, createAudioEngine } from './engine';

// S1-25・S1-26: AudioContext を作る前の振る舞い（node には Web Audio が無いので、作った後は Playwright で確かめる）

function voice(
  key: string,
  frequency: number,
  position: Vec3 = [0, 0, 0],
  kind: MeshKind = 'spur',
  slide = 0,
): MeshVoice {
  return {
    key,
    gearId: key,
    shaftId: key,
    teeth: 12,
    frequency,
    ...clickToneMix(frequency),
    position,
    kind,
    slide,
  };
}

function frame(
  voices: MeshVoice[],
  extra: Partial<Pick<AudioFrame, 'motors' | 'locks' | 'dt'>> & { at?: Vec3 } = {},
): AudioFrame {
  return {
    voices,
    angles: {},
    dt: extra.dt ?? 1 / 60,
    listener: { position: extra.at ?? [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] },
    motors: extra.motors ?? [],
    locks: extra.locks ?? [],
  };
}

function hum(motorId: string, x: number): MotorHum {
  return {
    motorId,
    size: 'S',
    position: [x, 0, 0],
    frequency: 220,
    level: 0.08,
    strain: 0,
    grind: 0,
  };
}

const LOCK: LockInfo = { reason: 'stalemate', shaftIds: ['s1', 's2'], gearIds: ['g1', 'g2'] };

describe('createAudioEngine（開始前）', () => {
  it('start するまで AudioContext を作らず、contextState は none', () => {
    let created = 0;
    const engine = createAudioEngine({
      createContext: () => {
        created += 1;
        throw new Error('作らないはず');
      },
    });
    engine.update(frame([voice('a', 12)]));
    engine.setMuted(true);
    engine.setMaterial('wood');
    expect(created).toBe(0);
    expect(engine.state()).toEqual({
      contextState: 'none',
      muted: true,
      material: 'wood',
      voices: [
        {
          key: 'a',
          frequency: 12,
          click: 1,
          tone: 0,
          position: [0, 0, 0],
          kind: 'spur',
          slide: 0,
        },
      ],
      background: null,
      motors: [],
      lockSounds: { impacts: 0, rattling: [] },
    });
  });

  it('初期値は metal・ミュートなし。鳴らす組はリスナーに近い動いている 16 組で、残りは背景のうなり', () => {
    const engine = createAudioEngine();
    expect(engine.state()).toMatchObject({ muted: false, material: 'metal', voices: [] });
    const voices = [
      voice('stop', 0),
      ...Array.from({ length: 20 }, (_, i) =>
        voice(`k${String(i).padStart(2, '0')}`, 24, [i * 10, 0, 0]),
      ),
    ];
    engine.update(frame(voices, { at: [200, 0, 0] }));
    const { voices: active, background } = engine.state();
    expect(active).toHaveLength(16);
    expect(active[0]?.key).toBe('k19');
    expect(active.map((v) => v.key)).not.toContain('stop');
    expect(active.map((v) => v.key)).not.toContain('k00');
    expect(background).not.toBeNull();
  });

  it('モーターのうなりはリスナーに近い 4 個まで（motorId の昇順で返す）', () => {
    const engine = createAudioEngine();
    const motors = Array.from({ length: 6 }, (_, i) => hum(`m${i}`, i * 100));
    engine.update(frame([], { motors, at: [500, 0, 0] }));
    expect(engine.state().motors.map((m) => m.motorId)).toEqual(['m2', 'm3', 'm4', 'm5']);
  });

  it('ロックした瞬間に衝撃音を 1 回数え、続く間はガタガタ。解けたら止まる', () => {
    const engine = createAudioEngine();
    const locks = [{ info: LOCK, position: [0, 0, 0] as Vec3 }];
    engine.update(frame([], { locks }));
    engine.update(frame([], { locks: [{ info: { ...LOCK }, position: [0, 0, 0] }] }));
    expect(engine.state().lockSounds).toEqual({
      impacts: 1,
      rattling: ['stalemate:s1,s2'],
    });
    engine.update(frame([]));
    expect(engine.state().lockSounds).toEqual({ impacts: 1, rattling: [] });
  });

  it('衝撃音は 1 秒に 4 回まで', () => {
    const engine = createAudioEngine();
    const locks = [{ info: LOCK, position: [0, 0, 0] as Vec3 }];
    for (let i = 0; i < 10; i += 1) {
      engine.update(frame([], { locks, dt: 0.05 }));
      engine.update(frame([], { dt: 0.05 }));
    }
    // 1 秒の間に 10 回ロックしても 4 回
    expect(engine.state().lockSounds.impacts).toBe(4);
    for (let i = 0; i < 20; i += 1) engine.update(frame([], { dt: 0.05 }));
    engine.update(frame([], { locks, dt: 0.05 }));
    expect(engine.state().lockSounds.impacts).toBe(5);
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

describe('state の voices の種類（S2-05）', () => {
  it('kind と slide をそのまま返す', () => {
    const engine = createAudioEngine();
    engine.update(
      frame([voice('w', 1, [0, 0, 0], 'worm', 0.3), voice('h', 20, [1, 0, 0], 'helical')]),
    );
    const voices = engine.state().voices;
    expect(voices.map((v) => [v.key, v.kind, v.slide])).toEqual([
      ['w', 'worm', 0.3],
      ['h', 'helical', 0],
    ]);
  });
});
