// 自動保存のデバウンス（S1-27、design.md §9）。シーンが変わってから delayMs 後に、最後のシーンを 1 回だけ書く。
// 続けて変わったら待ち直す。書き込みとタイマーは注入できる（テストでは偽のタイマーを使う）
import type { Scene } from '../core/scene/types';

export interface AutosaveTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: AutosaveTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Autosaver {
  notify(scene: Scene): void; // シーンが変わったら呼ぶ
  flush(): Promise<void>; // 待たずに書く（待っているシーンが無ければ何もしない）
  // 書いていないシーンがある（待っている間と、書き込みが終わるまで）
  pending(): boolean;
}

// write の失敗は onError に渡す（既定は console.warn。想定内の失敗なので console.error にしない）
export function createAutosaver(
  write: (scene: Scene) => Promise<void>,
  delayMs: number,
  options: { timers?: AutosaveTimers; onError?: (error: unknown) => void } = {},
): Autosaver {
  const timers = options.timers ?? defaultTimers;
  const onError =
    options.onError ?? ((error: unknown) => console.warn('自動保存に失敗した', error));
  let waiting: Scene | null = null; // まだ書いていない最後のシーン
  let timer: unknown = null;
  let writing = 0; // 書いている途中の数
  let chain: Promise<void> = Promise.resolve();

  function start(): Promise<void> {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    const scene = waiting;
    if (scene === null) return chain;
    waiting = null;
    writing += 1;
    // 前の書き込みが終わってから書く（古いシーンが後から書かれないように）
    chain = chain
      .then(() => write(scene))
      .catch(onError)
      .finally(() => {
        writing -= 1;
      });
    return chain;
  }

  return {
    notify(scene) {
      waiting = scene;
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        void start();
      }, delayMs);
    },
    flush: () => start(),
    pending: () => waiting !== null || writing > 0,
  };
}
