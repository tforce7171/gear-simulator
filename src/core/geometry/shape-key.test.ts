import { describe, expect, it } from 'vitest';
import { gearShapeKey } from './shape-key';

describe('gearShapeKey', () => {
  it("('spur', 'S', 12) は 'spur:S:12'", () => {
    expect(gearShapeKey('spur', 'S', 12)).toBe('spur:S:12');
  });

  it('大きさが違えば別のキー', () => {
    expect(gearShapeKey('spur', 'S', 12)).not.toBe(gearShapeKey('spur', 'M', 12));
    expect(gearShapeKey('spur', 'M', 12)).toBe('spur:M:12');
  });

  it('歯数が違えば別のキー', () => {
    expect(gearShapeKey('spur', 'S', 12)).not.toBe(gearShapeKey('spur', 'S', 13));
  });
});
