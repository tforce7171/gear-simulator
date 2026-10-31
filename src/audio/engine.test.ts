import { describe, expect, it } from 'vitest';
import {
  CLICK_RATE_MAX,
  clickPitch,
  type MeshKind,
  type MeshVoice,
  type MotorVoice,
} from '../core/audio-model';
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
    position,
    kind,
    slide,
  };
}

function frame(
  voices: MeshVoice[],
  extra: Partial<Pick<AudioFrame, 'motors' | 'locks' | 'dt' | 'angles'>> & { at?: Vec3 } = {},
): AudioFrame {
  return {
    voices,
    angles: extra.angles ?? {},
    dt: extra.dt ?? 1 / 60,
    listener: { position: extra.at ?? [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] },
    motors: extra.motors ?? [],
    locks: extra.locks ?? [],
  };
}

function motorVoice(motorId: string, x: number): MotorVoice {
  return {
    motorId,
    size: 'S',
    position: [x, 0, 0],
    strain: 0,
    grind: 0,
    grindFrequency: 660,
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
          rate: 12,
          pitch: clickPitch(12, 'wood'),
          clicks: 0,
          position: [0, 0, 0],
          kind: 'spur',
          slide: 0,
        },
      ],
      background: null,
      motors: [],
      lockSounds: { impacts: 0, rattling: [], rackHits: 0 },
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

  it('モーターの音源はリスナーに近い 4 個まで（motorId の昇順で返す）', () => {
    const engine = createAudioEngine();
    const motors = Array.from({ length: 6 }, (_, i) => motorVoice(`m${i}`, i * 100));
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
      rackHits: 0,
    });
    engine.update(frame([]));
    expect(engine.state().lockSounds).toEqual({ impacts: 1, rattling: [], rackHits: 0 });
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

describe('ラックが端に当たった音（S3-05）', () => {
  const RACK_END: LockInfo = {
    reason: 'rackEnd',
    shaftIds: ['shaft_p'],
    gearIds: ['gear_p'],
    rackIds: ['rack_r'],
  };

  it('端のロックに入った瞬間に当たる音を 1 回数え（ロックの衝撃音には数えない）、続く間はガタガタ', () => {
    const engine = createAudioEngine();
    const locks = [{ info: RACK_END, position: [0, 40, 4] as Vec3 }];
    engine.update(frame([], { locks }));
    engine.update(frame([], { locks: [{ info: { ...RACK_END }, position: [0, 40, 4] }] }));
    expect(engine.state().lockSounds).toEqual({
      impacts: 0,
      rattling: ['rackEnd:shaft_p'],
      rackHits: 1,
    });
    // 解けてもう一度当たると、もう 1 回
    engine.update(frame([]));
    engine.update(frame([], { locks }));
    expect(engine.state().lockSounds.rackHits).toBe(2);
  });
});

describe('粒の音（S4-06）', () => {
  // f Hz の組（12 枚）を 1 秒（60 フレーム）回し、予約した粒の数を返す
  function run(f: number, material: 'metal' | 'wood' = 'metal') {
    const engine = createAudioEngine({ material, random: () => 0.5 });
    const omega = (f * 2 * Math.PI) / 12;
    let angle = 0;
    for (let i = 0; i <= 60; i += 1) {
      engine.update(frame([voice('a', f)], { angles: { a: angle } }));
      angle += omega / 60;
    }
    return engine.state().voices[0];
  }

  it('遅い組（5 Hz）は歯の通過ごとに 1 粒（1 秒で 5 粒）', () => {
    const v = run(5);
    expect(v?.rate).toBe(5);
    expect(v?.clicks).toBe(5);
  });

  it('速い組（1000 Hz）も連続音にせず粒で鳴らし、毎秒 40 回に間引く', () => {
    const v = run(1000);
    expect(v?.rate).toBe(CLICK_RATE_MAX);
    expect(v?.clicks).toBe(CLICK_RATE_MAX);
    expect(v).not.toHaveProperty('tone');
  });

  it('速いほど粒が高い。metal は wood より高い', () => {
    expect(run(100)?.pitch ?? 0).toBeGreaterThan(run(5)?.pitch ?? 0);
    expect(run(24, 'metal')?.pitch ?? 0).toBeGreaterThan(run(24, 'wood')?.pitch ?? 0);
  });

  it('背景にまとめた組の粒の数（rate）を返す', () => {
    const engine = createAudioEngine();
    const voices = Array.from({ length: 18 }, (_, i) => voice(`k${i}`, 5, [i * 10, 0, 0]));
    engine.update(frame(voices));
    expect(engine.state().background?.rate).toBeCloseTo(10, 9);
  });
});
