import { type Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Axis } from '../core/scene/types';
import { createInfoArrowView, infoArrowSpec } from './info-arrows';

// S1-23: 回転方向の矢印

const AXES: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

function headOf(root: Object3D): Object3D {
  const head = root.getObjectByName('info-arrow-head');
  if (head === undefined) throw new Error('矢じりが無い');
  return head;
}

describe('infoArrowSpec', () => {
  it('小・12 枚（歯先円 7 mm）: 半径 8.05、中心は面の少し外（軸の正の側）', () => {
    const spec = infoArrowSpec(
      { id: 'gear_a', size: 'S', teeth: 12 },
      { center: [0, 22, 0], axis: 'y' },
      1,
    );
    expect(spec.radius).toBeCloseTo(7 * 1.15, 9);
    expect(spec.position[0]).toBe(0);
    expect(spec.position[2]).toBe(0);
    // 歯幅 4 の半分（2）より外
    expect(spec.position[1]).toBeGreaterThan(24);
    expect(spec.position[1]).toBeLessThan(26);
  });
});

describe('createInfoArrowView', () => {
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const direction of [1, -1] as const) {
      it(`軸 ${axis}・向き ${direction}: 矢じりは半径の円上にあり、回転の向きの接線を向く`, () => {
        const view = createInfoArrowView();
        const spec = infoArrowSpec(
          { id: 'gear_a', size: 'M', teeth: 20 },
          { center: [5, 10, -3], axis },
          direction,
        );
        view.set([spec]);
        view.root.updateMatrixWorld(true);
        const head = headOf(view.root);
        const tip = head.getWorldPosition(new Vector3());
        const center = new Vector3(...spec.position);
        const radial = tip.clone().sub(center);
        const w = AXES[axis];
        // 軸に垂直な面の上
        expect(radial.dot(w)).toBeCloseTo(0, 9);
        // 矢じりは円弧の終わりから接線に沿って長さの半分ずれているので、半径より少し外
        expect(radial.length()).toBeGreaterThan(spec.radius);
        expect(radial.length()).toBeLessThan(spec.radius * 1.1);
        // 円錐の +y が向く向き
        const pointing = new Vector3(0, 1, 0)
          .applyQuaternion(head.getWorldQuaternion(head.quaternion.clone()))
          .normalize();
        // 反時計回り（軸の正の向きから見て）の接線は w × r
        const ccw = w.clone().cross(radial).normalize();
        expect(pointing.dot(ccw)).toBeCloseTo(direction, 1);
      });
    }
  }

  it('同じ形なら作り直さず、無くなった歯車の矢印は消す', () => {
    const view = createInfoArrowView();
    const a = infoArrowSpec(
      { id: 'gear_a', size: 'S', teeth: 12 },
      { center: [0, 0, 0], axis: 'y' },
      1,
    );
    const b = infoArrowSpec(
      { id: 'gear_b', size: 'S', teeth: 24 },
      { center: [20, 0, 0], axis: 'y' },
      -1,
    );
    view.set([a, b]);
    expect(view.root.children).toHaveLength(2);
    const first = view.root.children[0];
    view.set([{ ...a, direction: -1 }]);
    expect(view.root.children).toHaveLength(1);
    expect(view.root.children[0]).toBe(first);
    view.set([]);
    expect(view.root.children).toHaveLength(0);
  });
});
