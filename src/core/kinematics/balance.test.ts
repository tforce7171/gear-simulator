import { describe, expect, it } from 'vitest';
import type { Mesh } from '../layout/types';
import type { Gear, Motor, Scene, Shaft, ShaftId, SizeKey } from '../scene/types';
import { type ShaftDrive, solveBalance, solveVelocities } from './balance';
import { buildMeshGraph } from './graph';

// テストのシーン。歯車はすべて大きさ S。先頭のシャフトだけを root、他は mesh にする
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

function makeScene(
  shaftIds: readonly ShaftId[],
  gears: readonly GearSpec[],
  motors: readonly MotorSpec[],
): Scene {
  const shafts: Record<string, Shaft> = {};
  shaftIds.forEach((id, i) => {
    shafts[id] =
      i === 0
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
  });
  const gearMap: Record<string, Gear> = {};
  for (const [id, shaftId, teeth] of gears) {
    gearMap[id] = { id, kind: 'spur', shaftId, size: 'S', teeth, offset: 0 };
  }
  const motorMap: Record<string, Motor> = {};
  for (const [id, shaftId, size, rpm, direction, on = true] of motors) {
    motorMap[id] = { id, shaftId, size, rpm, direction, on };
  }
  return { shafts, gears: gearMap, motors: motorMap, anchors: {} };
}

function tree(a: string, b: string): Mesh {
  return { a, b, source: 'tree', kind: 'spur' };
}

function solve(scene: Scene, meshes: readonly Mesh[], paused?: boolean) {
  const graph = buildMeshGraph(scene, meshes);
  return solveVelocities(scene, graph, paused === undefined ? undefined : { paused });
}

const A = 'shaft_a';
const B = 'shaft_b';
const C = 'shaft_c';
const D = 'shaft_d';
const E = 'shaft_e';
const PI = Math.PI;
const DIGITS = 10;

// A(12)–B(teethB)
function pair(teethB: number, motors: readonly MotorSpec[]): { scene: Scene; meshes: Mesh[] } {
  return {
    scene: makeScene(
      [A, B],
      [
        ['gear_a', A, 12],
        ['gear_b', B, teethB],
      ],
      motors,
    ),
    meshes: [tree('gear_a', 'gear_b')],
  };
}

describe('solveVelocities', () => {
  it('単独: S 60rpm → 無負荷回転数、トルク 0', () => {
    const scene = makeScene([A], [], [['motor_a', A, 'S', 60, 1]]);
    const r = solve(scene, []);
    expect(r.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
    expect(r.motorTorques.motor_a).toBeCloseTo(0, DIGITS);
  });

  it('歯数比: A(12)–B(24)、A に S 60rpm', () => {
    const { scene, meshes } = pair(24, [['motor_a', A, 'S', 60, 1]]);
    const r = solve(scene, meshes);
    expect(r.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
    expect(r.omegas[B]).toBeCloseTo(-PI, DIGITS);
  });

  it('逆向き・強いほうが勝つ: A に S、B に M（どちらも 60rpm、direction 1）', () => {
    const { scene, meshes } = pair(12, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'M', 60, 1],
    ]);
    const r = solve(scene, meshes);
    const wA = r.omegas[A] as number;
    const wB = r.omegas[B] as number;
    expect(wA).toBeCloseTo(-PI, DIGITS);
    expect(wB).toBeCloseTo(PI, DIGITS);
    expect(Math.abs(wB)).toBeLessThan(2 * PI); // M の単独（60rpm）より遅い
    expect(wA * 1).toBeLessThan(0); // S は向きと逆に回されている
    expect(r.motorTorques.motor_a).toBeCloseTo(1.5, DIGITS);
    expect(r.motorTorques.motor_b).toBeCloseTo(1.5, DIGITS);
  });

  it('motorTorques は ON のモーターだけ', () => {
    const { scene, meshes } = pair(12, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'M', 60, 1],
    ]);
    const r = solve(scene, meshes);
    expect(Object.keys(r.motorTorques).sort()).toEqual(['motor_a', 'motor_b']);
    expect(r.motorTorques.motor_a).toBeCloseTo(1.5, DIGITS);
    expect(r.motorTorques.motor_b).toBeCloseTo(1.5, DIGITS);

    const off = pair(12, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'M', 60, 1, false],
    ]);
    expect(Object.keys(solve(off.scene, off.meshes).motorTorques)).toEqual(['motor_a']);
  });

  it('同じ向き・速度違い: A に S 60rpm d1、B に S 30rpm d−1 → 40rpm', () => {
    const { scene, meshes } = pair(12, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'S', 30, -1],
    ]);
    const r = solve(scene, meshes);
    expect(r.omegas[A]).toBeCloseTo((4 * PI) / 3, DIGITS);
    expect(r.omegas[B]).toBeCloseTo((-4 * PI) / 3, DIGITS);
    expect(r.omegas[A]).toBeGreaterThan(PI);
    expect(r.omegas[A]).toBeLessThan(2 * PI);
  });

  it('直結なら大きいモーターが勝つ: A に S 60rpm、B に L 15rpm', () => {
    const { scene, meshes } = pair(12, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'L', 15, 1],
    ]);
    const r = solve(scene, meshes);
    expect(r.omegas[A]).toBeCloseTo((-18 * PI) / 41, DIGITS);
    expect(r.omegas[B]).toBeGreaterThan(0);
  });

  it('ギア比はてこ: A(12)–B(60)、B(12)–C(60)、A に S 60rpm、C に L 15rpm d−1', () => {
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
    const meshes = [tree('gear_a', 'gear_b1'), tree('gear_b2', 'gear_c')];
    const r = solve(scene, meshes);
    expect(r.omegas[A]).toBeCloseTo((150 * PI) / 133, DIGITS);
    expect(r.omegas[B]).toBeCloseTo((-30 * PI) / 133, DIGITS);
    expect(r.omegas[C]).toBeCloseTo((6 * PI) / 133, DIGITS);
    expect((r.omegas[C] as number) / (r.omegas[A] as number)).toBeCloseTo(1 / 25, DIGITS);
    expect((r.omegas[C] as number) * -1).toBeLessThan(0); // L は向きと逆に回されている
  });

  it('速度 0 でのつり合い: 両方に S direction 1 → 0（120rpm にしても 0）', () => {
    for (const rpmB of [60, 120]) {
      const { scene, meshes } = pair(12, [
        ['motor_a', A, 'S', 60, 1],
        ['motor_b', B, 'S', rpmB, 1],
      ]);
      const r = solve(scene, meshes);
      expect(r.omegas[A]).toBeCloseTo(0, DIGITS);
      expect(r.omegas[B]).toBeCloseTo(0, DIGITS);
    }
  });

  it('歯数比での相殺: A(12)–B(36)、A に S、B に M → 0', () => {
    const { scene, meshes } = pair(36, [
      ['motor_a', A, 'S', 60, 1],
      ['motor_b', B, 'M', 30, 1],
    ]);
    const r = solve(scene, meshes);
    expect(r.omegas[A]).toBeCloseTo(0, DIGITS);
    expect(r.omegas[B]).toBeCloseTo(0, DIGITS);
  });

  it('OFF は無いのと同じ', () => {
    const off = pair(24, [['motor_a', A, 'S', 60, 1, false]]);
    const r1 = solve(off.scene, off.meshes);
    expect(r1.omegas[A]).toBe(0);
    expect(r1.omegas[B]).toBe(0);
    expect(r1.motorTorques).toEqual({});

    const withB = pair(24, [
      ['motor_a', A, 'S', 60, 1, false],
      ['motor_b', B, 'S', 60, 1],
    ]);
    const r2 = solve(withB.scene, withB.meshes);
    expect(r2.omegas[B]).toBeCloseTo(2 * PI, DIGITS);
    expect(r2.omegas[A]).toBeCloseTo(-4 * PI, DIGITS);
  });

  it('一時停止: 全て 0。シーンのモーターは on のまま', () => {
    const { scene, meshes } = pair(24, [['motor_a', A, 'S', 60, 1]]);
    const r = solve(scene, meshes, true);
    expect(r.omegas[A]).toBe(0);
    expect(r.omegas[B]).toBe(0);
    expect(scene.motors.motor_a?.on).toBe(true);
  });

  const twoComponents = (withE: boolean) => {
    const scene = makeScene(
      withE ? [A, B, C, D, E] : [A, B, C, D],
      [
        ['gear_a', A, 12],
        ['gear_b', B, 24],
        ['gear_c', C, 12],
        ['gear_d', D, 12],
      ],
      withE
        ? [
            ['motor_a', A, 'S', 60, 1],
            ['motor_e', E, 'M', 30, -1],
          ]
        : [['motor_a', A, 'S', 60, 1]],
    );
    return solve(scene, [tree('gear_a', 'gear_b'), tree('gear_c', 'gear_d')]);
  };

  it('駆動されていない成分は止まる', () => {
    const r = twoComponents(false);
    expect(r.omegas[C]).toBe(0);
    expect(r.omegas[D]).toBe(0);
    expect(r.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
    expect(r.omegas[B]).toBeCloseTo(-PI, DIGITS);
    expect(r.componentQ).toHaveLength(2);
  });

  it('複数の成分を一度に: 単独のシャフト E に M 30rpm d−1', () => {
    const r = twoComponents(true);
    expect(r.omegas[E]).toBeCloseTo(-PI, DIGITS);
    expect(r.omegas[A]).toBeCloseTo(2 * PI, DIGITS);
    expect(r.omegas[B]).toBeCloseTo(-PI, DIGITS);
    expect(r.omegas[C]).toBe(0);
    expect(r.omegas[D]).toBe(0);
    expect(r.componentQ).toHaveLength(3);
  });

  it('回転条件の矛盾: 12 歯の三角形 → 全て 0', () => {
    const scene = makeScene(
      [A, B, C],
      [
        ['gear_a', A, 12],
        ['gear_b', B, 12],
        ['gear_c', C, 12],
      ],
      [['motor_a', A, 'S', 60, 1]],
    );
    const r = solve(scene, [
      tree('gear_a', 'gear_b'),
      tree('gear_b', 'gear_c'),
      { a: 'gear_a', b: 'gear_c', source: 'contact', kind: 'spur' },
    ]);
    expect(r.omegas).toEqual({ [A]: 0, [B]: 0, [C]: 0 });
    expect(r.componentQ).toEqual([[]]);
    expect(r.motorTorques.motor_a).toBeCloseTo(1, DIGITS);
  });
});

describe('solveBalance（自由度 2 の基底）', () => {
  const basis = [
    [1, 0],
    [0, 1],
    [0.5, 0.5],
  ];
  const other = [
    [1, 1],
    [0, 1],
    [0.5, 1],
  ];
  const drive: ShaftDrive = { damping: 1 / (2 * PI), bias: 1 };
  const none: ShaftDrive = { damping: 0, bias: 0 };

  function expectClose(actual: readonly number[], expected: readonly number[]): void {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((v, i) => {
      expect(actual[i]).toBeCloseTo(v, DIGITS);
    });
  }

  it('シャフト 0 と 1 を逆向きに駆動', () => {
    const r = solveBalance(basis, [drive, { damping: 1 / (2 * PI), bias: -1 }, none]);
    expectClose(r.omegas, [2 * PI, -2 * PI, 0]);
  });

  it('シャフト 0 だけ: ω の二乗和が最小（q の最小ノルムではない）', () => {
    const r = solveBalance(basis, [drive, none, none]);
    expectClose(r.q, [2 * PI, -0.4 * PI]);
    expectClose(r.omegas, [2 * PI, -0.4 * PI, 0.8 * PI]);
  });

  it('シャフト 2 だけ', () => {
    const r = solveBalance(basis, [none, none, drive]);
    expectClose(r.q, [2 * PI, 2 * PI]);
    expectClose(r.omegas, [2 * PI, 2 * PI, 2 * PI]);
  });

  it('別の基底でも ω は変わらない', () => {
    expectClose(solveBalance(other, [drive, none, none]).omegas, [2 * PI, -0.4 * PI, 0.8 * PI]);
    expectClose(solveBalance(other, [none, none, drive]).omegas, [2 * PI, 2 * PI, 2 * PI]);
  });

  it('全て 0', () => {
    const r = solveBalance(basis, [none, none, none]);
    expect(r.omegas).toEqual([0, 0, 0]);
  });
});
