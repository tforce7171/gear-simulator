import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeMeshVoices, voiceGrainTimes, voiceSlideLevel } from '../audio-model';
import { GEAR_SIZES } from '../constants';
import { applyCommand, type Command } from '../edit/commands';
import { resolveLayout } from '../layout/resolve';
import { createSequentialIdGenerator } from '../scene/ids';
import type { Scene, SpurGear } from '../scene/types';
import { isEngaged } from './engagement';
import { initialMotionState, stepMotion } from './motion';
import type { MotionState } from './types';

// S5-05: 欠け歯車のかみ合いの入り切り（design.md §6）

const DEG = Math.PI / 180;

function fixture(name: string): Scene {
  const url = new URL(`../../../e2e/fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Scene;
}

function command(scene: Scene, c: Command): Scene {
  const result = applyCommand(scene, c, { ids: createSequentialIdGenerator() });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.scene;
}

function run(
  scene: Scene,
  frames: number,
  dt = 1 / 60,
  from = initialMotionState(),
): MotionState[] {
  const layout = resolveLayout(scene);
  const out: MotionState[] = [];
  let m = from;
  for (let i = 0; i < frames; i++) {
    m = stepMotion(scene, layout, m, dt);
    out.push(m);
  }
  return out;
}

describe('isEngaged', () => {
  // 30 歯のうち歯 0〜9 を残す。歯のある弧は局所の角度 ψ ∈ [−6°, 114°]、ψ = 接点の向き − 回転角
  const gear: SpurGear = {
    id: 'g',
    kind: 'spur',
    shaftId: 's',
    size: 'M',
    teeth: 30,
    offset: 0,
    toothCount: 10,
  };

  it('歯のある弧の端の前後で、かかる・かからないが切り替わる', () => {
    const eps = 1e-4;
    // 接点の向き 0: 回転角 r で ψ = −r。弧は r ∈ [−114°, 6°]
    expect(isEngaged(gear, 6 * DEG - eps, 0)).toBe(true);
    expect(isEngaged(gear, 6 * DEG + eps, 0)).toBe(false);
    expect(isEngaged(gear, -114 * DEG + eps, 0)).toBe(true);
    expect(isEngaged(gear, -114 * DEG - eps, 0)).toBe(false);
    // 1 周回っても同じ
    expect(isEngaged(gear, 6 * DEG - eps + 2 * Math.PI, 0)).toBe(true);
    // 接点の向きを 1 ピッチ（12°）進めると、弧の端も 12° ずれる
    expect(isEngaged(gear, 18 * DEG - eps, 12 * DEG)).toBe(true);
    expect(isEngaged(gear, 18 * DEG + eps, 12 * DEG)).toBe(false);
  });

  it('toothStart を 1 増やすと、弧が 1 ピッチ進む', () => {
    const shifted: SpurGear = { ...gear, toothStart: 1 };
    // 弧は ψ ∈ [6°, 126°]
    expect(isEngaged(shifted, -6 * DEG + 1e-4, 0)).toBe(false);
    expect(isEngaged(shifted, -6 * DEG - 1e-4, 0)).toBe(true);
  });

  it('普通の平歯車は常にかかる', () => {
    expect(isEngaged({ ...gear, toothCount: undefined }, 1.234, 0)).toBe(true);
    expect(isEngaged({ ...gear, toothCount: 30 }, 1.234, 0)).toBe(true);
  });
});

// rack-basic（中・20 歯のピニオン、軸 z、ラックは下。接点の向き −90° = 歯 15 の中心）を欠け歯車にしたもの。
// toothStart 13・toothCount 5: 弧は ψ ∈ [225°, 315°]。回転角 0 は弧の中ほどで、ラックとの位相も合っている
function partialRack(toothStart = 13): Scene {
  const base = fixture('rack-basic');
  return command(command(base, { type: 'setToothCount', gearId: 'gear_p', toothCount: 5 }), {
    type: 'setToothStart',
    gearId: 'gear_p',
    toothStart,
  });
}

describe('欠け歯車とラック', () => {
  const pitch = Math.PI * GEAR_SIZES.M.module;

  it('1 回転の間に、ラックが toothCount × π·m だけ進み、残りの角度では止まる', () => {
    // モーター 60 rpm: 60 フレーム（1 秒）でちょうど 1 回転
    const states = run(partialRack(), 60);
    const last = states[states.length - 1] as MotionState;
    expect(last.angles.shaft_p).toBeCloseTo(2 * Math.PI, 6);
    expect(Math.abs(last.rackPositions.rack_r ?? 0)).toBeCloseTo(5 * pitch, 6);
    expect(last.locks).toEqual([]);
    // 歯のない区間（ψ が 225° から 315° − 360° までの 270°）は止まっている
    let still = 0;
    let prev = 0;
    for (const m of states) {
      const s = m.rackPositions.rack_r ?? 0;
      if (s === prev && (m.rackVelocities.rack_r ?? 0) === 0) still++;
      prev = s;
    }
    // 270° = 45 フレーム（区間の両端のフレームは一部だけ動くので、それより少し少ない）
    expect(still).toBeGreaterThanOrEqual(43);
    expect(still).toBeLessThanOrEqual(45);
  });

  it('入る・外れる瞬間をまたぐ大きな時間の刻みでも、瞬間の前後で区切られ、位置が飛ばない', () => {
    const scene = partialRack();
    // 細かい刻み（1/600 秒）と、1 回の大きな刻みで、同じ位置・角度になる
    for (const dt of [0.1, 0.37, 1]) {
      const fine = run(scene, Math.round(dt * 600), 1 / 600);
      const coarse = run(scene, 1, dt);
      const a = fine[fine.length - 1] as MotionState;
      const b = coarse[0] as MotionState;
      expect(b.angles.shaft_p).toBeCloseTo(a.angles.shaft_p ?? 0, 6);
      expect(b.rackPositions.rack_r).toBeCloseTo(a.rackPositions.rack_r ?? 0, 6);
      expect(b.locks).toEqual([]);
    }
    // 1 秒（1 回転）を 1 回で進めても、ラックは歯のある弧のぶん（5 歯）だけ動く
    const once = run(scene, 1, 1)[0] as MotionState;
    expect(Math.abs(once.rackPositions.rack_r ?? 0)).toBeCloseTo(5 * pitch, 6);
  });

  it('かみ合い直す瞬間に位相が合わない配置 → その瞬間に toothClash でロックし、ラックは動かない', () => {
    // toothStart 0: 弧は ψ ∈ [−9°, 81°]。回転角 0（ψ = 270°）は弧の外で、弧の端に来るまで 189°（10.5 歯）回るので、
    // 端でラックの歯と半ピッチずれる
    const states = run(partialRack(0), 120);
    const last = states[states.length - 1] as MotionState;
    expect(last.locks.map((l) => l.reason)).toEqual(['toothClash']);
    expect(last.locks[0]?.rackIds).toEqual(['rack_r']);
    expect(last.rackPositions.rack_r).toBe(0);
    // 端（189°）で止まる
    expect(last.angles.shaft_p).toBeCloseTo(189 * DEG, 6);
    expect(last.omegas.shaft_p).toBe(0);
  });
});

describe('見本「ラック往復」', () => {
  const scene = fixture('rack-reciprocation');
  const layout = resolveLayout(scene);
  const travel = layout.racks.rack_r?.travel ?? [0, 0];
  const pitch = Math.PI * GEAR_SIZES.S.module;

  it('何回転させても、ラックの位置が送りの範囲の中で往復し、ロックしない。1 往復で元の位置に戻る', () => {
    // 60 rpm: 60 フレームで 1 回転（1 往復）。20 回転
    const states = run(scene, 1200);
    let lo = 0;
    let hi = 0;
    let turns = 0;
    let lastSign = 0;
    states.forEach((m, i) => {
      expect(m.locks).toEqual([]);
      const s = m.rackPositions.rack_r ?? 0;
      expect(s).toBeGreaterThanOrEqual(travel[0]);
      expect(s).toBeLessThanOrEqual(travel[1]);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
      const v = m.rackVelocities.rack_r ?? 0;
      const sign = Math.sign(v);
      if (sign !== 0 && sign !== lastSign) {
        if (lastSign !== 0) turns++;
        lastSign = sign;
      }
      // 1 回転ごとに元の位置（0）に戻る
      if ((i + 1) % 60 === 0) expect(s).toBeCloseTo(0, 6);
    });
    // 左右の送りの長さは 8 歯ぶん（8·π·m）
    expect(hi - lo).toBeCloseTo(8 * pitch, 6);
    // 1 回転で向きが 2 回変わる
    expect(turns).toBeGreaterThanOrEqual(39);
  });

  it('1 回転の中に、どちらもかからずラックが止まる区間がある', () => {
    const states = run(scene, 60);
    expect(states.some((m) => m.rackVelocities.rack_r === 0)).toBe(true);
  });

  it('歯のある弧が重なる配置 → 両方がかかった瞬間に contradiction でロックする', () => {
    // B の弧を A の弧と重ねる（toothStart 4: B は ψ ∈ [96.9°, 318.5°]、A は [41.5°, 115.4°]）
    const overlapped = command(scene, { type: 'setToothStart', gearId: 'gear_b', toothStart: 4 });
    const states = run(overlapped, 60);
    const first = states.findIndex((m) => m.locks.length > 0);
    expect(first).toBeGreaterThan(0);
    // ロックする前はラックが動いている（B だけがかかっている間）
    expect(states[first - 1]?.rackVelocities.rack_r).not.toBe(0);
    expect(states[first]?.locks.map((l) => l.reason)).toEqual(['contradiction']);
    expect(states[states.length - 1]?.locks.map((l) => l.reason)).toEqual(['contradiction']);
  });

  it('かかっていない声は粒を出さず、すべりの雑音・ジーも 0', () => {
    // A がラックにかかっている間（中間歯車と B は外れている）を探す
    const states = run(scene, 60);
    const m = states.find(
      (s) => (s.rackVelocities.rack_r ?? 0) !== 0 && Math.sign(s.rackVelocities.rack_r ?? 0) > 0,
    );
    if (m === undefined) throw new Error('A がかかっている瞬間が無い');
    const voices = computeMeshVoices(scene, layout, m);
    const bIdler = voices.find((v) => v.key === 'gear_b|gear_idler');
    const aRack = voices.find((v) => v.key === 'gear_a|rack_r');
    expect(aRack?.engaged).toBe(true);
    expect(bIdler?.engaged).toBe(false);
    if (bIdler === undefined) throw new Error('B と中間歯車の声が無い');
    // B は回り続けているので歯の通過頻度は 0 でないが、粒は出ない
    expect(bIdler.frequency).toBeGreaterThan(0);
    expect(voiceGrainTimes(bIdler, 0, 2 * Math.PI, 1 / 60, 0, () => 0.5).times).toEqual([]);
    // 金属のテーマで速く回したとき（f > CLICK_RATE_MAX）のジーも出さない
    const fast = { ...bIdler, frequency: 72 };
    expect(voiceSlideLevel(fast, 'metal')).toBe(0);
    expect(voiceSlideLevel({ ...fast, engaged: true }, 'metal')).toBeGreaterThan(0);
    // かかっている声は粒を出す
    if (aRack === undefined) throw new Error('A とラックの声が無い');
    expect(
      voiceGrainTimes({ ...aRack, frequency: 5 }, 0, 2 * Math.PI, 1 / 60, 0, () => 0.5).times
        .length,
    ).toBeGreaterThan(0);
  });
});
