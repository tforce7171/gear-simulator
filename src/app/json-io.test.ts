import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeSaveFile, toSaveFile } from '../core/io/save-file';
import { emptyScene } from '../core/scene/scene';
import { demoScene } from './demo-scene';
import { createJsonIo, importErrorMessage } from './json-io';
import { createStore } from './store';

function setup(scene = emptyScene()) {
  const store = createStore(scene);
  const download = vi.fn();
  const fitAll = vi.fn();
  const showToast = vi.fn();
  const io = createJsonIo({
    store,
    download,
    fitAll,
    showToast,
    now: () => new Date(2026, 9, 27, 9, 5, 3),
  });
  return { store, download, fitAll, showToast, io };
}

function source(text: string, size = new Blob([text]).size) {
  return { size, text: async () => text };
}

describe('createJsonIo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('エクスポート: 作品が無ければ日時の名前で SaveFile の JSON', () => {
    const { io, download } = setup(demoScene);
    io.exportScene();
    expect(download).toHaveBeenCalledWith(
      'gear-simulator-20261027-090503.json',
      serializeSaveFile(toSaveFile(demoScene)),
    );
  });

  it('エクスポート: いま開いている作品があれば <作品名>.json', () => {
    const { io, download, store } = setup(demoScene);
    store.dispatch({ type: 'setCurrentWork', work: { id: 'work_1', name: '時計/試作' } });
    io.exportScene();
    expect(download.mock.calls[0]?.[0]).toBe('時計_試作.json');
  });

  it('インポート: replaceScene で読み込み、Undo で戻せる。作品はなし、全体表示', async () => {
    const { io, store, fitAll, showToast } = setup();
    store.dispatch({ type: 'setCurrentWork', work: { id: 'work_1', name: 'a' } });
    expect(await io.importFile(source(serializeSaveFile(toSaveFile(demoScene))))).toBe(true);
    expect(store.getState().scene).toEqual(demoScene);
    expect(store.getState().currentWork).toBeNull();
    expect(fitAll).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
    store.dispatch({ type: 'undo' });
    expect(store.getState().scene).toEqual(emptyScene());
  });

  it('インポートの失敗: トーストを出し、シーンは変えない。console.warn だけ', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    const { io, store, showToast, fitAll } = setup(demoScene);
    const before = store.getState().scene;
    expect(await io.importFile(source('not json'))).toBe(false);
    expect(showToast).toHaveBeenCalledWith('import.error.invalidJson', 'error', undefined);
    expect(store.getState().scene).toBe(before);
    expect(fitAll).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('5 MB を超えるファイルは読まずに too-large', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { io, showToast } = setup();
    const text = vi.fn(async () => '{}');
    expect(await io.importFile({ size: 5 * 1024 * 1024 + 1, text })).toBe(false);
    expect(text).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('import.error.tooLarge', 'error', undefined);
  });

  it('読み込みが失敗したら invalid-json の文言', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { io, showToast } = setup();
    const text = async (): Promise<string> => {
      throw new Error('read error');
    };
    expect(await io.importFile({ size: 10, text })).toBe(false);
    expect(showToast).toHaveBeenCalledWith('import.error.invalidJson', 'error', undefined);
  });
});

describe('importErrorMessage', () => {
  it('理由ごとの文言', () => {
    expect(importErrorMessage({ code: 'too-large' }).key).toBe('import.error.tooLarge');
    expect(importErrorMessage({ code: 'invalid-json' }).key).toBe('import.error.invalidJson');
    expect(importErrorMessage({ code: 'not-gear-simulator' }).key).toBe(
      'import.error.notGearSimulator',
    );
    expect(importErrorMessage({ code: 'invalid-version' }).key).toBe('import.error.invalidVersion');
    expect(importErrorMessage({ code: 'unsupported-version' }).key).toBe(
      'import.error.unsupportedVersion',
    );
  });

  it('シーンの検証の失敗は場所で詳しくする', () => {
    expect(importErrorMessage({ code: 'invalid-scene', path: 'gears.gear_1.teeth' })).toEqual({
      key: 'import.error.invalidScene.teeth',
      params: { path: 'gears.gear_1.teeth' },
    });
    expect(importErrorMessage({ code: 'invalid-scene', path: 'motors.motor_1.rpm' }).key).toBe(
      'import.error.invalidScene.rpm',
    );
    expect(importErrorMessage({ code: 'invalid-scene', path: 'gears.gear_1.shaftId' })).toEqual({
      key: 'import.error.invalidScene',
      params: { path: 'gears.gear_1.shaftId' },
    });
    expect(importErrorMessage({ code: 'invalid-scene' }).params).toEqual({ path: 'scene' });
  });
});
