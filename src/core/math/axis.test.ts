import { describe, expect, it } from 'vitest';
import type { Axis } from '../scene/types';
import { axisFrame, axisVector, radialDirection } from './axis';
import { cross, type Vec3 } from './vec3';

function expectVecClose(actual: Vec3, expected: Vec3): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i] as number, 12);
}

describe('axisFrame', () => {
  for (const axis of ['x', 'y', 'z'] as const satisfies readonly Axis[]) {
    it(`'${axis}': cross(u, v) が w に一致し、w が axisVector`, () => {
      const { u, v, w } = axisFrame(axis);
      expectVecClose(cross(u, v), w);
      expect(axisVector(axis)).toEqual(w);
    });
  }

  it('基底の割り当て', () => {
    expect(axisFrame('x')).toEqual({ u: [0, 1, 0], v: [0, 0, 1], w: [1, 0, 0] });
    expect(axisFrame('y')).toEqual({ u: [0, 0, 1], v: [1, 0, 0], w: [0, 1, 0] });
    expect(axisFrame('z')).toEqual({ u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] });
  });
});

describe('radialDirection', () => {
  it('資料の値', () => {
    expectVecClose(radialDirection('y', 0), [0, 0, 1]);
    expectVecClose(radialDirection('y', Math.PI / 2), [1, 0, 0]);
    expectVecClose(radialDirection('x', 0), [0, 1, 0]);
    expectVecClose(radialDirection('z', Math.PI / 2), [0, 1, 0]);
  });
});
