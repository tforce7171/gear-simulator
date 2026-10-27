// 作品を保存するダイアログ（S1-27）。いま開いている作品が無ければ名前と「保存」、あれば名前（変更可）と
// 「上書き保存」「新しい作品として保存」を出す。選んだ結果を返す（キャンセル・Esc は null）
import type { MessageKey } from '../core/i18n';
import { bindText, h, stopAppKeys } from './dom';
import './dialog.css';

export type SaveChoice = { readonly mode: 'new' | 'overwrite'; readonly name: string };

export interface SaveDialogOptions {
  readonly hasCurrent: boolean; // いま開いている作品があるか
  readonly name: string; // 名前の初期値（無ければ「作品 n」、あればその作品の名前）
}

export function openSaveDialog(options: SaveDialogOptions): Promise<SaveChoice | null> {
  const unbind: Array<() => void> = [];
  const text = (el: HTMLElement, key: MessageKey, attr?: 'aria-label'): void => {
    unbind.push(bindText(el, key, attr));
  };

  const dialog = h('dialog', 'gs-dialog', 'save-dialog');
  const title = h('h2', 'gs-dialog__title');
  text(title, 'save.title');
  const field = h('label', 'gs-dialog__field');
  const label = h('span');
  text(label, 'save.name');
  const input = h('input', 'gs-dialog__input', 'save-name');
  input.type = 'text';
  input.value = options.name;
  input.maxLength = 100;
  field.append(label, input);

  const actions = h('div', 'gs-dialog__actions');
  const button = (key: MessageKey, testId: string, primary: boolean): HTMLButtonElement => {
    const b = h(
      'button',
      primary ? 'gs-dialog__button gs-dialog__button--primary' : 'gs-dialog__button',
      testId,
    );
    b.type = 'button';
    text(b, key);
    return b;
  };
  const cancel = button('save.cancel', 'save-cancel', false);
  const choices: Array<[HTMLButtonElement, SaveChoice['mode']]> = options.hasCurrent
    ? [
        [button('save.asNew', 'save-as-new', false), 'new'],
        [button('save.overwrite', 'save-overwrite', true), 'overwrite'],
      ]
    : [[button('save.submit', 'save-submit', true), 'new']];
  actions.append(cancel, ...choices.map(([b]) => b));
  dialog.append(title, field, actions);

  const trimmed = (): string => input.value.trim();
  const refresh = (): void => {
    for (const [b] of choices) b.disabled = trimmed() === '';
  };
  input.addEventListener('input', refresh);
  refresh();

  return new Promise((resolve) => {
    let done = false;
    // 閉じたらすぐに（close イベントを待たずに）片付けて結果を返す。Esc で閉じたときは close イベントで
    const finish = (choice: SaveChoice | null): void => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      for (const off of unbind) off();
      dialog.remove();
      resolve(choice);
    };
    dialog.addEventListener('close', () => finish(null));
    for (const [b, mode] of choices) {
      b.addEventListener('click', () => finish({ mode, name: trimmed() }));
    }
    cancel.addEventListener('click', () => finish(null));
    // Enter は主の操作（保存・上書き保存）
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const primary = choices[choices.length - 1];
      if (primary !== undefined && !primary[0].disabled) primary[0].click();
    });
    stopAppKeys(dialog);
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}
