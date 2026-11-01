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

  it('かさ歯車のキーは apex を含めない（S2-02）', () => {
    expect(gearShapeKey({ kind: 'bevel', apex: 1 }, 'M', 20)).toBe('bevel:M:20');
    expect(gearShapeKey({ kind: 'bevel', apex: -1 }, 'M', 20)).toBe('bevel:M:20');
    expect(gearShapeKey({ kind: 'bevel', apex: 1 }, 'M', 20)).not.toBe(gearShapeKey(spur, 'M', 20));
  });

  it('0.5 mm 刻みの厚さでもキーが分かれる（S5-01）', () => {
    const keys = [0.5, 1, 1.5, 4].map((w) => gearShapeKey(spur, 'S', 30, w));
    expect(keys[0]).toBe('spur:S:30:w0.5');
    expect(new Set(keys).size).toBe(4);
    // 小の歯幅（4 mm）は省いたときと同じキー
    expect(keys[3]).toBe(gearShapeKey(spur, 'S', 30));
  });
});
