// 画面の骨組み（S1-15、要件 §7.4）。上にツールバー、左に部品パレット、右にプロパティパネル、
// 中央に 3D の描画領域、その右下に軸の目印の置き場。各領域の中身は後続のタスクが差し込む
import type { MessageKey } from '../core/i18n';
import { bindText, h } from './dom';
import { setToastHost } from './toast';
import './shell.css';

export type ToolbarButtonId =
  | 'works'
  | 'save'
  | 'export'
  | 'import'
  | 'theme'
  | 'info'
  | 'mute'
  | 'settings';

// 左からこの順に並べる
export const TOOLBAR_BUTTON_IDS: readonly ToolbarButtonId[] = [
  'works',
  'save',
  'export',
  'import',
  'theme',
  'info',
  'mute',
  'settings',
];

export interface UiShell {
  canvasHost: HTMLElement; // レンダラーの canvas を入れる
  gizmoSlot: HTMLElement; // 軸の目印の置き場
  toolbar: {
    button(id: ToolbarButtonId): HTMLButtonElement;
  };
  palette: { body: HTMLElement };
  properties: {
    setContent(content: HTMLElement | null): void; // null で案内文に戻す
  };
  dispose(): void;
}

// パネル・ツールバー・トーストは canvas の兄弟（祖先ではない）なので、その上のポインターとホイールは
// canvas に届かない。カメラの入力は canvas にだけ付ける（window に付けない）ことで、パネルの操作と分ける。
// パネルのホイールはそのままパネルのスクロールになる

export function createUiShell(root: HTMLElement): UiShell {
  const unbind: Array<() => void> = [];
  const text = (el: HTMLElement, key: MessageKey, attr?: 'title' | 'aria-label'): void => {
    unbind.push(bindText(el, key, attr));
  };

  root.classList.add('gs-shell');

  // ツールバー
  const toolbar = h('header', 'gs-toolbar', 'toolbar');
  toolbar.setAttribute('role', 'toolbar');
  text(toolbar, 'toolbar.label', 'aria-label');
  const brand = h('span', 'gs-toolbar__brand');
  text(brand, 'app.title');
  toolbar.append(brand);
  const buttons = new Map<ToolbarButtonId, HTMLButtonElement>();
  for (const id of TOOLBAR_BUTTON_IDS) {
    const button = h('button', 'gs-toolbar__button', `toolbar-${id}`);
    button.type = 'button';
    button.disabled = true; // 動作は各担当タスクで付けて有効にする
    text(button, `toolbar.${id}`);
    text(button, `toolbar.${id}`, 'aria-label');
    text(button, `toolbar.${id}.tooltip`, 'title');
    buttons.set(id, button);
    toolbar.append(button);
  }

  // 部品パレット（中身は S1-17・S1-18）
  const palette = h('aside', 'gs-panel gs-palette', 'palette');
  const paletteTitle = h('h2', 'gs-panel__title', 'palette-title');
  text(paletteTitle, 'palette.title');
  const paletteBody = h('div', 'gs-panel__body', 'palette-body');
  palette.append(paletteTitle, paletteBody);

  // プロパティパネル（中身は S1-20）
  const properties = h('aside', 'gs-panel gs-properties', 'properties');
  const propertiesTitle = h('h2', 'gs-panel__title', 'properties-title');
  text(propertiesTitle, 'properties.title');
  const propertiesBody = h('div', 'gs-panel__body', 'properties-body');
  const empty = h('p', 'gs-properties__empty', 'properties-empty');
  text(empty, 'properties.empty');
  propertiesBody.append(empty);
  properties.append(propertiesTitle, propertiesBody);

  // 描画領域。canvas の上に、軸の目印の置き場とトーストの層を重ねる
  const viewport = h('main', 'gs-viewport', 'viewport');
  const canvasHost = h('div', 'gs-viewport__canvas', 'canvas-host');
  const gizmoSlot = h('div', 'gs-viewport__gizmo', 'gizmo-slot');
  const toastStack = h('div', 'toast-stack', 'toast-stack');
  viewport.append(canvasHost, gizmoSlot, toastStack);

  root.append(toolbar, palette, viewport, properties);
  const releaseToastHost = setToastHost(toastStack);

  return {
    canvasHost,
    gizmoSlot,
    toolbar: {
      button(id) {
        const button = buttons.get(id);
        if (button === undefined) throw new Error(`ツールバーのボタン ${id} が無い`);
        return button;
      },
    },
    palette: { body: paletteBody },
    properties: {
      setContent(content) {
        propertiesBody.replaceChildren(content ?? empty);
      },
    },
    dispose() {
      for (const off of unbind) off();
      releaseToastHost();
      root.replaceChildren();
      root.classList.remove('gs-shell');
    },
  };
}
