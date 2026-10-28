import { describe, expect, it } from 'vitest';
import { gearShapeKey } from './shape-key';

const spur = { kind: 'spur' } as const;

describe('gearShapeKey', () => {
  it("('spur', 'S', 12) は 'spur:S:12'", () => {
    expect(gearShapeKey(spur, 'S', 12)).toBe('spur:S:12');
  });

  it('大きさが違えば別のキー', () => {
    expect(gearShapeKey(spur, 'S', 12)).not.toBe(gearShapeKey(spur, 'M', 12));
    expect(gearShapeKey(spur, 'M', 12)).toBe('spur:M:12');
  });

  it('歯数が違えば別のキー', () => {
    expect(gearShapeKey(spur, 'S', 12)).not.toBe(gearShapeKey(spur, 'S', 13));
  });

  it('ハスバ歯車はキーに hand を含める（S2-01）', () => {
    const right = gearShapeKey({ kind: 'helical', hand: 'right' }, 'M', 20);
    const left = gearShapeKey({ kind: 'helical', hand: 'left' }, 'M', 20);
    expect(right).toBe('helical:M:20:right');
    expect(left).not.toBe(right);
    expect(right).not.toBe(gearShapeKey(spur, 'M', 20));
  });
});
