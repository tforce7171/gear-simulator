import { describe, expect, it } from 'vitest';
import { bevelBigEndOf, bevelContactPoint } from '../geometry/bevel';
import { resolveLayout } from '../layout/resolve';
import type { Mesh } from '../layout/types';
import { axisVector } from '../math/axis';
import { cross, dot, length, scale, sub, type Vec3 } from '../math/vec3';
import type { Axis, BevelGear, Gear, Scene } from '../scene/types';
import { validateScene } from '../scene/validate';
import { meshCoefficients } from './mesh-coefficients';

// かみ合い 1 組の拘束の係数（S2-02）

function bevelScene(parentAxis: Axis, apex: 1 | -1, axisStep: 1 | 2, side: 1 | -1): Scene {
  const a: BevelGear = {
    id: 'gear_a',
    kind: 'bevel',
    apex,
    shaftId: 'shaft_a',
    size: 'M',
    teeth: 20,
    offset: 0,
  };
  const b: BevelGear = { ...a, id: 'gear_b', shaftId: 'shaft_b', apex: side === 1 ? -1 : 1 };
  return {
    shafts: {
      shaft_a: {
        id: 'shaft_a',
        placement: { kind: 'root', origin: [3, 40, -7], axis: parentAxis },
      },
      shaft_b: {
        id: 'shaft_b',
        placement: { kind: 'bevel', parentGearId: 'gear_a', childGearId: 'gear_b', axisStep, side },
      },
    },
    gears: { gear_a: a, gear_b: b },
    motors: {},
    anchors: {},
  };
}

describe('meshCoefficients', () => {
  it('外歯車同士（平歯車・ハスバ歯車）は z_a, z_b', () => {
    const spur = (id: string, teeth: number): Gear => ({
      id,
      kind: 'spur',
      shaftId: `shaft_${id}`,
      size: 'M',
      teeth,
      offset: 0,
    });
    const scene: Scene = {
      shafts: {},
      gears: { gear_a: spur('gear_a', 20), gear_b: spur('gear_b', 40) },
      motors: {},
      anchors: {},
    };
    const mesh: Mesh = { a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'spur' };
    expect(meshCoefficients(mesh, scene)).toEqual({ a: 20, b: 40 });
    expect(meshCoefficients({ ...mesh, kind: 'helical' }, scene)).toEqual({ a: 20, b: 40 });
  });

  // 親の軸 3 通り × 親の apex 2 通り × axisStep 2 通り × side 2 通り
  const cases: Array<[Axis, 1 | -1, 1 | 2, 1 | -1]> = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const apex of [1, -1] as const) {
      for (const axisStep of [1, 2] as const) {
        for (const side of [1, -1] as const) cases.push([axis, apex, axisStep, side]);
      }
    }
  }

  it.each(cases)(
    "かさ歯車: 親の軸 '%s'、apex %d、axisStep %d、side %d で、係数から求めた子の ω がピッチ点の周速の一致から求めた ω と一致する",
    (axis, apex, axisStep, side) => {
      const scene = bevelScene(axis, apex, axisStep, side);
      expect(validateScene(scene)).toEqual({ ok: true });
      const layout = resolveLayout(scene);
      const la = layout.gears.gear_a;
      const lb = layout.gears.gear_b;
      const a = scene.gears.gear_a as BevelGear;
      const b = scene.gears.gear_b as BevelGear;
      if (la === undefined || lb === undefined) throw new Error('レイアウトが無い');
      const mesh = layout.meshes[0];
      expect(mesh).toEqual({ a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'bevel' });
      if (mesh === undefined) return;

      // ピッチ点 P での周速 ω·(e × (P − c)) が一致する ω_b を、テストの中で求める（ω_a = 1）
      const ca = bevelBigEndOf(la.center, la.axis, a);
      const cb = bevelBigEndOf(lb.center, lb.axis, b);
      const p = bevelContactPoint({ bigEnd: ca }, { axis: lb.axis, bigEnd: cb });
      // P は両方の大端のピッチ円の上にある
      expect(length(sub(p, ca))).toBeCloseTo(la.pitchRadius, 9);
      expect(length(sub(p, cb))).toBeCloseTo(lb.pitchRadius, 9);
      const va: Vec3 = cross(axisVector(la.axis), sub(p, ca));
      const tb: Vec3 = cross(axisVector(lb.axis), sub(p, cb));
      const omegaB = dot(va, tb) / dot(tb, tb);
      // 周速が完全に一致する（向きも含む）
      expect(length(sub(scale(tb, omegaB), va))).toBeCloseTo(0, 9);

      const c = meshCoefficients(mesh, scene);
      expect(-c.a / c.b).toBeCloseTo(omegaB, 9);
      expect(Math.abs(omegaB)).toBeCloseTo(1, 9);
    },
  );
});
