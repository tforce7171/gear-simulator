import { describe, expect, it } from 'vitest';
import { centerSquareCrop, nextDefaultWorkName } from './thumbnail';

describe('centerSquareCrop', () => {
  it('横長は左右を切る', () => {
    expect(centerSquareCrop(1280, 800)).toEqual({ sx: 240, sy: 0, size: 800 });
  });
  it('縦長は上下を切る', () => {
    expect(centerSquareCrop(600, 900)).toEqual({ sx: 0, sy: 150, size: 600 });
  });
});

describe('nextDefaultWorkName', () => {
  it('無ければ 1', () => {
    expect(nextDefaultWorkName([], '作品')).toBe('作品 1');
  });
  it('空いている最小の番号', () => {
    expect(nextDefaultWorkName(['作品 1', '作品 3'], '作品')).toBe('作品 2');
  });
});
