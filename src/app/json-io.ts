// JSON のエクスポートとインポート（S1-28、design.md §9）。ツールバーの「エクスポート」「インポート」の動作をまとめる。
// 読み込みの失敗は想定内なので、トーストで知らせて console.warn にとどめる（console.error にしない。design.md §7）
import { MAX_SAVE_FILE_BYTES } from '../core/constants';
import type { MessageKey, MessageParams } from '../core/i18n';
import {
  exportFileName,
  parseSaveFile,
  type SaveFileError,
  serializeSaveFile,
  toSaveFile,
} from '../core/io/save-file';
import type { Store } from './store';

// 読み込むファイル（File の必要な部分だけ。テストでは Blob を渡せる）
export interface ImportSource {
  readonly size: number;
  text(): Promise<string>;
}

export interface JsonIoDeps {
  readonly store: Store;
  readonly download: (fileName: string, text: string) => void;
  readonly fitAll: () => void;
  readonly showToast: (key: MessageKey, kind: 'info' | 'error', params?: MessageParams) => void;
  readonly now?: () => Date;
}

export interface JsonIo {
  exportScene(): void; // ツールバーの「エクスポート」
  importFile(file: ImportSource): Promise<boolean>; // 選んだファイルを読み込む。読めたら true
}

// 失敗の理由ごとのトーストの文言。シーンの検証の失敗は、場所の最後の部分（歯数・回転数）で詳しくする
export function importErrorMessage(error: SaveFileError): {
  key: MessageKey;
  params?: MessageParams;
} {
  switch (error.code) {
    case 'too-large':
      return { key: 'import.error.tooLarge' };
    case 'invalid-json':
      return { key: 'import.error.invalidJson' };
    case 'not-gear-simulator':
      return { key: 'import.error.notGearSimulator' };
    case 'invalid-version':
      return { key: 'import.error.invalidVersion' };
    case 'unsupported-version':
      return { key: 'import.error.unsupportedVersion' };
    case 'invalid-scene': {
      const path = error.path ?? 'scene';
      const field = path.split('.').at(-1);
      if (field === 'teeth') return { key: 'import.error.invalidScene.teeth', params: { path } };
      if (field === 'rpm') return { key: 'import.error.invalidScene.rpm', params: { path } };
      return { key: 'import.error.invalidScene', params: { path } };
    }
  }
}

export function createJsonIo(deps: JsonIoDeps): JsonIo {
  const now = deps.now ?? (() => new Date());

  function exportScene(): void {
    const { scene, currentWork } = deps.store.getState();
    deps.download(
      exportFileName(now(), currentWork?.name ?? null),
      serializeSaveFile(toSaveFile(scene)),
    );
  }

  function reject(error: SaveFileError, cause?: unknown): false {
    console.warn('JSON ファイルを読み込めなかった', error, cause ?? '');
    const message = importErrorMessage(error);
    deps.showToast(message.key, 'error', message.params);
    return false;
  }

  async function importFile(file: ImportSource): Promise<boolean> {
    // 5 MB を超えたら読まない
    if (file.size > MAX_SAVE_FILE_BYTES) return reject({ code: 'too-large' });
    let text: string;
    try {
      text = await file.text();
    } catch (cause) {
      return reject({ code: 'invalid-json' }, cause);
    }
    const parsed = parseSaveFile(text);
    if (!parsed.ok) return reject(parsed.error);
    // replaceScene で読み込む（Undo で読み込む前のシーンに戻せる）。「いま開いている作品」はなしにする
    deps.store.dispatch({
      type: 'command',
      command: { type: 'replaceScene', scene: parsed.file.scene },
    });
    deps.store.dispatch({ type: 'setCurrentWork', work: null });
    deps.fitAll();
    return true;
  }

  return { exportScene, importFile };
}
