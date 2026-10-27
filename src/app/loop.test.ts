import { describe, expect, it } from 'vitest';
import { frameDt, MAX_FRAME_DT } from './loop';

describe('frameDt', () => {
  it('最初のフレームは 0', () => {
    expect(frameDt(null, 1234)).toBe(0);
  });

  it('前のフレームからの経過時間（秒）', () => {
    expect(frameDt(1000, 1016)).toBeCloseTo(0.016, 9);
  });

  it('0.1 秒で頭打ちにする', () => {
    expect(MAX_FRAME_DT).toBe(0.1);
    expect(frameDt(0, 5000)).toBe(0.1);
  });
});
