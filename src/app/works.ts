// 作品の保存と作品一覧（S1-27、design.md §9）。ツールバーの「保存」「作品一覧」の動作をまとめる。
// 読み書きの失敗は想定内なので、トーストで知らせて console.warn にとどめる（console.error にしない）
import type { Lang, MessageKey, MessageParams } from '../core/i18n';
import { parseSaveFileObject, type SaveFile, toSaveFile } from '../core/io/save-file';
import { nextDefaultWorkName } from '../core/io/thumbnail';
import type { WorkRecord, WorkSummary } from '../storage/db';
import type { SaveChoice, SaveDialogOptions } from '../ui/save-dialog';
import type { WorksDialogDeps } from '../ui/works-dialog';
import { SAMPLES } from './samples';
import type { Store } from './store';

export interface WorksDb {
  listWorks(): Promise<WorkSummary[]>;
  getWork(id: string): Promise<WorkRecord | undefined>;
  putWork(work: WorkRecord): Promise<void>;
  renameWork(id: string, name: string): Promise<void>;
  deleteWork(id: string): Promise<void>;
}

export interface WorksDeps {
  readonly store: Store;
  readonly db: WorksDb;
  readonly isAvailable: () => boolean; // IndexedDB が使えるか（起動時に開けなかったら false）
  readonly captureThumbnail: () => Promise<Blob>; // 今の画面の 256×256 の PNG
  readonly openSaveDialog: (options: SaveDialogOptions) => Promise<SaveChoice | null>;
  readonly openWorksDialog: (initial: readonly WorkSummary[], deps: WorksDialogDeps) => void;
  readonly showToast: (key: MessageKey, kind: 'info' | 'error', params?: MessageParams) => void;
  readonly t: (key: MessageKey) => string;
  readonly getLanguage: () => Lang;
  readonly newId: () => string;
  readonly now?: () => number;
}

export interface Works {
  save(): Promise<void>; // ツールバーの「保存」
  openList(): Promise<void>; // ツールバーの「作品一覧」
}

export function formatWorkDate(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(ms));
}

export function createWorks(deps: WorksDeps): Works {
  const now = deps.now ?? Date.now;
  const fail = (error: unknown): void => {
    console.warn('作品の読み書きに失敗した', error);
    deps.showToast('storage.failed', 'error');
  };
  const unavailable = (): boolean => {
    if (deps.isAvailable()) return false;
    deps.showToast('storage.unavailable', 'error');
    return true;
  };
  let busy = false;

  async function save(): Promise<void> {
    if (busy || unavailable()) return;
    busy = true;
    try {
      const { currentWork } = deps.store.getState();
      let name: string;
      if (currentWork === null) {
        const works = await deps.db.listWorks();
        name = nextDefaultWorkName(
          works.map((w) => w.name),
          deps.t('work.defaultName'),
        );
      } else {
        name = currentWork.name;
      }
      const choice = await deps.openSaveDialog({ hasCurrent: currentWork !== null, name });
      if (choice === null) return;
      // ダイアログを閉じた後の画面（シーン）を撮る
      const thumbnail = await deps.captureThumbnail();
      const file: SaveFile = toSaveFile(deps.store.getState().scene);
      const id =
        choice.mode === 'overwrite' && currentWork !== null ? currentWork.id : deps.newId();
      await deps.db.putWork({ id, name: choice.name, updatedAt: now(), thumbnail, file });
      deps.store.dispatch({ type: 'setCurrentWork', work: { id, name: choice.name } });
      deps.showToast('save.done', 'info', { name: choice.name });
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
    }
  }

  async function open(id: string): Promise<boolean> {
    const record = await deps.db.getWork(id);
    const parsed = parseSaveFileObject(record?.file);
    if (record === undefined || !parsed.ok) {
      console.warn('作品を開けなかった', parsed.ok ? 'not found' : parsed.error);
      deps.showToast('storage.openFailed', 'error');
      return false;
    }
    // replaceScene で読み込む（Undo で開く前のシーンに戻せる）
    deps.store.dispatch({
      type: 'command',
      command: { type: 'replaceScene', scene: parsed.file.scene },
    });
    deps.store.dispatch({ type: 'setCurrentWork', work: { id: record.id, name: record.name } });
    return true;
  }

  // 見本を開く（S5-05）。replaceScene で読み込み（Undo で戻せる）、保存した作品ではないので今の作品はなしにする
  function openSample(id: string): boolean {
    const sample = SAMPLES.find((s) => s.id === id);
    if (sample === undefined) return false;
    deps.store.dispatch({
      type: 'command',
      command: { type: 'replaceScene', scene: sample.scene },
    });
    deps.store.dispatch({ type: 'setCurrentWork', work: null });
    return true;
  }

  async function openList(): Promise<void> {
    if (busy || unavailable()) return;
    busy = true;
    try {
      const works = await deps.db.listWorks();
      deps.openWorksDialog(works, {
        list: () => deps.db.listWorks(),
        open,
        rename: async (id, name) => {
          await deps.db.renameWork(id, name);
          const { currentWork } = deps.store.getState();
          if (currentWork?.id === id) {
            deps.store.dispatch({ type: 'setCurrentWork', work: { id, name } });
          }
        },
        remove: async (id) => {
          await deps.db.deleteWork(id);
          // いま開いている作品を消したら、なしにする（シーンはそのまま）
          if (deps.store.getState().currentWork?.id === id) {
            deps.store.dispatch({ type: 'setCurrentWork', work: null });
          }
        },
        formatDate: (ms) => formatWorkDate(ms, deps.getLanguage()),
        onError: fail,
        samples: SAMPLES,
        openSample,
      });
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
    }
  }

  return { save, openList };
}
