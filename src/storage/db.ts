// IndexedDB の読み書き（S1-27、design.md §9）。`gear-simulator` データベースのバージョン 1。
// works: 作品（keyPath id）、autosave: キー 'current' の { updatedAt, file } の 1 件だけ。
// 使えない（プライベートモードなど）ときは、どの関数も reject する（呼ぶ側がトーストで知らせる）
import type { SaveFile } from '../core/io/save-file';

export const DB_NAME = 'gear-simulator';
export const DB_VERSION = 1;
const WORKS = 'works';
const AUTOSAVE = 'autosave';
const AUTOSAVE_KEY = 'current';

export interface WorkRecord {
  id: string;
  name: string;
  updatedAt: number;
  thumbnail: Blob;
  file: SaveFile;
}
export type WorkSummary = Omit<WorkRecord, 'file'>;

let opening: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (opening !== null) return opening;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    // indexedDB が無い・open が例外を投げる環境も reject にする
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKS)) db.createObjectStore(WORKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUTOSAVE)) db.createObjectStore(AUTOSAVE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // 別のタブが新しいバージョンで開いたら閉じて、次に呼ばれたときに開き直す
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB を開けない'));
    request.onblocked = () => reject(new Error('IndexedDB が他のタブに止められている'));
  });
  opening = promise;
  // 失敗したら覚えず、次に呼ばれたときに開き直す
  promise.catch(() => {
    if (opening === promise) opening = null;
  });
  return promise;
}

// 1 つのトランザクションで store を使い、完了（書き込みが確定）したら結果を返す
async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest | undefined,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(request?.result as T);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB の処理に失敗した'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB の処理が中止された'));
  });
}

// updatedAt の降順。一覧には SaveFile を含めない
export async function listWorks(): Promise<WorkSummary[]> {
  const all = await withStore<WorkRecord[]>(WORKS, 'readonly', (store) => store.getAll());
  return all
    .map(({ id, name, updatedAt, thumbnail }) => ({ id, name, updatedAt, thumbnail }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getWork(id: string): Promise<WorkRecord | undefined> {
  return withStore<WorkRecord | undefined>(WORKS, 'readonly', (store) => store.get(id));
}

export async function putWork(work: WorkRecord): Promise<void> {
  await withStore(WORKS, 'readwrite', (store) => store.put(work));
}

// 名前だけを変える（更新日時は変えない）。無い ID は何もしない
export async function renameWork(id: string, name: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(WORKS, 'readwrite');
    const store = tx.objectStore(WORKS);
    const request = store.get(id);
    request.onsuccess = () => {
      const work = request.result as WorkRecord | undefined;
      if (work !== undefined) store.put({ ...work, name });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB の処理に失敗した'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB の処理が中止された'));
  });
}

export async function deleteWork(id: string): Promise<void> {
  await withStore(WORKS, 'readwrite', (store) => store.delete(id));
}

// キー 'current' の file。無ければ undefined。形は確かめないので parseSaveFileObject に渡す
export async function loadAutosave(): Promise<unknown> {
  const record = await withStore<unknown>(AUTOSAVE, 'readonly', (store) => store.get(AUTOSAVE_KEY));
  if (record === undefined) return undefined;
  if (typeof record !== 'object' || record === null) return record;
  return (record as { file?: unknown }).file;
}

export async function saveAutosave(file: SaveFile): Promise<void> {
  await withStore(AUTOSAVE, 'readwrite', (store) =>
    store.put({ updatedAt: Date.now(), file }, AUTOSAVE_KEY),
  );
}
