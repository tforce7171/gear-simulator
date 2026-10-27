import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/math/vec3';
import {
  anglesForView,
  distanceForOrthoHeight,
  nearestAngle,
  orthoHeightForDistance,
  poseForView,
  type ViewName,
  viewFromKey,
} from './views';

const VIEWS: readonly ViewName[] = ['front', 'back', 'right', 'left', 'top', 'bottom'];

function expectVec(actual: Vec3, expected: Vec3): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i] ?? Number.NaN, 9);
}

describe('viewFromKey', () => {
  it('テンキー 1/3/7 と Ctrl で反対側。テンキー以外は null', () => {
    expect(viewFromKey('Numpad1', false)).toBe('front');
    expect(viewFromKey('Numpad1', true)).toBe('back');
    expect(viewFromKey('Numpad3', false)).toBe('right');
    expect(viewFromKey('Numpad3', true)).toBe('left');
    expect(viewFromKey('Numpad7', false)).toBe('top');
    expect(viewFromKey('Numpad7', true)).toBe('bottom');
    expect(viewFromKey('Digit1', false)).toBeNull();
    expect(viewFromKey('Numpad5', false)).toBeNull();
  });
});

describe('poseForView', () => {
  const target: Vec3 = [10, 0, 0];

  it('front → position [10, 0, 100]、up [0, 1, 0]', () => {
    const pose = poseForView(target, 100, 'front');
    expectVec(pose.position, [10, 0, 100]);
    expectVec(pose.up, [0, 1, 0]);
  });

  it('top → position [10, 100, 0]、up [0, 0, −1]', () => {
    const pose = poseForView(target, 100, 'top');
    expectVec(pose.position, [10, 100, 0]);
    expectVec(pose.up, [0, 0, -1]);
  });

  it('right → position [110, 0, 0]', () => {
    expectVec(poseForView(target, 100, 'right').position, [110, 0, 0]);
  });

  it('6 方向すべてで position と target の距離が 100', () => {
    for (const view of VIEWS) {
      const { position } = poseForView(target, 100, view);
      expect(Math.hypot(position[0] - 10, position[1], position[2])).toBeCloseTo(100, 9);
    }
  });

  it('anglesForView の球座標（camera-controls と同じ取り方）は poseForView の向きと一致する', () => {
    for (const view of VIEWS) {
      const { azimuth, polar } = anglesForView(view);
      const dir: Vec3 = [
        Math.sin(polar) * Math.sin(azimuth),
        Math.cos(polar),
        Math.sin(polar) * Math.cos(azimuth),
      ];
      expectVec(dir, poseForView([0, 0, 0], 1, view).position);
    }
  });
});

describe('nearestAngle', () => {
  it('2π の整数倍だけずらして、今の角度に最も近い同じ向きを返す', () => {
    expect(nearestAngle(7, 0)).toBeCloseTo(2 * Math.PI, 9);
    expect(nearestAngle(-3, Math.PI)).toBeCloseTo(-Math.PI, 9);
    expect(nearestAngle(0.1, 0)).toBe(0);
  });
});

describe('orthoHeightForDistance / distanceForOrthoHeight', () => {
  it('互いに逆関数になる', () => {
    const fovY = (45 * Math.PI) / 180;
    for (const d of [1, 37.5, 250, 3000]) {
      expect(distanceForOrthoHeight(orthoHeightForDistance(d, fovY), fovY)).toBeCloseTo(d, 9);
    }
    for (const h of [2, 80, 1234]) {
      expect(orthoHeightForDistance(distanceForOrthoHeight(h, fovY), fovY)).toBeCloseTo(h, 9);
    }
  });

  it('視野角 90° では、見える高さは距離の 2 倍', () => {
    expect(orthoHeightForDistance(100, Math.PI / 2)).toBeCloseTo(200, 9);
  });
});
