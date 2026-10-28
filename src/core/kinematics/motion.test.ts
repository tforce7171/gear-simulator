import { describe, expect, it } from 'vitest';
import type { Layout, Mesh } from '../layout/types';
import type { Gear, Motor, Scene, Shaft, ShaftId, SizeKey } from '../scene/types';
import { initialMotionState, type MotionOptions, solveMotion, stepMotion } from './motion';
import type { MotionState } from './types';

// テストのシーン。歯車はすべて大きさ S。roots に挙げたシャフトだけを root、他は mesh にする
// （mesh の親子の参照はこのモジュールでは使わないので、形だけ埋める）
type GearSpec = readonly [id: string, shaftId: ShaftId, teeth: number];
type MotorSpec = readonly [
  id: string,
  shaftId: ShaftId,
  size: SizeKey,
  rpm: number,
  direction: 1 | -1,
  on?: boolean,
];

const A = 'shaft_a';
const B = 'shaft_b';
const C = 'shaft_c';
const D = 'shaft_d';
const PI = Math.PI;
const DIGITS = 10;

function makeScene(
  shaftIds: readonly ShaftId[],
  gears: readonly GearSpec[],
  motors: readonly MotorSpec[],
  roots: readonly ShaftId[] = [A],
): Scene {
  const shafts: Record<string, Shaft> = {};
  for (const id of shaftIds) {
    shafts[id] = roots.includes(id)
      ? { id, placement: { kind: 'root', origin: [0, 0, 0], axis: 'y' } }
      : {
          id,
          placement: {
            kind: 'mesh',
            parentGearId: 'gear_parent',
            childGearId: 'gear_child',
            angle: 0,
          },
        };
  }
  const gearMap: Record<string, Gear> = {};
  for (const [id, shaftId, teeth] of gears) {
    gearMap[id] = { id, kind: 'spur', shaftId, size: 'S', teeth, offset: 0 };
  }
  const motorMap: Record<string, Motor> = {};
  for (const [id, shaftId, size, rpm, direction, on = true] of motors) {
    motorMap[id] = { id, shaftId, size, rpm, direction, on };
  }
  return { shafts, gears: gearMap, motors: motorMap };
}

// meshes だけを手で埋めた Layout（S1-09 に依存しない）
function layoutOf(meshes: readonly Mesh[]): Layout {
  return { shafts: {}, gears: {}, meshes, interferences: [] };
}

function tree(a: string, b: string): Mesh {
  return { a, b, source: 'tree', kind: 'spur' };
}

interface Setup {
  readonly scene: Scene;
  readonly layout: Layout;
}

// A(12)–B(teethB)
function pair(
  teethB: number,
  motors: readonly MotorSpec[],
  roots: readonly ShaftId[] = [A],
): Setup {
  return {
    scene: makeScene(
      [A, B],
      [
        ['gear_a', A, 12],
        ['gear_b', B, teethB],
      ],
      motors,
      roots,
    ),
    layout: layoutOf([tree('gear_a', 'gear_b')]),
  };
}

// 12 歯の正三角形。A–B・B–C は tree、A–C は contact
function triangle(motors: readonly MotorSpec[]): Setup {
  return {
    scene: makeScene(
      [A, B, C],
      [
        ['gear_a', A, 12],
        ['gear_b', B, 12],
        ['gear_c', C, 12],
      ],
      motors,
    ),
    layout: layoutOf([
      tree('gear_a', 'gear_b'),
      tree('gear_b', 'gear_c'),
      { a: 'gear_a', b: 'gear_c', source: 'contact', kind: 'spur' },
    ]),
  };
}

function motion(angles: Record<ShaftId, number>): MotionState {
  return { ...initialMotionState(), angles };
}

function step(s: Setup, prev: MotionState, dt: number, opts?: MotionOptions): MotionState {
  return stepMotion(s.scene, s.layout, prev, dt, opts);
}

const stalematePair = (): Setup =>
  pair(12, [
    ['motor_a', A, 'S', 60, 1],
    ['motor_b', B, 'S', 60, 1],
  ]);

const drivenPair = (): Setup => pair(24, [['motor_a', A, 'S', 60, 1]]);

describe('initialMotionState', () => {
  it('全て空', () => {
    expect(initialMotionState()).toEqual({ angles: {}, omegas: {}, locks: [], backDriven: [] });
  });
});

describe('stepMotion: ロック', () => {
  it('ロックなし: A(12)–B(24)、A に S 60rpm', () => {
    const m = step(drivenPair(), initialMotionState(), 0);
    expect(m.locks).toEqual([]);
    expect(m.backDriven).toEqual([]);
    expect(m.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
    expect(m.omegas[B]).toBeCloseTo(-PI, DIGITS);
  });

  it('stalemate: A(12)–B(12)、両方に S 60rpm direction 1', () => {
    const m = step(stalematePair(), initialMotionState(), 0);
    expect(m.locks).toEqual([
      { reason: 'stalemate', shaftIds: [A, B], gearIds: ['gear_a', 'gear_b'] },
    ]);
    expect(m.omegas).toEqual({ [A]: 0, [B]: 0 });
    expect(m.backDriven).toEqual([]);
  });

  it('歯数比での stalemate: A(12)–B(36)、A に S、B に M（direction 1）', () => {
    const s = pair(36, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'M', 30, 1],
    ]);
    const m = step(s, initialMotionState(), 0);
    expect(m.locks.map((l) => l.reason)).toEqual(['stalemate']);
    expect(m.omegas).toEqual({ [A]: 0, [B]: 0 });
  });

  it('ロックしない（同じ向き）: A に S 60rpm d1、B に S 60rpm d−1', () => {
    const s = pair(12, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'S', 60, -1],
    ]);
    const m = step(s, initialMotionState(), 0);
    expect(m.locks).toEqual([]);
    expect(m.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
  });

  it('contradiction（正三角形の contact）: A に S 60rpm ON', () => {
    const m = step(triangle([['motor_a', A, 'S', 60, 1]]), initialMotionState(), 0);
    expect(m.locks).toEqual([
      { reason: 'contradiction', shaftIds: [A, B, C], gearIds: ['gear_a', 'gear_b', 'gear_c'] },
    ]);
    expect(m.omegas).toEqual({ [A]: 0, [B]: 0, [C]: 0 });
  });

  it('contradiction にならない: モーター無し、OFF、一時停止', () => {
    expect(step(triangle([]), initialMotionState(), 0).locks).toEqual([]);
    expect(
      step(triangle([['motor_a', A, 'S', 60, 1, false]]), initialMotionState(), 0).locks,
    ).toEqual([]);
    expect(
      step(triangle([['motor_a', A, 'S', 60, 1]]), initialMotionState(), 0, { paused: true }).locks,
    ).toEqual([]);
  });

  it('ロックは成分ごと: stalemate の成分と、別の成分 C(12)–D(24)', () => {
    const scene = makeScene(
      [A, B, C, D],
      [
        ['gear_a', A, 12],
        ['gear_b', B, 12],
        ['gear_c', C, 12],
        ['gear_d', D, 24],
      ],
      [
        ['motor_a', A, 'S', 60, 1],
        ['motor_b', B, 'S', 60, 1],
        ['motor_c', C, 'S', 60, 1],
      ],
      [A, C],
    );
    const layout = layoutOf([tree('gear_a', 'gear_b'), tree('gear_c', 'gear_d')]);
    const m = stepMotion(scene, layout, initialMotionState(), 0);
    expect(m.locks).toHaveLength(1);
    expect(m.locks[0]?.shaftIds).toEqual([A, B]);
    expect(m.omegas[C]).toBeCloseTo(2 * PI, DIGITS);
    expect(m.omegas[D]).toBeCloseTo(-PI, DIGITS);
  });
});

describe('stepMotion: 負けたモーター', () => {
  it('逆向き・強いほうが勝つ: A に S、B に M → A のモーター', () => {
    const s = pair(12, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'M', 60, 1],
    ]);
    const m = step(s, initialMotionState(), 0);
    expect(m.backDriven).toEqual(['motor_a']);
    expect(m.locks).toEqual([]);
  });

  it('ギア比はてこ → C の L のモーター', () => {
    const scene = makeScene(
      [A, B, C],
      [
        ['gear_a', A, 12],
        ['gear_b1', B, 60],
        ['gear_b2', B, 12],
        ['gear_c', C, 60],
      ],
      [
        ['motor_a', A, 'S', 60, 1],
        ['motor_c', C, 'L', 15, -1],
      ],
    );
    const layout = layoutOf([tree('gear_a', 'gear_b1'), tree('gear_b2', 'gear_c')]);
    expect(stepMotion(scene, layout, initialMotionState(), 0).backDriven).toEqual(['motor_c']);
  });
});

describe('stepMotion: 角度', () => {
  it('角度の積分: dt = 0.5 を 1 回 → A = π、B = −π/2', () => {
    const m = step(drivenPair(), initialMotionState(), 0.5);
    expect(m.angles[A]).toBeCloseTo(PI, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-PI / 2, DIGITS);
  });

  it('位相がずれない: dt = 1/60 を 10000 回', () => {
    const s = drivenPair();
    let m = initialMotionState();
    for (let i = 0; i < 10000; i++) m = step(s, m, 1 / 60);
    const thetaA = m.angles[A] as number;
    const thetaB = m.angles[B] as number;
    expect(Math.abs(thetaB + 0.5 * thetaA)).toBeLessThan(1e-9);
    const expected = (10000 / 60) * 2 * PI;
    expect(Math.abs(thetaA - expected) / expected).toBeLessThan(1e-9);
  });

  it('構成の変化: prev = { A: 1.0, B: 5.0 }、dt = 0 → B は A に合わせて付き直る', () => {
    const m = step(drivenPair(), motion({ [A]: 1.0, [B]: 5.0 }), 0);
    expect(m.angles[A]).toBeCloseTo(1.0, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-0.5, DIGITS);
  });

  it('新しいシャフト: prev に A だけ → B = −0.5。シーンから消えたシャフトは含まない', () => {
    const m = step(drivenPair(), motion({ [A]: 1.0, shaft_gone: 3 }), 0);
    expect(m.angles[A]).toBeCloseTo(1.0, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-0.5, DIGITS);
    expect(Object.keys(m.angles).sort()).toEqual([A, B]);
    expect(Object.keys(m.omegas).sort()).toEqual([A, B]);
  });

  it('新しく生やした基準シャフトは 0 から始める', () => {
    const scene = makeScene([A, C], [['gear_a', A, 12]], [], [A, C]);
    const m = stepMotion(scene, layoutOf([]), motion({ [A]: 1.0 }), 0);
    expect(m.angles[C]).toBe(0);
  });

  it('基準シャフトの優先: B だけが root、prev = { A: 1.0, B: 0.2 }', () => {
    const s = pair(24, [['motor_a', A, 'S', 60, 1]], [B]);
    const m = step(s, motion({ [A]: 1.0, [B]: 0.2 }), 0);
    expect(m.angles[B]).toBeCloseTo(0.2, DIGITS);
    expect(m.angles[A]).toBeCloseTo(-0.4, DIGITS);
  });

  it('ロック中の角度: stalemate の成分は dt = 1 進めても変わらない', () => {
    const m = step(stalematePair(), motion({ [A]: 0.3, [B]: -0.3 }), 1);
    expect(m.angles[A]).toBeCloseTo(0.3, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-0.3, DIGITS);
  });

  it('自由度 0 の成分の角度は前の値のまま（無ければ 0）', () => {
    const s = triangle([['motor_a', A, 'S', 60, 1]]);
    const m = step(s, motion({ [A]: 0.7, [B]: 0.1 }), 1);
    expect(m.angles).toEqual({ [A]: 0.7, [B]: 0.1, [C]: 0 });
  });

  it('角度は 2π で折り返さない', () => {
    const m = step(drivenPair(), initialMotionState(), 2);
    expect(m.angles[A]).toBeCloseTo(4 * PI, DIGITS);
  });
});

describe('stepMotion: 一時停止', () => {
  it('paused: 角度が変わらない、ω は 0、locks = []', () => {
    const m = step(drivenPair(), motion({ [A]: 1.0, [B]: -0.5 }), 1, { paused: true });
    expect(m.angles[A]).toBeCloseTo(1.0, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-0.5, DIGITS);
    expect(m.omegas).toEqual({ [A]: 0, [B]: 0 });
    expect(m.locks).toEqual([]);
  });

  it('シーンは変えない', () => {
    const s = drivenPair();
    const before = JSON.stringify(s.scene);
    step(s, initialMotionState(), 1, { paused: true, hand: { shaftId: B, angle: 1 } });
    expect(JSON.stringify(s.scene)).toBe(before);
  });

  it('paused: false に戻すと、つり合いの解に戻る（S1-22）', () => {
    const s = drivenPair();
    const running = step(s, initialMotionState(), 0);
    const paused = step(s, running, 0.5, { paused: true });
    expect(Object.values(paused.omegas).every((w) => w === 0)).toBe(true);
    const resumed = step(s, paused, 0, { paused: false });
    expect(resumed.omegas[A]).toBeCloseTo(running.omegas[A] ?? Number.NaN, DIGITS);
    expect(resumed.omegas[B]).toBeCloseTo(running.omegas[B] ?? Number.NaN, DIGITS);
    expect(Math.abs(resumed.omegas[A] ?? 0)).toBeGreaterThan(0);
  });
});

describe('stepMotion: 手で回す', () => {
  it('モーター無しの A(12)–B(24) の B を 1.0 へ（dt = 0.1）', () => {
    const m = step(pair(24, []), motion({ [A]: 0, [B]: 0 }), 0.1, {
      hand: { shaftId: B, angle: 1.0 },
    });
    expect(m.angles[A]).toBeCloseTo(-2.0, DIGITS);
    expect(m.angles[B]).toBeCloseTo(1.0, DIGITS);
    expect(m.omegas[A]).toBeCloseTo(-20, DIGITS);
    expect(m.omegas[B]).toBeCloseTo(10, DIGITS);
  });

  it('dt = 0 なら ω は 0', () => {
    const m = step(pair(24, []), initialMotionState(), 0, { hand: { shaftId: B, angle: 1.0 } });
    expect(m.angles[B]).toBeCloseTo(1.0, DIGITS);
    expect(m.omegas).toEqual({ [A]: 0, [B]: 0 });
  });

  it('手はモーターに勝つ: B を 0 に保つ', () => {
    const s = drivenPair();
    let m = initialMotionState();
    for (let i = 0; i < 3; i++) m = step(s, m, 0.1, { hand: { shaftId: B, angle: 0 } });
    expect(m.angles[A]).toBeCloseTo(0, DIGITS);
    expect(m.angles[B]).toBeCloseTo(0, DIGITS);
    expect(m.omegas[A]).toBeCloseTo(0, DIGITS);
    expect(m.omegas[B]).toBeCloseTo(0, DIGITS);
    expect(m.locks).toEqual([]);
    expect(m.backDriven).toEqual([]);
  });

  it('手で逆に回す → 手を離すとつり合いの速度に戻る', () => {
    const s = drivenPair();
    let m = initialMotionState();
    for (const angle of [0, 0.1, 0.2]) m = step(s, m, 0.1, { hand: { shaftId: B, angle } });
    expect(m.omegas[A]).toBeCloseTo(-2, DIGITS);
    expect(m.backDriven).toEqual(['motor_a']);
    expect(m.angles[A]).toBeCloseTo(-0.4, DIGITS);

    const released = step(s, m, 0.1);
    expect(released.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
    expect(released.angles[A]).toBeCloseTo(-0.4 + 0.2 * PI, DIGITS);
    expect(released.backDriven).toEqual([]);
  });

  it('ロック中の成分を手で回す → ロックが外れ、手の角度に追従する', () => {
    const s = stalematePair();
    const locked = step(s, initialMotionState(), 0.1);
    expect(locked.locks).toHaveLength(1);
    const m = step(s, locked, 0.1, { hand: { shaftId: A, angle: 0.5 } });
    expect(m.locks).toEqual([]);
    expect(m.angles[A]).toBeCloseTo(0.5, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-0.5, DIGITS);
    expect(m.omegas[A]).toBeCloseTo(5, DIGITS);
    // B のモーター（direction 1）は ω_B = −5 で逆に回されている。A のモーターは向きのとおり
    expect(m.backDriven).toEqual(['motor_b']);
  });

  it('矛盾: 12 歯の三角形（モーター無し）の A を 1.0 へ → 角度は前のまま、contradiction', () => {
    const prev = motion({ [A]: 0.2, [B]: 0.3, [C]: 0.4 });
    const m = step(triangle([]), prev, 0.1, { hand: { shaftId: A, angle: 1.0 } });
    expect(m.angles).toEqual({ [A]: 0.2, [B]: 0.3, [C]: 0.4 });
    expect(m.omegas).toEqual({ [A]: 0, [B]: 0, [C]: 0 });
    expect(m.locks.map((l) => l.reason)).toEqual(['contradiction']);
    expect(m.locks[0]?.shaftIds).toEqual([A, B, C]);
  });

  it('一時停止中でも手が効く', () => {
    const m = step(drivenPair(), initialMotionState(), 0.1, {
      paused: true,
      hand: { shaftId: B, angle: 1.0 },
    });
    expect(m.angles[B]).toBeCloseTo(1.0, DIGITS);
    expect(m.angles[A]).toBeCloseTo(-2.0, DIGITS);
    expect(m.omegas[B]).toBeCloseTo(10, DIGITS);
  });

  it('手は他の成分に影響しない', () => {
    const scene = makeScene(
      [A, B, C],
      [
        ['gear_a', A, 12],
        ['gear_b', B, 24],
      ],
      [['motor_c', C, 'S', 60, 1]],
      [A, C],
    );
    const layout = layoutOf([tree('gear_a', 'gear_b')]);
    const m = stepMotion(scene, layout, initialMotionState(), 0.5, {
      hand: { shaftId: B, angle: 1 },
    });
    expect(m.angles[C]).toBeCloseTo(PI, DIGITS);
    expect(m.omegas[C]).toBeCloseTo(2 * PI, DIGITS);
  });

  it('シーンに無いシャフトをつかんでいたら、手は無いものとして扱う', () => {
    const s = drivenPair();
    const m = step(s, initialMotionState(), 0.5, { hand: { shaftId: 'shaft_gone', angle: 1 } });
    expect(m).toEqual(step(s, initialMotionState(), 0.5));
  });
});

describe('solveMotion', () => {
  it('dt = 0 の stepMotion と同じ結果', () => {
    const cases: Array<{ s: Setup; opts?: MotionOptions }> = [
      { s: drivenPair() },
      { s: stalematePair() },
      { s: triangle([['motor_a', A, 'S', 60, 1]]) },
      { s: drivenPair(), opts: { paused: true } },
      { s: drivenPair(), opts: { hand: { shaftId: B, angle: 0.3 } } },
    ];
    const prev = motion({ [A]: 1.0, [B]: 5.0 });
    for (const { s, opts } of cases) {
      expect(solveMotion(s.scene, s.layout, prev, opts)).toEqual(
        stepMotion(s.scene, s.layout, prev, 0, opts),
      );
    }
  });

  it('同じ Layout でもシーンが変わればグラフを作り直す', () => {
    const s = drivenPair();
    expect(solveMotion(s.scene, s.layout, initialMotionState()).omegas[A]).toBeCloseTo(
      2 * PI,
      DIGITS,
    );
    const moved = pair(24, [['motor_b', B, 'S', 60, 1]]).scene;
    const m = solveMotion(moved, s.layout, initialMotionState());
    expect(m.omegas[B]).toBeCloseTo(2 * PI, DIGITS);
    expect(m.omegas[A]).toBeCloseTo(-4 * PI, DIGITS);
  });
});

// S1-21 の資料のテストケース（手で回す）
describe('stepMotion: 手で回す（S1-21）', () => {
  // A(20)–B(40)。モーターは引数で
  const pair2040 = (motors: readonly MotorSpec[] = []): Setup => ({
    scene: makeScene(
      [A, B],
      [
        ['gear_a', A, 20],
        ['gear_b', B, 40],
      ],
      motors,
    ),
    layout: layoutOf([tree('gear_a', 'gear_b')]),
  });

  it('20 歯側を目標 +π/2 → 20 歯側 π/2、40 歯側 −π/4。ω は角度の変化 / dt', () => {
    const dt = 0.05;
    const m = step(pair2040(), motion({ [A]: 0, [B]: 0 }), dt, {
      hand: { shaftId: A, angle: PI / 2 },
    });
    expect(m.angles[A]).toBeCloseTo(PI / 2, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-PI / 4, DIGITS);
    expect(m.omegas[A]).toBeCloseTo(PI / 2 / dt, DIGITS);
    expect(m.omegas[B]).toBeCloseTo(-PI / 4 / dt, DIGITS);
  });

  it('目標を 10 ステップで 0 → π → 各ステップで、つかんだシャフトの角度が目標に一致する', () => {
    const s = pair2040();
    let m = initialMotionState();
    for (let i = 1; i <= 10; i++) {
      const target = (PI * i) / 10;
      m = step(s, m, 1 / 60, { hand: { shaftId: A, angle: target } });
      expect(m.angles[A]).toBeCloseTo(target, DIGITS);
      expect(m.angles[B]).toBeCloseTo(-target / 2, DIGITS);
    }
  });

  it('モーター付き（direction 1）のシャフトを負の向きに回すと backDriven、正なら入らない', () => {
    const s = pair2040([['motor_a', A, 'S', 60, 1]]);
    const neg = step(s, motion({ [A]: 0, [B]: 0 }), 0.1, { hand: { shaftId: A, angle: -0.3 } });
    expect(neg.backDriven).toEqual(['motor_a']);
    const pos = step(s, motion({ [A]: 0, [B]: 0 }), 0.1, { hand: { shaftId: A, angle: 0.3 } });
    expect(pos.backDriven).toEqual([]);
  });

  it('別の連結成分のモーターは、手の有無で ω が変わらない', () => {
    const scene = makeScene(
      [A, B, C],
      [
        ['gear_a', A, 20],
        ['gear_b', B, 40],
        ['gear_c', C, 20],
      ],
      [['motor_c', C, 'S', 60, 1]],
      [A, C],
    );
    const layout = layoutOf([tree('gear_a', 'gear_b')]);
    const prev = motion({ [A]: 0, [B]: 0, [C]: 0 });
    const without = stepMotion(scene, layout, prev, 0.1);
    const withHand = stepMotion(scene, layout, prev, 0.1, { hand: { shaftId: A, angle: 1 } });
    expect(withHand.omegas[C]).toBeCloseTo(without.omegas[C] as number, DIGITS);
    expect(withHand.angles[C]).toBeCloseTo(without.angles[C] as number, DIGITS);
  });

  it('手を外した次のステップ → ω は無負荷回転数、角度は手を外す直前から続く', () => {
    const s = pair2040([['motor_a', A, 'S', 60, 1]]);
    let m = initialMotionState();
    for (const angle of [0, -0.2, -0.4]) m = step(s, m, 0.1, { hand: { shaftId: A, angle } });
    const released = step(s, m, 0.1);
    expect(released.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
    expect(released.omegas[B]).toBeCloseTo(-PI, DIGITS);
    expect(released.angles[A]).toBeCloseTo(-0.4 + 0.2 * PI, DIGITS);
    expect(released.angles[B]).toBeCloseTo(0.2 - 0.1 * PI, DIGITS);
    expect(released.backDriven).toEqual([]);
  });

  it('stalemate のシーン → 手で回すと角度が変わり locks が空。手を外すと stalemate が戻る', () => {
    const s = stalematePair();
    const locked = step(s, initialMotionState(), 0.1);
    expect(locked.locks.map((l) => l.reason)).toEqual(['stalemate']);
    const held = step(s, locked, 0.1, { hand: { shaftId: A, angle: 0.7 } });
    expect(held.angles[A]).toBeCloseTo(0.7, DIGITS);
    expect(held.locks).toEqual([]);
    const released = step(s, held, 0.1);
    expect(released.locks.map((l) => l.reason)).toEqual(['stalemate']);
    expect(released.angles[A]).toBeCloseTo(0.7, DIGITS);
    expect(released.omegas).toEqual({ [A]: 0, [B]: 0 });
  });

  it('三角形のロック（A にモーター）→ 手の目標を変えても角度は変わらず contradiction が残る', () => {
    const s = triangle([['motor_a', A, 'S', 60, 1]]);
    let m = step(s, initialMotionState(), 0.1);
    expect(m.locks.map((l) => l.reason)).toEqual(['contradiction']);
    for (const angle of [0.3, 0.6, 0.9]) {
      m = step(s, m, 0.1, { hand: { shaftId: A, angle } });
      expect(m.angles).toEqual({ [A]: 0, [B]: 0, [C]: 0 });
      expect(m.locks.map((l) => l.reason)).toEqual(['contradiction']);
      expect(m.locks[0]?.shaftIds).toEqual([A, B, C]);
    }
  });

  it('一時停止（paused: true）でも手の拘束が効く', () => {
    const s = pair2040([['motor_a', A, 'S', 60, 1]]);
    const m = step(s, motion({ [A]: 0, [B]: 0 }), 0.1, {
      paused: true,
      hand: { shaftId: A, angle: PI / 2 },
    });
    expect(m.angles[A]).toBeCloseTo(PI / 2, DIGITS);
    expect(m.angles[B]).toBeCloseTo(-PI / 4, DIGITS);
  });
});
