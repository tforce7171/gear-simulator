// 作品一覧のダイアログ（S1-27）。カードはサムネイル・名前・更新日時と「開く」「名前を変更」「削除」。
// 並び（更新日時の新しい順）と読み書きは呼ぶ側（app/works.ts）が持ち、ここは表示と操作の受け付けだけ
import type { MessageKey } from '../core/i18n';
import type { WorkSummary } from '../storage/db';
import { bindText, h, stopAppKeys } from './dom';
import './dialog.css';

export interface WorksDialogDeps {
  // 一覧を読み直す（開いたとき・名前の変更と削除の後）。失敗したら reject（呼ぶ側がトーストで知らせる）
  readonly list: () => Promise<WorkSummary[]>;
  // 開く。true を返したらダイアログを閉じる
  readonly open: (id: string) => Promise<boolean>;
  readonly rename: (id: string, name: string) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  // 更新日時の表示（言語に合わせた書式）
  readonly formatDate: (ms: number) => string;
  // 読み書きの失敗を知らせる
  readonly onError: (error: unknown) => void;
  // 見本（S5-05）。保存した作品の一覧の上に「見本」として並べる。省くか空なら出さない
  readonly samples?: ReadonlyArray<{
    readonly id: string;
    readonly nameKey: MessageKey;
    readonly descriptionKey: MessageKey;
  }>;
  // 見本を開く。true を返したらダイアログを閉じる
  readonly openSample?: (id: string) => boolean;
}

export interface WorksDialog {
  close(): void;
}

export function openWorksDialog(
  initial: readonly WorkSummary[],
  deps: WorksDialogDeps,
): WorksDialog {
  const unbind: Array<() => void> = [];
  const text = (
    el: HTMLElement,
    key: MessageKey,
    attr?: 'aria-label' | 'title',
    params?: Record<string, string>,
  ): void => {
    unbind.push(bindText(el, key, attr, params));
  };
  // カードごとの解除（作り直すたびに外す）
  let cardUnbind: Array<() => void> = [];
  let urls: string[] = [];

  const dialog = h('dialog', 'gs-dialog gs-works', 'works-dialog');
  const title = h('h2', 'gs-dialog__title');
  text(title, 'works.title');
  const body = h('div');
  // 見本（S5-05）。一覧を読み直しても作り直さない
  const samples = deps.samples ?? [];
  const sampleSection = h('section', 'gs-works__samples', 'works-samples');
  if (samples.length > 0) {
    const heading = h('h3', 'gs-works__samples-title');
    text(heading, 'samples.title');
    const list = h('div', 'gs-works__sample-list');
    for (const sample of samples) {
      const el = h('article', 'gs-work-card gs-work-card--sample', 'sample-card');
      el.dataset.sampleId = sample.id;
      const name = h('div', 'gs-work-card__name', 'sample-name');
      text(name, sample.nameKey);
      const description = h('div', 'gs-work-card__date', 'sample-description');
      text(description, sample.descriptionKey);
      const row = h('div', 'gs-work-card__actions');
      const open = h('button', 'gs-dialog__button gs-dialog__button--primary', 'sample-open');
      open.type = 'button';
      text(open, 'works.open');
      open.addEventListener('click', () => {
        if (deps.openSample?.(sample.id) === true) finish();
      });
      row.append(open);
      el.append(name, description, row);
      list.append(el);
    }
    sampleSection.append(heading, list);
  }
  const actions = h('div', 'gs-dialog__actions');
  const close = h('button', 'gs-dialog__button', 'works-close');
  close.type = 'button';
  text(close, 'works.close');
  actions.append(close);
  dialog.append(title, ...(samples.length > 0 ? [sampleSection] : []), body, actions);

  const button = (
    key: MessageKey,
    testId: string,
    variant: '' | 'primary' | 'danger' = '',
    params?: Record<string, string>,
  ): HTMLButtonElement => {
    const b = h(
      'button',
      variant === '' ? 'gs-dialog__button' : `gs-dialog__button gs-dialog__button--${variant}`,
      testId,
    );
    b.type = 'button';
    cardUnbind.push(bindText(b, key, 'textContent', params));
    return b;
  };

  const clearCards = (): void => {
    for (const off of cardUnbind) off();
    cardUnbind = [];
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  };

  let busy = false;
  // 読み書きを 1 つずつ行い、終わったら一覧を読み直す
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await action();
      render(await deps.list());
    } catch (error) {
      deps.onError(error);
    } finally {
      busy = false;
    }
  };

  function card(work: WorkSummary): HTMLElement {
    const el = h('article', 'gs-work-card', 'work-card');
    el.dataset.workId = work.id;
    el.dataset.updatedAt = String(work.updatedAt);
    const img = h('img', 'gs-work-card__thumb', 'work-thumbnail');
    const url = URL.createObjectURL(work.thumbnail);
    urls.push(url);
    img.src = url;
    cardUnbind.push(bindText(img, 'works.thumbnail', 'title', { name: work.name }));
    img.alt = img.title;
    const name = h('div', 'gs-work-card__name', 'work-name');
    name.textContent = work.name;
    name.title = work.name;
    const date = h('div', 'gs-work-card__date', 'work-date');
    cardUnbind.push(
      bindText(date, 'works.updatedAt', 'textContent', { date: deps.formatDate(work.updatedAt) }),
    );
    const row = h('div', 'gs-work-card__actions');
    const open = button('works.open', 'work-open', 'primary');
    const rename = button('works.rename', 'work-rename');
    const remove = button('works.delete', 'work-delete', 'danger');
    row.append(open, rename, remove);
    el.append(img, name, date, row);

    open.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      deps
        .open(work.id)
        .then((done) => {
          if (done) finish();
        })
        .catch(deps.onError)
        .finally(() => {
          busy = false;
        });
    });

    // 名前の変更: 名前の欄を入力欄にする。Enter・フォーカスを外すと確定、Esc でやめる
    rename.addEventListener('click', () => {
      const input = h('input', 'gs-dialog__input', 'work-rename-input');
      input.type = 'text';
      input.value = work.name;
      input.maxLength = 100;
      cardUnbind.push(bindText(input, 'works.rename.input', 'title'));
      cardUnbind.push(bindText(input, 'works.rename.input', 'aria-label'));
      let finished = false;
      const finish = (commit: boolean): void => {
        if (finished) return;
        finished = true;
        const next = input.value.trim();
        if (!commit || next === '' || next === work.name) {
          input.replaceWith(name);
          return;
        }
        void run(() => deps.rename(work.id, next));
      };
      input.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          // ダイアログは閉じない
          e.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      name.replaceWith(input);
      input.select();
    });

    // 削除: 確認の行に差し替える
    remove.addEventListener('click', () => {
      const confirm = h('div', 'gs-work-card__actions', 'work-delete-confirm');
      const message = h('span');
      cardUnbind.push(
        bindText(message, 'works.delete.confirm', 'textContent', { name: work.name }),
      );
      const yes = button('works.delete.yes', 'work-delete-yes', 'danger');
      const no = button('works.delete.no', 'work-delete-no');
      confirm.append(message, yes, no);
      yes.addEventListener('click', () => {
        void run(() => deps.remove(work.id));
      });
      no.addEventListener('click', () => confirm.replaceWith(row));
      row.replaceWith(confirm);
      no.focus();
    });
    return el;
  }

  function render(works: readonly WorkSummary[]): void {
    clearCards();
    if (works.length === 0) {
      const empty = h('p', 'gs-works__empty', 'works-empty');
      cardUnbind.push(bindText(empty, 'works.empty'));
      body.replaceChildren(empty);
      return;
    }
    const list = h('div', 'gs-works__list', 'works-list');
    list.append(...works.map(card));
    body.replaceChildren(list);
  }

  render(initial);
  let closed = false;
  // 閉じたらすぐに（close イベントを待たずに）片付ける。Esc で閉じたときは close イベントで
  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    clearCards();
    for (const off of unbind) off();
    dialog.remove();
  };
  close.addEventListener('click', finish);
  dialog.addEventListener('close', finish);
  stopAppKeys(dialog);
  document.body.append(dialog);
  dialog.showModal();
  return {
    close: finish,
  };
}
