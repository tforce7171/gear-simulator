import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../core/layout/resolve';
import type { Vec3 } from '../core/math/vec3';
import type { Scene } from '../core/scene/types';
import { grabTarget, startHandRotate } from './hand-rotate';
import type { DragInput, Ray } from './handle-drag';

const PI = Math.PI;

// 真上から（-Y の向きに）見下ろすレイ。軸 y の面上の点 [x, *, z] を通る
function downAt(x: number, z: number): Ray {
  return { origin: [x, 100, z], direction: [0, -1, 0] };
}

// 中心 c まわりの、軸 y の面上の角度 φ（+X から +Z の向き）の点の真上
function aroundY(c: Vec3, phi: number, r = 15): Ray {
  return downAt(c[0] + r * Math.cos(phi), c[2] + r * Math.sin(phi));
}

const NO_SCREEN: DragInput = {};

describe('startHandRotate', () => {
  const center: Vec3 = [0, 10, 0];

  it('+X から +Z へ 90° 動かすと、目標は押したときの角度 − π/2（+Y 軸まわりの負の向き）', () => {
    const s = startHandRotate({
      shaftId: 's',
      center,
      axis: 'y',
      startAngle: 1.0,
      startRay: aroundY(center, 0),
      startInput: NO_SCREEN,
    });
    expect(s.target()).toBeCloseTo(1.0, 10);
    for (let i = 1; i <= 10; i++) s.update(aroundY(center, (PI / 2) * (i / 10)), NO_SCREEN);
    expect(s.target()).toBeCloseTo(1.0 - PI / 2, 10);
  });

  it('1 周以上回すと、変化量を積算して 2π で折り返さない', () => {
    const s = startHandRotate({
      shaftId: 's',
      center,
      axis: 'y',
      startAngle: 0,
      startRay: aroundY(center, 0),
      startInput: NO_SCREEN,
    });
    for (let i = 1; i <= 30; i++) s.update(aroundY(center, (3 * PI * i) / 30), NO_SCREEN);
    expect(s.target()).toBeCloseTo(-3 * PI, 10);
  });

  it('回す基準は押した位置。最初の update がしきい値を越えた位置でも飛ばない', () => {
    const s = startHandRotate({
      shaftId: 's',
      center,
      axis: 'y',
      startAngle: 0.5,
      startRay: aroundY(center, 0.2),
      startInput: NO_SCREEN,
    });
    s.update(aroundY(center, 0.3), NO_SCREEN);
    expect(s.target()).toBeCloseTo(0.5 - 0.1, 10);
  });

  it('面を真横から見ているときは、中心を画面に写した点のまわりの画面上の角度で代用する', () => {
    // 軸 z をカメラから見て真横（レイは -Y の向き）。画面: 中心 (100, 100)、y は下向き
    const project = (): { x: number; y: number } => ({ x: 100, y: 100 });
    const screen = (x: number, y: number): DragInput => ({
      screen: { pointer: { x, y }, project },
    });
    const ray: Ray = { origin: [0, 100, 0], direction: [0, -1, 0] };
    const s = startHandRotate({
      shaftId: 's',
      center: [0, 0, 0],
      axis: 'z',
      startAngle: 0,
      startRay: ray,
      startInput: screen(110, 100),
    });
    // 画面の右 → 上（反時計回り）。レイの向き·軸 = 0（遠ざからない）なので符号はそのまま
    s.update(ray, screen(100, 90));
    expect(s.target()).toBeCloseTo(PI / 2, 10);
  });

  it('求め方（面との交点 ↔ 画面上）が切り替わった間の変化は数えない', () => {
    const project = (): { x: number; y: number } => ({ x: 0, y: 0 });
    const input: DragInput = { screen: { pointer: { x: -50, y: 0 }, project } };
    const s = startHandRotate({
      shaftId: 's',
      center,
      axis: 'y',
      startAngle: 0,
      startRay: aroundY(center, 0),
      startInput: input,
    });
    // 軸に垂直なレイ（真横）→ 画面上の角度に切り替わる。変化は数えない
    s.update({ origin: [100, 10, 0], direction: [-1, 0, 0] }, input);
    expect(s.target()).toBeCloseTo(0, 10);
  });
});

describe('grabTarget', () => {
  // 縦軸の起点 A（原点 [0, 20, 0]、中・20 歯）の外周に B（angle 0）。A にモーター
  const scene: Scene = {
    shafts: {
      shaft_a: { id: 'shaft_a', placement: { kind: 'root', origin: [0, 20, 0], axis: 'y' } },
      shaft_b: {
        id: 'shaft_b',
        placement: { kind: 'mesh', parentGearId: 'gear_a', childGearId: 'gear_b', angle: 0 },
      },
    },
    gears: {
      gear_a: { id: 'gear_a', kind: 'spur', shaftId: 'shaft_a', size: 'M', teeth: 20, offset: 0 },
      gear_b: { id: 'gear_b', kind: 'spur', shaftId: 'shaft_b', size: 'M', teeth: 20, offset: 0 },
    },
    motors: {
      motor_a: { id: 'motor_a', shaftId: 'shaft_a', size: 'S', rpm: 60, direction: 1, on: true },
    },
    anchors: {},
  };
  const layout = resolveLayout(scene);

  it('歯車 → そのシャフト、中心は歯車の中心', () => {
    const t = grabTarget(scene, layout, { kind: 'gear', id: 'gear_b', point: [40, 22, 40] });
    expect(t).toEqual({
      shaftId: 'shaft_b',
      center: layout.gears.gear_b?.center,
      axis: 'y',
    });
  });

  it('シャフト・モーター → そのシャフト、中心は当たった点を軸に下ろした点', () => {
    const shaft = grabTarget(scene, layout, { kind: 'shaft', id: 'shaft_a', point: [1, 30, 0.5] });
    expect(shaft?.shaftId).toBe('shaft_a');
    expect(shaft?.center).toEqual([0, 30, 0]);
    const motor = grabTarget(scene, layout, { kind: 'motor', id: 'motor_a', point: [3, 5, 2] });
    expect(motor?.shaftId).toBe('shaft_a');
    expect(motor?.center).toEqual([0, 5, 0]);
  });

  it('ハンドル・候補・シーンに無い部品 → null', () => {
    expect(
      grabTarget(scene, layout, { kind: 'handle', id: 'move:shaft_a', point: [0, 0, 0] }),
    ).toBe(null);
    expect(grabTarget(scene, layout, { kind: 'candidate', id: '0', point: [0, 0, 0] })).toBe(null);
    expect(grabTarget(scene, layout, { kind: 'gear', id: 'gear_x', point: [0, 0, 0] })).toBe(null);
  });
});
