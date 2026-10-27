import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  exceedsDragThreshold,
  type PointerDownInput,
  type PointerRoute,
  routePointerDown,
} from './pointer-route';

function input(patch: Partial<PointerDownInput>): PointerDownInput {
  return {
    button: 0,
    altKey: false,
    shiftKey: false,
    spaceHeld: false,
    overInteractive: false,
    ...patch,
  };
}

describe('routePointerDown', () => {
  const rows: ReadonlyArray<readonly [string, Partial<PointerDownInput>, PointerRoute]> = [
    ['左・何もない所', { button: 0 }, 'camera-rotate'],
    ['左・部品の上', { button: 0, overInteractive: true }, 'app'],
    ['Alt+左・何もない所', { button: 0, altKey: true }, 'camera-rotate'],
    ['Alt+左・部品の上', { button: 0, altKey: true, overInteractive: true }, 'camera-rotate'],
    ['Space+左・何もない所', { button: 0, spaceHeld: true }, 'camera-pan'],
    ['Space+左・部品の上', { button: 0, spaceHeld: true, overInteractive: true }, 'camera-pan'],
    [
      'Space+Alt+左・部品の上',
      { button: 0, spaceHeld: true, altKey: true, overInteractive: true },
      'camera-pan',
    ],
    ['Shift+左・何もない所', { button: 0, shiftKey: true }, 'camera-rotate'],
    ['Shift+左・部品の上', { button: 0, shiftKey: true, overInteractive: true }, 'app'],
    ['中・何もない所', { button: 1 }, 'camera-pan'],
    ['中・部品の上', { button: 1, overInteractive: true }, 'camera-pan'],
    ['Alt+中', { button: 1, altKey: true }, 'camera-pan'],
    ['Shift+中', { button: 1, shiftKey: true }, 'camera-pan'],
    ['右・何もない所', { button: 2 }, 'camera-rotate'],
    ['右・部品の上', { button: 2, overInteractive: true }, 'camera-rotate'],
    ['Alt+右', { button: 2, altKey: true }, 'camera-rotate'],
    ['Shift+右・何もない所', { button: 2, shiftKey: true }, 'camera-pan'],
    ['Shift+右・部品の上', { button: 2, shiftKey: true, overInteractive: true }, 'camera-pan'],
    ['Space+右', { button: 2, spaceHeld: true }, 'camera-rotate'],
    ['戻るボタン（3）', { button: 3 }, 'none'],
    ['進むボタン（4）', { button: 4, overInteractive: true }, 'none'],
  ];
  for (const [name, patch, expected] of rows) {
    it(`${name} → ${expected}`, () => {
      expect(routePointerDown(input(patch))).toBe(expected);
    });
  }
});

describe('exceedsDragThreshold', () => {
  it('しきい値は 4px', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });
  it('3px の移動 → false', () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(false);
  });
  it('4px の移動 → true', () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 10, y: 14 })).toBe(true);
  });
  it('斜め (3, 3) → true', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  });
  it('しきい値を渡せる', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toBe(false);
  });
});
