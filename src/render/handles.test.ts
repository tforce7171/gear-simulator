import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { HandleSpec } from '../input/handle-drag';
import { createHandleView } from './handles';

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
