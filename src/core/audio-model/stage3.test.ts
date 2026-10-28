import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initialMotionState, solveMotion } from '../kinematics/motion';
import type { LockInfo, MotionState } from '../kinematics/types';
import { resolveLayout } from '../layout/resolve';
import { gearWorldCenter } from '../layout/world';
import type { Scene } from '../scene/types';
import {
  computeMeshVoices,
  MESH_TIMBRES,
  meshKey,
  meshTimbre,
  planetToothPassFrequency,
  rackEndHits,
  rackToothPassFrequency,
  VOICE_KINDS,
} from './index';
import { lockKey, meshContactPoint } from './spatial';

// S3-05: 段階 3 の部品の音（遊星のかみ合い・ラックの組・内歯車の組・ラックの端の当たる音）

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

describe('歯の通過頻度', () => {
  it('rackToothPassFrequency(40π, 2) = 20（rack-basic の速さ。P 20 歯 × 1 回転/秒と同じ）', () => {
    expect(rackToothPassFrequency(40 * Math.PI, 2)).toBeCloseTo(20, 12);
    expect(rackToothPassFrequency(-40 * Math.PI, 2)).toBeCloseTo(20, 12);
    expect(rackToothPassFrequency(0, 2)).toBe(0);
  });

  it('planetToothPassFrequency(24, 2π, 2π/3)（リング固定、太陽 60 rpm・キャリア 20 rpm）= 24 × (1 − 1/3) = 16 Hz', () => {
    expect(planetToothPassFrequency(24, 2 * Math.PI, (2 * Math.PI) / 3)).toBeCloseTo(16, 12);
  });
});

describe('computeMeshVoices（S3-05）', () => {
  it('planetary-ring-fixed → 太陽と遊星の組 3 つ・遊星とリングの組 3 つ。どれも f = 16 Hz', () => {
    const scene = fixture('planetary-ring-fixed');
    const layout = resolveLayout(scene);
    const motion = solveMotion(scene, layout, initialMotionState());
    expect(motion.omegas.shaft_k).toBeCloseTo((2 * Math.PI) / 3, 9);
    const voices = computeMeshVoices(scene, layout, motion);
    const planets = ['gear_p0', 'gear_p1', 'gear_p2'];
    const sunPlanet = voices.filter((v) => planets.some((p) => v.key === meshKey(p, 'gear_s')));
    const planetRing = voices.filter((v) => planets.some((p) => v.key === meshKey(p, 'gear_r')));
    expect(sunPlanet).toHaveLength(3);
    expect(planetRing).toHaveLength(3);
    // 遊星とリングの組の f = 12 × |−2π − 2π/3| / 2π = 16 Hz（太陽と遊星の組と一致する）
    expect(motion.omegas.shaft_p0).toBeCloseTo(-2 * Math.PI, 9);
    for (const v of [...sunPlanet, ...planetRing]) {
      expect(v.frequency).toBeCloseTo(16, 9);
      expect(v.carrierShaftId).toBe('shaft_k');
    }
    expect(planetRing.every((v) => v.kind === 'internal')).toBe(true);
    expect(sunPlanet.every((v) => v.kind === 'spur')).toBe(true);
  });

  it('音源の位置が、キャリアの角度 π のとき基準配置から π 回った位置', () => {
    const scene = fixture('planetary-ring-fixed');
    const layout = resolveLayout(scene);
    const base = solveMotion(scene, layout, initialMotionState());
    const turned: MotionState = { ...base, angles: { ...base.angles, shaft_k: Math.PI } };
    const before = computeMeshVoices(scene, layout, base);
    const after = computeMeshVoices(scene, layout, turned);
    // 太陽・リングの軸は y（原点 [0, 60, 0]）なので、π 回ると x・z の符号が反転し、y は変わらない
    for (const v of before) {
      const w = after.find((x) => x.key === v.key);
      expect(w).toBeDefined();
      if (w === undefined) continue;
      expect(w.position[0]).toBeCloseTo(-v.position[0], 9);
      expect(w.position[1]).toBeCloseTo(v.position[1], 9);
      expect(w.position[2]).toBeCloseTo(-v.position[2], 9);
    }
    // 基準配置の接点と一致する（π のときは公転した遊星の中心で求めた接点）
    const mesh = layout.meshes.find((m) => m.carrierShaftId !== undefined);
    if (mesh === undefined) throw new Error('遊星のかみ合いが無い');
    const v = after.find((x) => x.key === meshKey(mesh.a, mesh.b));
    expect(v?.position).toEqual(meshContactPoint(layout, mesh, turned));
    const p0 = gearWorldCenter(layout, turned, 'gear_p0');
    expect(p0[2]).toBeCloseTo(-36, 9);
  });

  it('rack-basic → ラックの組の f = 20 Hz、kind: rack、位置は接点 [0, 40, 4]', () => {
    const scene = fixture('rack-basic');
    const layout = resolveLayout(scene);
    const motion = solveMotion(scene, layout, initialMotionState());
    const voices = computeMeshVoices(scene, layout, motion);
    const rack = voices.filter((v) => v.key === meshKey('gear_p', 'rack_r'));
    expect(rack).toHaveLength(1);
    const [v] = rack;
    expect(v?.frequency).toBeCloseTo(20, 9);
    expect(v?.kind).toBe('rack');
    expect(v?.gearId).toBe('gear_p');
    expect(v?.position[0]).toBeCloseTo(0, 9);
    expect(v?.position[1]).toBeCloseTo(40, 9);
    expect(v?.position[2]).toBeCloseTo(4, 9);
  });

  it('ラックの速さで音の高さが変わる（rack-basic のモーター 30 rpm → 10 Hz）', () => {
    const scene = fixture('rack-basic');
    const motor = scene.motors.motor_p;
    if (motor === undefined) throw new Error('motor_p が無い');
    const slow: Scene = { ...scene, motors: { motor_p: { ...motor, rpm: 30 } } };
    const layout = resolveLayout(slow);
    const motion = solveMotion(slow, layout, initialMotionState());
    const [v] = computeMeshVoices(slow, layout, motion).filter((x) => x.kind === 'rack');
    expect(v?.frequency).toBeCloseTo(10, 9);
  });
});

describe('ラックが端に当たった瞬間の検出（rackEndHits）', () => {
  const rackEnd: LockInfo = {
    reason: 'rackEnd',
    shaftIds: ['shaft_p'],
    gearIds: ['gear_p'],
    rackIds: ['rack_r'],
  };
  const stalemate: LockInfo = { reason: 'stalemate', shaftIds: ['s1'], gearIds: [] };

  it("前のフレームに 'rackEnd' がなく、今のフレームにある → 1 回。続くフレーム → 0 回", () => {
    expect(rackEndHits([], [rackEnd]).map(lockKey)).toEqual(['rackEnd:shaft_p']);
    expect(rackEndHits([rackEnd], [{ ...rackEnd }])).toEqual([]);
  });

  it("'rackEnd' 以外のロックは数えない。解けてから入り直すともう 1 回", () => {
    expect(rackEndHits([], [stalemate])).toEqual([]);
    expect(rackEndHits([rackEnd], [])).toEqual([]);
    expect(rackEndHits([], [rackEnd])).toHaveLength(1);
  });
});

describe('音色（S3-05）', () => {
  it('内歯車の組は平歯車と同じ音色で、うなりのローパスだけ下げる（こもらせる）', () => {
    const spur = meshTimbre('spur');
    const internal = meshTimbre('internal');
    expect({ ...internal, lowpass: 1 }).toEqual(spur);
    expect(internal.lowpass).toBeGreaterThan(0);
    expect(internal.lowpass).toBeLessThan(1);
  });

  it('ラックの組は平歯車と同じ音色', () => {
    expect(meshTimbre('rack')).toEqual(meshTimbre('spur'));
  });

  it('すべての音源の種類に音色がある', () => {
    expect([...VOICE_KINDS].sort()).toEqual(Object.keys(MESH_TIMBRES).sort());
    expect(VOICE_KINDS).toContain('rack');
  });
});
