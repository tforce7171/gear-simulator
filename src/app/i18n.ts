// 実行時の言語（design.md §8）。DOM には触れない。
// S1-30 で AppState.settings の言語と結び付けるが、このモジュールの API は変えない
import {
  detectLanguage,
  type Lang,
  type MessageKey,
  type MessageParams,
  translate,
} from '../core/i18n';

const listeners = new Set<(lang: Lang) => void>();

let current: Lang = detectLanguage(
  typeof navigator === 'undefined' ? undefined : navigator.language,
);

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}

export function getLanguage(): Lang {
  return current;
}

// 言語が変わったときだけ購読者に知らせる
export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const listener of [...listeners]) listener(lang);
}

// 解除する関数を返す
export function onLanguageChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
