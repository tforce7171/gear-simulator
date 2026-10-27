import { describe, expect, it } from 'vitest';
import { createSpaceTapDetector, SPACE_TAP_MAX_MS, type SpaceTapEvent } from './space-tap';

function run(events: readonly SpaceTapEvent[]): Array<'tap' | null> {
  const detect = createSpaceTapDetector();
  return events.map((e) => detect(e));
}

describe('createSpaceTapDetector', () => {
  it('SPACE_TAP_MAX_MS は 500', () => {
    expect(SPACE_TAP_MAX_MS).toBe(500);
  });

  it("keydown(0) → keyup(120) → 'tap'", () => {
    expect(
      run([
        { type: 'keydown', repeat: false, timeMs: 0 },
        { type: 'keyup', timeMs: 120 },
      ]),
    ).toEqual([null, 'tap']);
  });

  it('keydown(0) → drag → keyup(120) → null', () => {
    expect(
      run([
        { type: 'keydown', repeat: false, timeMs: 0 },
        { type: 'drag' },
        { type: 'keyup', timeMs: 120 },
      ]),
    ).toEqual([null, null, null]);
  });

  it('keydown(0) → keyup(800) → null', () => {
    expect(
      run([
        { type: 'keydown', repeat: false, timeMs: 0 },
        { type: 'keyup', timeMs: 800 },
      ]),
    ).toEqual([null, null]);
  });

  it("keydown(0) → keydown(repeat, 30) → keydown(repeat, 60) → keyup(120) → 'tap'（1 回だけ）", () => {
    expect(
      run([
        { type: 'keydown', repeat: false, timeMs: 0 },
        { type: 'keydown', repeat: true, timeMs: 30 },
        { type: 'keydown', repeat: true, timeMs: 60 },
        { type: 'keyup', timeMs: 120 },
      ]),
    ).toEqual([null, null, null, 'tap']);
  });

  it('keyup だけ（押されていない）→ null', () => {
    expect(run([{ type: 'keyup', timeMs: 120 }])).toEqual([null]);
  });

  it('ドラッグした押し方の後でも、次の押して離すは tap になる', () => {
    expect(
      run([
        { type: 'keydown', repeat: false, timeMs: 0 },
        { type: 'drag' },
        { type: 'keyup', timeMs: 120 },
        { type: 'keydown', repeat: false, timeMs: 1000 },
        { type: 'keyup', timeMs: 1100 },
      ]),
    ).toEqual([null, null, null, null, 'tap']);
  });

  it('押していない間のドラッグは次の押して離すに影響しない', () => {
    expect(
      run([
        { type: 'drag' },
        { type: 'keydown', repeat: false, timeMs: 0 },
        { type: 'keyup', timeMs: 100 },
      ]),
    ).toEqual([null, null, 'tap']);
  });
});
