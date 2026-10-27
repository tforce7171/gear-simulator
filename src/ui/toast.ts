// エラーと通知のトースト（S1-15、design.md §7）。
// 描画領域の下寄りに重ねて出し、新しいものを下に積む。文字列は t() で出し、言語が変わったら書き換える
import type { MessageKey, MessageParams } from '../core/i18n';
import { bindText, h } from './dom';
import './toast.css';

export type ToastKind = 'info' | 'error';

// 自動で消えるまでの時間（ms）
export const TOAST_DURATION_MS: Readonly<Record<ToastKind, number>> = {
  info: 3000,
  error: 6000,
};

// トーストを入れる要素。最後に登録したもの（ページにあるもの）を使う
const hosts: HTMLElement[] = [];
let fallback: HTMLElement | null = null;

// トーストを入れる要素を登録する（UiShell が描画領域の上の層を渡す）。登録を外す関数を返す
export function setToastHost(el: HTMLElement): () => void {
  hosts.push(el);
  return () => {
    const i = hosts.lastIndexOf(el);
    if (i >= 0) hosts.splice(i, 1);
  };
}

function container(): HTMLElement {
  for (let i = hosts.length - 1; i >= 0; i -= 1) {
    const host = hosts[i];
    if (host?.isConnected) return host;
  }
  // シェルが無いとき（テストなど）は body の下に置く
  if (fallback === null || !fallback.isConnected) {
    fallback = h('div', 'toast-stack toast-stack--fallback');
    document.body.append(fallback);
  }
  return fallback;
}

// 描画領域に重ねてトーストを出す。閉じる関数を返す（何度呼んでもよい）
export function showToast(
  message: MessageKey,
  kind: ToastKind,
  params?: MessageParams,
): () => void {
  const el = h('div', `toast toast--${kind}`, 'toast');
  el.dataset.kind = kind;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const text = h('span', 'toast__message', 'toast-message');
  const close = h('button', 'toast__close', 'toast-close');
  close.type = 'button';
  close.textContent = '×';
  el.append(text, close);

  const unbind = [
    bindText(text, message, 'textContent', params),
    bindText(close, 'toast.close', 'aria-label'),
    bindText(close, 'toast.close', 'title'),
  ];
  let closed = false;
  const dismiss = (): void => {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    for (const off of unbind) off();
    el.remove();
  };
  close.addEventListener('click', dismiss);
  const timer = window.setTimeout(dismiss, TOAST_DURATION_MS[kind]);

  container().append(el);
  return dismiss;
}
