import { type Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { HandleSpec } from '../input/handle-drag';
import { createHandleView, createReattachView } from './handles';

function targets(root: Object3D): Array<{ kind: unknown; id: unknown }> {
  const found: Array<{ kind: unknown; id: unknown }> = [];
  root.traverse((o) => {
    if (o.userData.pickKind !== undefined) {
      found.push({ kind: o.userData.pickKind, id: o.userData.pickId });
    }
  });
  return found;
}

describe('createHandleView', () => {
  const handles: HandleSpec[] = [
    { kind: 'move', targetId: 'shaft_a', position: [10, 0, 5] },
    { kind: 'height', targetId: 'shaft_a', position: [10, 12, 5] },
  ];

  it('ハンドルごとに handle の印を付け、一覧から外れたら消す', () => {
    const view = createHandleView();
    view.set(handles, null);
    expect(targets(view.root)).toEqual([
      { kind: 'handle', id: 'move:shaft_a' },
      { kind: 'handle', id: 'height:shaft_a' },
    ]);
    view.set([], null);
    expect(targets(view.root)).toEqual([]);
  });

  it('位置を合わせる（作り直さずに動かす）', () => {
    const view = createHandleView();
    view.set(handles, null);
    const first = view.root.children[0];
    view.set([{ kind: 'move', targetId: 'shaft_a', position: [20, 0, -5] }], null);
    expect(view.root.children[0]).toBe(first);
    expect(first?.position.toArray()).toEqual([20, 0, -5]);
  });
});

describe('arc・axial（S1-19）', () => {
  const arc: HandleSpec = {
    kind: 'arc',
    targetId: 'shaft_b',
    position: [0, 24, 70],
    frame: { center: [0, 24, 0], axis: 'y', radius: 70, angle: 0 },
  };
  const axial: HandleSpec = {
    kind: 'axial',
    targetId: 'gear_e',
    position: [0, 45, -22],
    frame: { center: [0, 45, 0], axis: 'y', radius: 22, angle: Math.PI },
  };

  it('ハンドルの印を付け、円弧のつまみは今の角度の位置（ワールド座標）に来る', () => {
    const view = createHandleView();
    view.set([arc, axial], null);
    expect(targets(view.root)).toEqual([
      { kind: 'handle', id: 'arc:shaft_b' },
      { kind: 'handle', id: 'axial:gear_e' },
    ]);
    view.root.updateMatrixWorld(true);
    // 円弧のグループの子のうち、球（つまみ）の位置
    const group = view.root.children[0];
    const knob = group?.children[2];
    const world = knob?.getWorldPosition(new Vector3());
    expect(world?.x).toBeCloseTo(0, 6);
    expect(world?.y).toBeCloseTo(24, 6);
    expect(world?.z).toBeCloseTo(70, 6);
    // 角度を変えると、作り直さずにつまみが動く
    view.set(
      [{ ...arc, frame: { center: [0, 24, 0], axis: 'y', radius: 70, angle: Math.PI / 2 } }],
      null,
    );
    expect(view.root.children[0]).toBe(group);
    view.root.updateMatrixWorld(true);
    const moved = knob?.getWorldPosition(new Vector3());
    expect(moved?.x).toBeCloseTo(70, 6);
    expect(moved?.z).toBeCloseTo(0, 6);
  });
});

describe('createReattachView', () => {
  it('輪を描き、ピッキングの対象にしない。空の一覧で消える', () => {
    const view = createReattachView();
    const rings = [
      { center: [40, 39, 0] as const, axis: 'y' as const, radius: 20 },
      { center: [0, 39, 40] as const, axis: 'y' as const, radius: 20 },
    ];
    view.set(rings, 1);
    expect(view.root.children).toHaveLength(2);
    expect(targets(view.root)).toEqual([]);
    view.set([], null);
    expect(view.root.children).toHaveLength(0);
  });
});
