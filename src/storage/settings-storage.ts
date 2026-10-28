// 設定の localStorage への読み書き（S1-30、design.md §9）。失敗はすべて想定内なので例外を外に出さず、
// console.warn にとどめる（design.md §7）
import {
  parseSettings,
  SETTINGS_STORAGE_KEY,
  type Settings,
  serializeSettings,
} from '../core/settings';

// localStorage を返す。アクセスするだけで投げる環境（サイトデータを禁止したときなど）では undefined
export function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch (error) {
    console.warn('localStorage を使えない', error);
    return undefined;
  }
}

// 保存された設定を読む。storage が無い・getItem が投げる・JSON が壊れている → defaults。
// 項目ごとの検証は parseSettings
export function loadSettings(storage: Storage | undefined, defaults: Settings): Settings {
  if (storage === undefined) return defaults;
  let text: string | null;
  try {
    text = storage.getItem(SETTINGS_STORAGE_KEY);
  } catch (error) {
    console.warn('設定を読めなかった', error);
    return defaults;
  }
  if (text === null) return defaults;
  try {
    return parseSettings(JSON.parse(text), defaults);
  } catch (error) {
    console.warn('保存された設定が壊れている', error);
    return defaults;
  }
}

// 設定を書く。書けたら true、書けなかったら（setItem が投げた）false。storage が無ければ何もせず true
// （使えないことは読むときに分かっているので、書くたびに知らせない）
export function saveSettings(storage: Storage | undefined, settings: Settings): boolean {
  if (storage === undefined) return true;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, serializeSettings(settings));
    return true;
  } catch (error) {
    console.warn('設定を保存できなかった', error);
    return false;
  }
}
