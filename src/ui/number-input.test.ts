import { describe, expect, it } from 'vitest';
import { parseClampedInt } from './number-input';

describe('parseClampedInt', () => {
  it('範囲内の整数はそのまま', () => {
    expect(parseClampedInt('30', 12, 60)).toBe(30);
  });

  it('範囲外は範囲の端に丸める', () => {
    expect(parseClampedInt('100', 12, 60)).toBe(60);
    expect(parseClampedInt('5', 12, 60)).toBe(12);
  });

  it('小数は四捨五入する', () => {
    expect(parseClampedInt('20.6', 12, 60)).toBe(21);
  });

  it('前後の空白は無視する', () => {
    expect(parseClampedInt(' 25 ', 12, 60)).toBe(25);
  });

  it('数でなければ null', () => {
    expect(parseClampedInt('abc', 12, 60)).toBeNull();
    expect(parseClampedInt('', 12, 60)).toBeNull();
  });
});
