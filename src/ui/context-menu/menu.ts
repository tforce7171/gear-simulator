// コンテキストメニューの表示と操作（S1-29）。中身（items.ts の MenuItem）を受け取って、カーソルの右下に出す。
// 閉じるのは、項目を選ぶ・Esc・メニューの外での押下とホイール・ウィンドウのリサイズとフォーカスを失う・Tab。
// キーボード: 開いたら最初の項目にフォーカス、↑↓ で移動（端で折り返す）、Home/End で端、Enter・Space で実行
import { t } from '../../app/i18n';
import { h, stopAppKeys } from '../dom';
import { type MenuAction, type MenuItem, placeMenu } from './items';
import './menu.css';

export interface ContextMenuView {
  // page はページ座標（CSS ピクセル）。開いていれば前のメニューを閉じてから開く
  open(items: readonly MenuItem[], page: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createContextMenuView(
  host: HTMLElement,
  onAction: (action: MenuAction) => void,
): ContextMenuView {
  let menu: HTMLElement | null = null;

  const buttons = (): HTMLElement[] =>
    menu === null ? [] : [...menu.querySelectorAll<HTMLElement>('[data-action]')];

  function focusAt(index: number): void {
    const list = buttons();
    if (list.length === 0) return;
    const i = ((index % list.length) + list.length) % list.length;
    list[i]?.focus();
  }

  function close(): void {
    if (menu === null) return;
    const el = menu;
    menu = null;
    el.remove();
    window.removeEventListener('pointerdown', onOutsidePointer, true);
    window.removeEventListener('wheel', onOutsideWheel, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
  }

  function run(action: MenuAction): void {
    close();
    onAction(action);
  }

  const outside = (target: EventTarget | null): boolean =>
    menu !== null && !(target instanceof Node && menu.contains(target));
  function onOutsidePointer(e: PointerEvent): void {
    if (outside(e.target)) close();
  }
  function onOutsideWheel(e: WheelEvent): void {
    if (outside(e.target)) close();
  }

  function onKeyDown(e: KeyboardEvent): void {
    const list = buttons();
    const current = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        focusAt(current < 0 ? -1 : current - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Enter':
      case ' ': {
        const action = list[current]?.dataset.action as MenuAction | undefined;
        if (action !== undefined) run(action);
        break;
      }
      case 'Escape':
      case 'Tab':
        close();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function open(items: readonly MenuItem[], page: { x: number; y: number }): void {
    close();
    const el = h('div', 'gs-context-menu', 'context-menu');
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', t('contextMenu.label'));
    for (const item of items) {
      const button = h('button', 'gs-context-menu__item');
      button.type = 'button';
      button.tabIndex = -1;
      button.dataset.action = item.action;
      if (item.checked === undefined) {
        button.setAttribute('role', 'menuitem');
      } else {
        button.setAttribute('role', 'menuitemcheckbox');
        button.setAttribute('aria-checked', String(item.checked));
      }
      const check = h('span', 'gs-context-menu__check');
      check.setAttribute('aria-hidden', 'true');
      check.textContent = item.checked === true ? '✓' : '';
      const label = h('span', 'gs-context-menu__label');
      label.textContent = t(item.labelKey);
      button.append(check, label);
      button.addEventListener('click', () => run(item.action));
      button.addEventListener('pointerenter', () => button.focus());
      el.append(button);
    }
    el.addEventListener('keydown', onKeyDown);
    // メニューの上の右クリックでブラウザ標準のメニューを出さない
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    stopAppKeys(el);
    // 大きさを測ってから位置を決める（画面に収める）
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.visibility = 'hidden';
    host.append(el);
    menu = el;
    const rect = el.getBoundingClientRect();
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
    const cursor = { x: page.x - window.scrollX, y: page.y - window.scrollY };
    const { left, top } = placeMenu(cursor, rect, viewport);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
    window.addEventListener('pointerdown', onOutsidePointer, true);
    window.addEventListener('wheel', onOutsideWheel, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    focusAt(0);
  }

  return {
    open,
    close,
    isOpen: () => menu !== null,
    dispose: close,
  };
}
