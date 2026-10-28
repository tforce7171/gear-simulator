import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from '../core/scene/types';
import { createAutosaver } from './autosave';

const scene = (n: number): Scene => ({
  shafts: {},
  gears: {},
  motors: {},
  anchors: {},
  // 区別のための印（型の外の値。参照で比べる）
  ...({ n } as object),
});

describe('createAutosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('0・300・600 ms の notify は 1600 ms に 1 回だけ、最後のシーンで書く', async () => {
    const write = vi.fn(async (_: Scene) => {});
    const saver = createAutosaver(write, 1000);
    const scenes = [scene(1), scene(2), scene(3)];
    saver.notify(scenes[0] as Scene);
    await vi.advanceTimersByTimeAsync(300);
    saver.notify(scenes[1] as Scene);
    await vi.advanceTimersByTimeAsync(300);
    saver.notify(scenes[2] as Scene);
    await vi.advanceTimersByTimeAsync(999); // 1599 ms
    expect(write).not.toHaveBeenCalled();
    expect(saver.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1); // 1600 ms
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe(scenes[2]);
    expect(saver.pending()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flush は待たずに 1 回書き、その後タイマーが来ても重ねて書かない', async () => {
    const write = vi.fn(async (_: Scene) => {});
    const saver = createAutosaver(write, 1000);
    const s = scene(1);
    saver.notify(s);
    await saver.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe(s);
    expect(saver.pending()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('notify なしの flush は書かない', async () => {
    const write = vi.fn(async (_: Scene) => {});
    const saver = createAutosaver(write, 1000);
    await saver.flush();
    expect(write).not.toHaveBeenCalled();
    expect(saver.pending()).toBe(false);
  });

  it('書き込みの失敗は onError に渡し、pending は false に戻る', async () => {
    const onError = vi.fn();
    const saver = createAutosaver(
      async () => {
        throw new Error('x');
      },
      1000,
      { onError },
    );
    saver.notify(scene(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(saver.pending()).toBe(false);
  });
});
