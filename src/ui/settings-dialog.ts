// 設定画面（S1-30）。品質・入力デバイス・2 本指スクロールの割り当て・言語・テーマを選ぶとすぐ反映する
// （OK・キャンセルは無い）。閉じるボタン・Esc・ダイアログの外のクリックで閉じる。ミュートは置かない
import type { Lang, MessageKey } from '../core/i18n';
import {
  INPUT_DEVICE_SETTINGS,
  LANGS,
  QUALITIES,
  type Settings,
  TRACKPAD_SCROLLS,
} from '../core/settings';
import { THEME_IDS } from '../core/theme';
import { bindText, h, stopAppKeys } from './dom';
import './dialog.css';
import './settings-dialog.css';

// 設定画面に置く項目（ミュートは除く）
export type SettingsField = 'quality' | 'inputDevice' | 'trackpadScroll' | 'language' | 'theme';

// 言語の選択肢の表示名は、いまの言語に関係なくその言語で書く
const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = { ja: '日本語', en: 'English' };

interface Choice {
  readonly value: string;
  readonly label: MessageKey | { readonly text: string; readonly lang: string };
}

interface Row {
  readonly field: SettingsField;
  readonly label: MessageKey;
  readonly choices: readonly Choice[];
}

const ROWS: readonly Row[] = [
  {
    field: 'quality',
    label: 'settings.quality',
    choices: QUALITIES.map((q) => ({ value: q, label: `settings.quality.${q}` as const })),
  },
  {
    field: 'inputDevice',
    label: 'settings.inputDevice',
    choices: INPUT_DEVICE_SETTINGS.map((d) => ({
      value: d,
      label: `settings.inputDevice.${d}` as const,
    })),
  },
  {
    field: 'trackpadScroll',
    label: 'settings.trackpadScroll',
    choices: TRACKPAD_SCROLLS.map((s) => ({
      value: s,
      label: `settings.trackpadScroll.${s}` as const,
    })),
  },
  {
    field: 'language',
    label: 'settings.language',
    choices: LANGS.map((lang) => ({ value: lang, label: { text: LANGUAGE_NAMES[lang], lang } })),
  },
  {
    field: 'theme',
    label: 'settings.theme',
    choices: THEME_IDS.map((theme) => ({ value: theme, label: `theme.${theme}` as const })),
  },
];

export interface SettingsDialogDeps {
  readonly getSettings: () => Settings;
  // 選んだ値で設定を変える（ストアの updateSettings）
  readonly update: (patch: Partial<Settings>) => void;
  // 設定が変わったら知らせてもらう（ツールバーのテーマボタンなど、ほかの経路の変更も選択に映す）。解除関数を返す
  readonly subscribe: (listener: () => void) => () => void;
}

export interface SettingsDialog {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createSettingsDialog(deps: SettingsDialogDeps): SettingsDialog {
  let current: { readonly dialog: HTMLDialogElement; readonly dispose: () => void } | null = null;

  const build = (): { dialog: HTMLDialogElement; dispose: () => void } => {
    const unbind: Array<() => void> = [];
    const text = (el: HTMLElement, key: MessageKey, attr?: 'aria-label'): void => {
      unbind.push(bindText(el, key, attr));
    };
    const dialog = h('dialog', 'gs-dialog gs-settings', 'settings-dialog');
    const title = h('h2', 'gs-dialog__title');
    title.id = 'gs-settings-title';
    text(title, 'settings.title');
    dialog.setAttribute('aria-labelledby', title.id);

    const list = h('div', 'gs-settings__rows');
    const buttons: Array<{ field: SettingsField; value: string; button: HTMLButtonElement }> = [];
    for (const row of ROWS) {
      const section = h('div', 'gs-settings__row');
      section.dataset.setting = row.field;
      const label = h('span', 'gs-settings__label');
      label.id = `gs-settings-${row.field}`;
      text(label, row.label);
      const group = h('div', 'gs-settings__choices');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-labelledby', label.id);
      for (const choice of row.choices) {
        const button = h('button', 'gs-settings__choice');
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.dataset.value = choice.value;
        if (typeof choice.label === 'string') {
          text(button, choice.label);
        } else {
          button.textContent = choice.label.text;
          button.lang = choice.label.lang;
        }
        button.addEventListener('click', () => {
          deps.update({ [row.field]: choice.value } as Partial<Settings>);
          refresh();
        });
        buttons.push({ field: row.field, value: choice.value, button });
        group.append(button);
      }
      section.append(label, group);
      list.append(section);
    }

    const actions = h('div', 'gs-dialog__actions');
    const closeButton = h('button', 'gs-dialog__button', 'settings-close');
    closeButton.type = 'button';
    text(closeButton, 'settings.close');
    closeButton.addEventListener('click', () => close());
    actions.append(closeButton);
    dialog.append(title, list, actions);

    const refresh = (): void => {
      const settings = deps.getSettings();
      for (const { field, value, button } of buttons) {
        button.setAttribute('aria-checked', String(settings[field] === value));
      }
    };
    refresh();
    unbind.push(deps.subscribe(refresh));

    // Esc はダイアログの既定の動作で閉じる（close イベントで片付ける）
    dialog.addEventListener('close', () => close());
    // 外（::backdrop）のクリックは dialog 自身に届く。枠の内側の余白のクリックと区別する
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    });
    stopAppKeys(dialog);
    return {
      dialog,
      dispose: () => {
        for (const off of unbind) off();
      },
    };
  };

  function close(): void {
    if (current === null) return;
    const { dialog, dispose } = current;
    current = null;
    if (dialog.open) dialog.close();
    dispose();
    dialog.remove();
  }

  return {
    open() {
      if (current !== null) return;
      current = build();
      document.body.append(current.dialog);
      current.dialog.showModal();
    },
    close,
    isOpen: () => current !== null,
  };
}
