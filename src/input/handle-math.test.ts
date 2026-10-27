import { describe, expect, it } from 'vitest';
import { applyCommand, type Command } from '../core/edit/commands';
import { resolveLayout } from '../core/layout/resolve';
import { radialDirection } from '../core/math/axis';
import type { Vec3 } from '../core/math/vec3';
import { createSequentialIdGenerator } from '../core/scene/ids';
import { emptyScene } from '../core/scene/scene';
import type { Axis, Scene } from '../core/scene/types';
import {
  ARC_MESH_SNAP,
  angleAroundAxis,
  axialOffsetFromDrag,
  closestParamOnLine,
  crossedSnapAngles,
  meshSnapAngles,
  nearestSnapAngle,
  snapAngle,
  unwrapDelta,
} from './handle-math';

const PI = Math.PI;

function build(commands: Command[]): Scene {
  const ctx = { ids: createSequentialIdGenerator() };
  let scene = emptyScene();
  for (const command of commands) {
    const result = applyCommand(scene, command, ctx);
    if (!result.ok) throw new Error(result.error.message);
    scene = result.scene;
  }
  return scene;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

describe('angleAroundAxis', () => {
  it('S1-09 の定義で角度 0 の向きの点 → 0、正の向きに 90° 回した点 → π/2', () => {
    const center: Vec3 = [3, 4, 5];
    for (const axis of ['x', 'y', 'z'] as const) {
      const at = (angle: number): Vec3 => {
        const d = radialDirection(axis, angle);
        return [center[0] + 10 * d[0], center[1] + 10 * d[1], center[2] + 10 * d[2]];
      };
      expect(angleAroundAxis(at(0), center, axis)).toBeCloseTo(0, 12);
      expect(angleAroundAxis(at(PI / 2), center, axis)).toBeCloseTo(PI / 2, 12);
    }
  });

  it('軸 x・y・z のそれぞれで、angle: θ として置いた子の中心を渡すと θ が返る（resolveLayout との往復）', () => {
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      for (const theta of [0.3, 1.9, 4.4]) {
        const scene = build([
          { type: 'addRootShaft', axis, origin: [5, 40, -7], gear: { size: 'M', teeth: 20 } },
          { type: 'growGear', mode: 'perimeter', parentGearId: 'gear_1', angle: theta, teeth: 24 },
        ]);
        const layout = resolveLayout(scene);
        const parent = layout.gears.gear_1;
        const child = layout.gears.gear_2;
        if (parent === undefined || child === undefined) throw new Error('置けていない');
        expect(angleAroundAxis(child.center, parent.center, axis)).toBeCloseTo(theta, 9);
      }
    }
  });
});

describe('unwrapDelta', () => {
  it('2π の折り返しをまたぐ変化を −π〜π に巻き戻す', () => {
    const forward = unwrapDelta(3.0, -3.0);
    expect(forward).toBeCloseTo(2 * PI - 6, 12);
    expect(forward).toBeGreaterThan(0);
    const backward = unwrapDelta(-3.0, 3.0);
    expect(backward).toBeLessThan(0);
    expect(backward).toBeCloseTo(-(2 * PI - 6), 12);
    expect(unwrapDelta(0.1, 0.3)).toBeCloseTo(0.2, 12);
  });
});

describe('snapAngle', () => {
  it('snapAngle(0.27, π/12) → π/12', () => {
    expect(snapAngle(0.27, PI / 12)).toBeCloseTo(PI / 12, 12);
  });
});

describe('closestParamOnLine', () => {
  it('直線が y 軸、レイが [10, 5, 0] から [-1, 0, 0] の向き → 5', () => {
    expect(closestParamOnLine([10, 5, 0], [-1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(5, 12);
  });

  it('直線と平行なレイ → null', () => {
    expect(closestParamOnLine([10, 5, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0])).toBeNull();
  });
});

describe('axialOffsetFromDrag', () => {
  it('移動量を 4 mm の単位に丸めて足す（歯車の大きさによらない）', () => {
    expect(axialOffsetFromDrag(8, 5.9)).toBe(12);
    expect(axialOffsetFromDrag(8, 6.1)).toBe(16);
    expect(axialOffsetFromDrag(8, -1.9)).toBe(8);
    expect(axialOffsetFromDrag(8, -2.1)).toBe(4);
    expect(axialOffsetFromDrag(0, 4.1)).toBe(4);
  });
});

describe('meshSnapAngles（親の中心が原点、軸 y、半径 40、子のピッチ円半径 20）', () => {
  const snapsFor = (center: Vec3) =>
    meshSnapAngles([0, 0, 0], 'y', 40, 20, [{ center, pitchRadius: 20 }]);

  it('相手が [40, 0, 0]（+X、角度 π/2 の向き）→ π/6 と 5π/6', () => {
    const angles = snapsFor([40, 0, 0]);
    expect(angles).toHaveLength(2);
    expect(angles[0]).toBeCloseTo(PI / 6, 9);
    expect(angles[1]).toBeCloseTo((5 * PI) / 6, 9);
  });

  it('相手が [80, 0, 0] → π/2 の 1 つ（接する場合）', () => {
    const angles = snapsFor([80, 0, 0]);
    expect(angles).toHaveLength(1);
    expect(angles[0]).toBeCloseTo(PI / 2, 9);
  });

  it('相手が [100, 0, 0] → []（届かない）', () => {
    expect(snapsFor([100, 0, 0])).toEqual([]);
  });

  it('相手が [40, 12, 0]（軸方向にずれている）→ 面に射影して [40, 0, 0] と同じ', () => {
    const shifted = snapsFor([40, 12, 0]);
    const flat = snapsFor([40, 0, 0]);
    expect(shifted).toHaveLength(flat.length);
    shifted.forEach((a, i) => {
      expect(a).toBeCloseTo(flat[i] ?? Number.NaN, 12);
    });
  });

  it('相手の中心が親の軸上（[0, 8, 0]）→ []（吸着先を出さない）', () => {
    expect(snapsFor([0, 8, 0])).toEqual([]);
  });

  it('相手が複数なら、全部の角度を [0, 2π) の昇順で返す', () => {
    const angles = meshSnapAngles([0, 0, 0], 'y', 40, 20, [
      { center: [40, 0, 0], pitchRadius: 20 },
      { center: [-80, 0, 0], pitchRadius: 20 },
    ]);
    expect(angles).toEqual(sorted(angles));
    expect(angles).toHaveLength(3);
    expect(angles[2]).toBeCloseTo((3 * PI) / 2, 9);
  });
});

describe('nearestSnapAngle', () => {
  const range = (5 * PI) / 180;

  it('範囲 5° の中なら吸着の角度、外なら null', () => {
    expect(nearestSnapAngle(PI / 6 + 0.05, [PI / 6], range)).toBe(PI / 6);
    expect(nearestSnapAngle(PI / 6 + 0.1, [PI / 6], range)).toBeNull();
  });

  it('2π の折り返しを考える', () => {
    expect(nearestSnapAngle(2 * PI - 0.02, [0.01], range)).toBe(0.01);
  });

  it('2 つの候補があれば近いほう', () => {
    expect(nearestSnapAngle(1.0, [0.97, 1.02], range)).toBe(1.02);
    expect(nearestSnapAngle(1.0, [0.99, 1.02], range)).toBe(0.99);
  });

  it('ARC_MESH_SNAP は 5°', () => {
    expect(ARC_MESH_SNAP).toBeCloseTo(range, 12);
  });
});

describe('crossedSnapAngles', () => {
  it('間で通り過ぎた吸着の角度を、通った順に連続値で返す（両端は除く）', () => {
    expect(crossedSnapAngles(0, 1, [0.5])).toEqual([0.5]);
    expect(crossedSnapAngles(1, 0, [0.2, 0.5])).toEqual([0.5, 0.2]);
    expect(crossedSnapAngles(0, 0.5, [0.5])).toEqual([]);
    const wrapped = crossedSnapAngles(-0.2, 0.2, [2 * PI - 0.1]);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]).toBeCloseTo(-0.1, 12);
  });
});
