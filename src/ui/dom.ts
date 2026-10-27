// UI の小さな補助（S1-15）

import { onLanguageChange, t } from '../app/i18n';
import type { MessageKey, MessageParams } from '../core/i18n';

export type TextAttr = 'textContent' | 'title' | 'aria-label';

function apply(el: HTMLElement, text: string, attr: TextAttr): void {
  if (attr === 'textContent') el.textContent = text;
  else el.setAttribute(attr, text);
}

// 要素の文字列を t(key) で入れ、言語の切り替えで書き換える。解除関数を返す
export function bindText(
  el: HTMLElement,
  key: MessageKey,
  attr: TextAttr = 'textContent',
  params?: MessageParams,
): () => void {
  const update = (): void => apply(el, t(key, params), attr);
  update();
  return onLanguageChange(update);
}

// 要素を作る。testId を渡すと data-testid を付ける
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  testId?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className !== undefined) el.className = className;
  if (testId !== undefined) el.dataset.testid = testId;
  return el;
}
