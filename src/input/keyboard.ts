// キー入力の共通の処理（S1-13）。後続のタスク（Delete、Ctrl+Z、R、Space、M、テンキー）もここに登録する

// フォーカスがテキストの入力先（input・textarea・select・contenteditable）にあるか。
// jsdom を要らないように、tagName と isContentEditable だけで判定する
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// キーの指定。文字キー・名前のあるキー（Home、Delete、' ' など）は key（event.key）で、
// テンキーは code（event.code。例 'Numpad7'）で指定する。
// ctrl・alt は省略すると「押されていない」、shift は省略すると「どちらでもよい」
export interface KeyBinding {
  key?: string;
  code?: string;
  ctrl?: boolean; // Ctrl または Meta（Mac の Cmd）
  alt?: boolean;
  shift?: boolean;
}

type KeyFields = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

// キー（key・code）だけが合うか。修飾キーは見ない
export function matchesKey(
  binding: KeyBinding,
  event: Pick<KeyboardEvent, 'key' | 'code'>,
): boolean {
  if (binding.code !== undefined && event.code !== binding.code) return false;
  if (binding.key !== undefined) {
    const want = binding.key;
    const got = event.key;
    // 1 文字のキーは大文字・小文字を区別しない（Shift や Caps Lock で変わるため）
    const same = want.length === 1 ? want.toLowerCase() === got.toLowerCase() : want === got;
    if (!same) return false;
  }
  return true;
}

export function matchesBinding(binding: KeyBinding, event: KeyFields): boolean {
  if (!matchesKey(binding, event)) return false;
  if ((binding.ctrl ?? false) !== (event.ctrlKey || event.metaKey)) return false;
  if ((binding.alt ?? false) !== event.altKey) return false;
  if (binding.shift !== undefined && binding.shift !== event.shiftKey) return false;
  return true;
}

export interface KeyHandlers {
  // 押したとき。テキストの入力中は呼ばない。既定では preventDefault する
  onDown?: (event: KeyboardEvent) => void;
  // 離したとき。押している間の状態が残らないように、テキストの入力中でも呼ぶ
  onUp?: (event: KeyboardEvent) => void;
  allowRepeat?: boolean; // 自動の繰り返しでも onDown を呼ぶか（既定 false）
  preventDefault?: boolean; // 既定 true
}

export interface Keyboard {
  bind(binding: KeyBinding, handlers: KeyHandlers): () => void; // 解除する関数を返す
  dispose(): void;
}

interface Entry {
  binding: KeyBinding;
  handlers: KeyHandlers;
}

// window などに keydown・keyup を付け、登録したキーの処理を呼ぶ
export function createKeyboard(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
): Keyboard {
  const entries = new Set<Entry>();

  const onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (isTypingTarget(e.target)) return;
    for (const entry of entries) {
      if (entry.handlers.onDown === undefined) continue;
      if (!matchesBinding(entry.binding, e)) continue;
      if (e.repeat && entry.handlers.allowRepeat !== true) {
        if (entry.handlers.preventDefault !== false) e.preventDefault();
        continue;
      }
      if (entry.handlers.preventDefault !== false) e.preventDefault();
      entry.handlers.onDown(e);
    }
  };
  const onKeyUp = (event: Event): void => {
    const e = event as KeyboardEvent;
    for (const entry of entries) {
      if (entry.handlers.onUp === undefined) continue;
      // 押している間に修飾キーが変わっても離したことが伝わるように、キーだけで判定する
      if (!matchesKey(entry.binding, e)) continue;
      entry.handlers.onUp(e);
    }
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);

  return {
    bind(binding, handlers) {
      const entry: Entry = { binding, handlers };
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      entries.clear();
    },
  };
}
