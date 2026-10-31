import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_AUDIO_VOICES } from '../constants';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import type { LockInfo } from '../kinematics/types';
import { resolveLayout } from '../layout/resolve';
import type { Layout } from '../layout/types';
import type { Vec3 } from '../math/vec3';
import type { Scene } from '../scene/types';
import {
  BACKGROUND_MAX_LEVEL,
  BACKGROUND_MAX_RATE,
  CLICK_RATE_MAX,
  canPlayImpact,
  computeMotorVoices,
  diffLocks,
  distanceGain,
  grainLevel,
  LOCK_IMPACT_LIMIT,
  lockKey,
  lockPosition,
  MATERIALS,
  MAX_MOTOR_VOICES,
  meshContactPoint,
  motorLoadParams,
  selectVoices,
  summarizeBackground,
  VOICE_HYSTERESIS,
  type VoiceCandidate,
} from './index';

// S1-26: 音の空間配置・選び方・背景のうなり・専用音

function layoutWith(gears: Record<string, { center: Vec3; pitchRadius: number }>): Layout {
  return {
    shafts: {},
    gears: Object.fromEntries(
      Object.entries(gears).map(([id, g]) => [
        id,
        { center: g.center, axis: 'y', pitchRadius: g.pitchRadius, basePhase: 0 },
      ]),
    ),
    carriers: {},
    racks: {},
    rackMeshes: [],
    meshes: [],
    interferences: [],
  };
}

function candidate(key: string, x: number, frequency = 100, level = 0.2): VoiceCandidate {
  return { key, position: [x, 0, 0], frequency, level };
}

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

describe('定数', () => {
  it('モーターは 4 個まで、ヒステリシスは 0.9、かみ合いは 16 組まで', () => {
    expect(MAX_MOTOR_VOICES).toBe(4);
    expect(VOICE_HYSTERESIS).toBe(0.9);
    expect(MAX_AUDIO_VOICES).toBe(16);
  });
});

describe('meshContactPoint', () => {
  it('a（中心 (0,0,0)、r 12）と b（中心 (36,0,0)、r 24）→ (12, 0, 0)', () => {
    const layout = layoutWith({
      a: { center: [0, 0, 0], pitchRadius: 12 },
      b: { center: [36, 0, 0], pitchRadius: 24 },
    });
    const p = meshContactPoint(layout, { a: 'a', b: 'b', source: 'tree', kind: 'spur' });
    expect(p[0]).toBeCloseTo(12, 12);
    expect(p[1]).toBeCloseTo(0, 12);
    expect(p[2]).toBeCloseTo(0, 12);
  });

  it('斜めの向きでも a の中心からピッチ円半径の点', () => {
    const layout = layoutWith({
      a: { center: [1, 2, 3], pitchRadius: 5 },
      b: { center: [1, 2 + 6, 3 + 8], pitchRadius: 5 },
    });
    const p = meshContactPoint(layout, { a: 'a', b: 'b', source: 'contact', kind: 'spur' });
    expect(p[0]).toBeCloseTo(1, 12);
    expect(p[1]).toBeCloseTo(5, 12);
    expect(p[2]).toBeCloseTo(7, 12);
  });
});

describe('distanceGain', () => {
  it('150 → 1、600 → 0.25、50 → 1（refDistance 未満は refDistance として扱う）', () => {
    expect(distanceGain(150)).toBeCloseTo(1, 12);
    expect(distanceGain(600)).toBeCloseTo(0.25, 12);
    expect(distanceGain(50)).toBeCloseTo(1, 12);
  });
});

describe('selectVoices', () => {
  it('x = 0, 10, …, 200 の 21 個、リスナー原点、previous 空、max 16 → x = 0〜150 の 16 個と残り 5 個', () => {
    const candidates = Array.from({ length: 21 }, (_, i) => candidate(`k${i}`, i * 10));
    const { selected, rest } = selectVoices(candidates, [0, 0, 0], new Set(), 16);
    expect(selected).toHaveLength(16);
    expect(selected.map((c) => c.position[0]).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i * 10),
    );
    expect(rest).toHaveLength(5);
    expect(rest.map((c) => c.position[0]).sort((a, b) => a - b)).toEqual([160, 170, 180, 190, 200]);
  });

  it('ヒステリシス: A（100、鳴っていた）と B（95）→ A が残る。B が 85 → B に入れ替わる', () => {
    const a = candidate('A', 100);
    const previous = new Set(['A']);
    expect(selectVoices([a, candidate('B', 95)], [0, 0, 0], previous, 1).selected[0]?.key).toBe(
      'A',
    );
    expect(selectVoices([a, candidate('B', 85)], [0, 0, 0], previous, 1).selected[0]?.key).toBe(
      'B',
    );
  });

  it('同じ距離の候補は key の文字列順で選ばれる', () => {
    const candidates = [candidate('c', 50), candidate('a', -50), candidate('b', 50)];
    const { selected, rest } = selectVoices(candidates, [0, 0, 0], new Set(), 2);
    expect(selected.map((c) => c.key)).toEqual(['a', 'b']);
    expect(rest.map((c) => c.key)).toEqual(['c']);
  });

  it('止まっている（f = 0）候補は selected にも rest にも入らない', () => {
    const candidates = [candidate('stop', 0, 0), candidate('go', 10)];
    const { selected, rest } = selectVoices(candidates, [0, 0, 0], new Set(), 16);
    expect(selected.map((c) => c.key)).toEqual(['go']);
    expect(rest).toEqual([]);
  });
});

describe('summarizeBackground', () => {
  it('空 → null', () => {
    expect(summarizeBackground([], [0, 0, 0])).toBeNull();
  });

  it('同じ 100 Hz・同じ level・同じ距離の 4 個 → frequency 100、level は 1 個のときの 2 倍', () => {
    const one = summarizeBackground([candidate('a', 300, 100, 0.1)], [0, 0, 0]);
    const four = summarizeBackground(
      ['a', 'b', 'c', 'd'].map((k) => candidate(k, 300, 100, 0.1)),
      [0, 0, 0],
    );
    expect(one?.frequency).toBeCloseTo(100, 9);
    expect(four?.frequency).toBeCloseTo(100, 9);
    expect(one?.level).toBeCloseTo(0.1 * distanceGain(300), 12);
    expect(four?.level).toBeCloseTo(2 * (one?.level ?? 0), 12);
  });

  it('音量は 0.5 でクランプする', () => {
    const many = Array.from({ length: 4 }, (_, i) => candidate(`k${i}`, 0, 100, 0.4));
    expect(summarizeBackground(many, [0, 0, 0])?.level).toBe(BACKGROUND_MAX_LEVEL);
    expect(BACKGROUND_MAX_LEVEL).toBe(0.5);
  });

  it('100 Hz と 400 Hz を同じ重み → frequency 200（対数の平均）', () => {
    const bg = summarizeBackground(
      [candidate('a', 0, 100, 0.1), candidate('b', 0, 400, 0.1)],
      [0, 0, 0],
    );
    expect(bg?.frequency).toBeCloseTo(200, 9);
  });

  it('周波数は 30〜2000 Hz にクランプする', () => {
    expect(summarizeBackground([candidate('a', 0, 5, 0.1)], [0, 0, 0])?.frequency).toBe(30);
    expect(summarizeBackground([candidate('a', 0, 5000, 0.1)], [0, 0, 0])?.frequency).toBe(2000);
  });

  it('粒の数（S4-06）: 各組の clickRate の和。上限 BACKGROUND_MAX_RATE', () => {
    const two = summarizeBackground(
      [candidate('a', 0, 5, 0.1), candidate('b', 0, 24, 0.1)],
      [0, 0, 0],
    );
    expect(two?.rate).toBeCloseTo(29, 9);
    const many = Array.from({ length: 10 }, (_, i) => candidate(`k${i}`, 0, 1000, 0.1));
    expect(summarizeBackground(many, [0, 0, 0])?.rate).toBe(BACKGROUND_MAX_RATE);
    expect(BACKGROUND_MAX_RATE).toBeGreaterThan(CLICK_RATE_MAX);
  });
});

describe('grainLevel（S4-06）', () => {
  it('動いている組は材質の粒の音量に比例、止まっていれば 0', () => {
    expect(grainLevel(10, 'metal')).toBeGreaterThan(0);
    expect(grainLevel(800, 'wood')).toBeCloseTo(grainLevel(10, 'wood'), 12);
    expect(grainLevel(10, 'metal') / grainLevel(10, 'wood')).toBeCloseTo(
      MATERIALS.metal.click.gain / MATERIALS.wood.click.gain,
      12,
    );
    expect(grainLevel(0, 'metal')).toBe(0);
  });
});

describe('diffLocks', () => {
  const lock: LockInfo = {
    reason: 'stalemate',
    shaftIds: ['shaft_1', 'shaft_2'],
    gearIds: ['gear_1', 'gear_2'],
  };

  it('prev 空 → next に 1 件 → entered 1 件、exited 0', () => {
    const d = diffLocks([], [lock]);
    expect(d.entered).toEqual([lockKey(lock)]);
    expect(d.exited).toEqual([]);
  });

  it('同じ内容（配列は別の参照）→ どちらも空', () => {
    const copy: LockInfo = {
      reason: 'stalemate',
      shaftIds: ['shaft_1', 'shaft_2'],
      gearIds: ['gear_1', 'gear_2'],
    };
    expect(diffLocks([lock], [copy])).toEqual({ entered: [], exited: [] });
  });

  it('解けた → exited 1 件。キーは理由とシャフトの ID をつないだもの', () => {
    expect(diffLocks([lock], [])).toEqual({ entered: [], exited: [lockKey(lock)] });
    expect(lockKey(lock)).toBe('stalemate:shaft_1,shaft_2');
    expect(lockKey({ ...lock, reason: 'contradiction' })).not.toBe(lockKey(lock));
  });
});

describe('lockPosition', () => {
  it('ロックしている歯車の中心の平均', () => {
    const layout = layoutWith({
      gear_1: { center: [0, 20, 0], pitchRadius: 20 },
      gear_2: { center: [40, 20, 0], pitchRadius: 20 },
    });
    const p = lockPosition(layout, {
      reason: 'stalemate',
      shaftIds: ['shaft_1', 'shaft_2'],
      gearIds: ['gear_1', 'gear_2'],
    });
    expect(p).toEqual([20, 20, 0]);
  });
});

describe('canPlayImpact', () => {
  it('直近 1 秒に 4 回鳴らしていたら鳴らさない。1 秒たてば鳴らせる', () => {
    expect(LOCK_IMPACT_LIMIT).toBe(4);
    expect(canPlayImpact([], 0)).toBe(true);
    expect(canPlayImpact([0, 0.1, 0.2], 0.3)).toBe(true);
    expect(canPlayImpact([0, 0.1, 0.2, 0.3], 0.4)).toBe(false);
    expect(canPlayImpact([0, 0.1, 0.2, 0.3], 1.05)).toBe(true);
  });
});

// S4-06: モーターのうなり（のこぎり波）はやめ、過負荷のきしみ（帯域雑音）だけ残す
describe('motorLoadParams', () => {
  it('小、60 rpm、+1: ω = 2π → strain 0、grind 0', () => {
    const p = motorLoadParams('S', 60, 1, 2 * Math.PI);
    expect(p.strain).toBeCloseTo(0, 12);
    expect(p.grind).toBe(0);
    expect(p.grindFrequency).toBeCloseTo(660, 9);
  });

  it('ω = 0 → strain 1、grind 0', () => {
    const p = motorLoadParams('S', 60, 1, 0);
    expect(p.strain).toBeCloseTo(1, 12);
    expect(p.grind).toBe(0);
  });

  it('ω = −π → strain 1.5、grind 0.5、きしみの帯域は 528 Hz（前と同じ）', () => {
    const p = motorLoadParams('S', 60, 1, -Math.PI);
    expect(p.strain).toBeCloseTo(1.5, 12);
    expect(p.grind).toBeCloseTo(0.5, 12);
    expect(p.grindFrequency).toBeCloseTo(528, 9);
  });

  it('中は 420 Hz、大は 270 Hz が基準。向き −1 で −ω0 なら strain 0', () => {
    expect(motorLoadParams('M', 30, 1, Math.PI).grindFrequency).toBeCloseTo(420, 9);
    expect(motorLoadParams('L', 15, 1, Math.PI / 2).grindFrequency).toBeCloseTo(270, 9);
    expect(motorLoadParams('S', 60, -1, -2 * Math.PI).strain).toBeCloseTo(0, 12);
    expect(motorLoadParams('S', 60, -1, 0).strain).toBeCloseTo(1, 12);
  });

  it('うなりの周波数・音量は含まない', () => {
    const p = motorLoadParams('S', 60, 1, -Math.PI);
    expect(Object.keys(p).sort()).toEqual(['grind', 'grindFrequency', 'strain']);
  });
});

describe('computeMotorVoices', () => {
  const at = (): Vec3 => [0, 0, 0];

  it('back-driven.json: 大が勝ち、小は strain ≈ 1.22・grind ≈ 0.22、大の grind は 0', () => {
    const scene = fixture('back-driven');
    const layout = resolveLayout(scene);
    const motion = solveMotion(scene, layout, initialMotionState());
    const voices = computeMotorVoices(scene, motion, false, at);
    const small = voices.find((h) => h.size === 'S');
    const large = voices.find((h) => h.size === 'L');
    expect(motion.backDriven).toEqual([small?.motorId]);
    expect(small?.strain).toBeCloseTo(50 / 41, 9);
    expect(small?.grind).toBeCloseTo(9 / 41, 9);
    expect(large?.grind).toBe(0);
  });

  it('モーターの音源の値に、うなりの周波数が含まれない（過負荷の雑音は含まれる）', () => {
    const scene = fixture('back-driven');
    const layout = resolveLayout(scene);
    const motion = solveMotion(scene, layout, initialMotionState());
    const voices = computeMotorVoices(scene, motion, false, at);
    expect(voices).toHaveLength(2);
    for (const v of voices) {
      expect(v).not.toHaveProperty('frequency');
      expect(v).not.toHaveProperty('level');
      expect(Object.keys(v).sort()).toEqual([
        'grind',
        'grindFrequency',
        'motorId',
        'position',
        'size',
        'strain',
      ]);
    }
    const small = voices.find((h) => h.size === 'S');
    expect(small?.grind).toBeGreaterThan(0);
    expect(small?.grindFrequency).toBeGreaterThan(0);
  });

  it('一時停止中は空。OFF のモーターは除く', () => {
    const scene = fixture('lock-opposed');
    const layout = resolveLayout(scene);
    const motion = solveMotion(scene, layout, initialMotionState());
    expect(computeMotorVoices(scene, motion, true, at)).toEqual([]);
    expect(computeMotorVoices(scene, motion, false, at)).toHaveLength(2);
    const motor = scene.motors.motor_2;
    if (motor === undefined) throw new Error('motor_2 が無い');
    const off: Scene = { ...scene, motors: { ...scene.motors, motor_2: { ...motor, on: false } } };
    expect(computeMotorVoices(off, motion, false, at).map((h) => h.motorId)).toEqual(['motor_1']);
  });
});
