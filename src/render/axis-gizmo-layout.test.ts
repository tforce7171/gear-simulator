import { describe, expect, it } from 'vitest';
import { layoutGizmo } from './axis-gizmo-layout';

describe('layoutGizmo', () => {
  it('前から見る（右 +X、上 +Y）: +X の球が右、+Y の球が上、+Z の球が中央の最も手前', () => {
    const items = layoutGizmo({ right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] }, 96, 30);
    const byView = Object.fromEntries(items.map((item) => [item.view, item]));
    expect(byView.right).toMatchObject({ x: 78, y: 48, positive: true, axis: 'x' });
    expect(byView.left).toMatchObject({ x: 18, y: 48, positive: false });
    expect(byView.top).toMatchObject({ x: 48, y: 18 });
    expect(byView.bottom).toMatchObject({ x: 48, y: 78 });
    expect(byView.front).toMatchObject({ x: 48, y: 48, depth: 1 });
    // 奥から手前の順。最後（最も手前）が +Z
    expect(items.at(-1)?.view).toBe('front');
    expect(items[0]?.view).toBe('back');
  });

  it('上から見る（右 +X、上 −Z）: −Z の球（後ろ）が上、+Z の球（前）が下、+Y が最も手前', () => {
    const items = layoutGizmo({ right: [1, 0, 0], up: [0, 0, -1], back: [0, 1, 0] }, 96, 30);
    const byView = Object.fromEntries(items.map((item) => [item.view, item]));
    expect(byView.back).toMatchObject({ x: 48, y: 18 });
    expect(byView.front).toMatchObject({ x: 48, y: 78 });
    expect(items.at(-1)?.view).toBe('top');
  });
});
