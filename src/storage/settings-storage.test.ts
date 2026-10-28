import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, SETTINGS_STORAGE_KEY, type Settings } from '../core/settings';
import { loadSettings, saveSettings } from './settings-storage';

const d = defaultSettings('ja-JP');

// getItem・setItem だけを持つ偽の Storage
function fakeStorage(overrides: Partial<Storage>): Storage {
  const data = new Map<string, string>();
  const base = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  return { ...base, ...overrides } as unknown as Storage;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadSettings', () => {
  it('storage が undefined → 初期値', () => {
    expect(loadSettings(undefined, d)).toBe(d);
  });

  it('getItem が投げる → 初期値（warn だけ）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    const storage = fakeStorage({
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadSettings(storage, d)).toBe(d);
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("'{bad' を返す → 初期値", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = fakeStorage({ getItem: () => '{bad' });
    expect(loadSettings(storage, d)).toBe(d);
  });

  it('保存が無い → 初期値', () => {
    expect(loadSettings(fakeStorage({}), d)).toBe(d);
  });

  it('保存した値を読み戻せる', () => {
    const storage = fakeStorage({});
    const changed: Settings = { ...d, theme: 'wood', muted: true, language: 'en' };
    expect(saveSettings(storage, changed)).toBe(true);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toContain('"version":1');
    expect(loadSettings(storage, d)).toEqual(changed);
  });
});

describe('saveSettings', () => {
  it('setItem が投げる → 例外を外に出さず false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = fakeStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => saveSettings(storage, d)).not.toThrow();
    expect(saveSettings(storage, d)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('undefined → 何もしない', () => {
    expect(() => saveSettings(undefined, d)).not.toThrow();
    expect(saveSettings(undefined, d)).toBe(true);
  });
});
