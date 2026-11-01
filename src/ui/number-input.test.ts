import { describe, expect, it } from 'vitest';
import { clampToStep, parseClampedInt, parseClampedStep } from './number-input';

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

describe('parseClampedStep（S5-01: 厚さの 0.5 mm 刻み）', () => {
  it('0.5 の倍数に丸めてから範囲に収める', () => {
    expect(parseClampedStep('1.5', 0.5, 32, 0.5)).toBe(1.5);
    expect(parseClampedStep('1.3', 0.5, 32, 0.5)).toBe(1.5);
    expect(parseClampedStep('1.2', 0.5, 32, 0.5)).toBe(1);
    expect(parseClampedStep('0.1', 0.5, 32, 0.5)).toBe(0.5);
    expect(parseClampedStep('0', 0.5, 32, 0.5)).toBe(0.5);
    expect(parseClampedStep('40', 0.5, 32, 0.5)).toBe(32);
    expect(parseClampedStep('abc', 0.5, 32, 0.5)).toBeNull();
  });

  it('clampToStep: 端の値から 1 刻み動かしても範囲の外に出ない', () => {
    expect(clampToStep(0.5 - 0.5, 0.5, 32, 0.5)).toBe(0.5);
    expect(clampToStep(32 + 0.5, 0.5, 32, 0.5)).toBe(32);
    expect(clampToStep(4 - 0.5, 0.5, 32, 0.5)).toBe(3.5);
  });
});
