import { describe, expect, it } from 'vitest';
import { choosePick } from './pick-priority';

describe('choosePick', () => {
  it('距離より種類が優先される（シャフトより歯車）', () => {
    expect(
      choosePick([
        { kind: 'shaft', id: 's', distance: 1 },
        { kind: 'gear', id: 'g', distance: 5 },
      ]),
    ).toEqual({ kind: 'gear', id: 'g' });
  });

  it('同じ種類なら手前（距離の小さい方）', () => {
    expect(
      choosePick([
        { kind: 'gear', id: 'far', distance: 5 },
        { kind: 'gear', id: 'near', distance: 2 },
      ]),
    ).toEqual({ kind: 'gear', id: 'near' });
  });

  it('ハンドルが最優先', () => {
    expect(
      choosePick([
        { kind: 'gear', id: 'g', distance: 1 },
        { kind: 'handle', id: 'h', distance: 9 },
      ]),
    ).toEqual({ kind: 'handle', id: 'h' });
  });

  it('候補 > 歯車 > モーター > シャフト', () => {
    expect(
      choosePick([
        { kind: 'shaft', id: 's', distance: 1 },
        { kind: 'motor', id: 'm', distance: 2 },
        { kind: 'gear', id: 'g', distance: 3 },
        { kind: 'candidate', id: 'c', distance: 4 },
      ]),
    ).toEqual({ kind: 'candidate', id: 'c' });
    expect(
      choosePick([
        { kind: 'shaft', id: 's', distance: 1 },
        { kind: 'motor', id: 'm', distance: 2 },
      ]),
    ).toEqual({ kind: 'motor', id: 'm' });
  });

  it('空なら null', () => {
    expect(choosePick([])).toBeNull();
  });
});
