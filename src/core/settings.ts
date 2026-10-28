// 設定（design.md §7 の Settings、§9 の保存の形。S1-30）。純粋関数のみ（ブラウザの保存領域には触れない。読み書きは storage/settings-storage.ts）
import { detectLanguage, type Lang } from './i18n';
import { DEFAULT_QUALITY, DEFAULT_THEME, type Quality, THEME_IDS, type ThemeId } from './theme';

export const SETTINGS_STORAGE_KEY = 'gear-simulator:settings';
export const SETTINGS_VERSION = 1;

// 入力デバイス（S1-14）。'auto' はホイールの入力から判別する
export type InputDeviceSetting = 'auto' | 'mouse' | 'trackpad';
// トラックパッドの 2 本指スクロールの割り当て（S1-14）
export type TrackpadScroll = 'pan' | 'orbit';

export const INPUT_DEVICE_SETTINGS: readonly InputDeviceSetting[] = ['auto', 'mouse', 'trackpad'];
export const TRACKPAD_SCROLLS: readonly TrackpadScroll[] = ['pan', 'orbit'];
export const QUALITIES: readonly Quality[] = ['high', 'low'];
export const LANGS: readonly Lang[] = ['ja', 'en'];

export interface Settings {
  readonly quality: Quality; // 描画の品質（S1-24）
  readonly inputDevice: InputDeviceSetting; // 入力デバイス（S1-14）
  readonly trackpadScroll: TrackpadScroll; // 2 本指スクロールの割り当て（S1-14）
  readonly language: Lang; // 画面の言語（S1-12。S1-30 で設定に入れた）
  readonly theme: ThemeId; // テーマ（S1-24）
  readonly muted: boolean; // ミュート（S1-25。設定画面には置かないが保存する）
}

// 初期値。言語だけブラウザの言語で決まる（design.md §8）
export function defaultSettings(navigatorLanguage: string): Settings {
  return {
    quality: DEFAULT_QUALITY,
    inputDevice: 'auto',
    trackpadScroll: 'pan',
    language: detectLanguage(navigatorLanguage),
    theme: DEFAULT_THEME,
    muted: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

// 保存された値（JSON.parse の結果）から設定を作る。オブジェクトでない・version が SETTINGS_VERSION で
// ない → defaults。項目ごとに検証し、不正な値・欠けた項目はその項目だけ defaults の値にする。
// 知らない項目は捨てる
export function parseSettings(raw: unknown, defaults: Settings): Settings {
  if (!isRecord(raw) || raw.version !== SETTINGS_VERSION) return defaults;
  return {
    quality: oneOf(QUALITIES, raw.quality, defaults.quality),
    inputDevice: oneOf(INPUT_DEVICE_SETTINGS, raw.inputDevice, defaults.inputDevice),
    trackpadScroll: oneOf(TRACKPAD_SCROLLS, raw.trackpadScroll, defaults.trackpadScroll),
    language: oneOf(LANGS, raw.language, defaults.language),
    theme: oneOf(THEME_IDS, raw.theme, defaults.theme),
    muted: typeof raw.muted === 'boolean' ? raw.muted : defaults.muted,
  };
}

// 保存領域に書く JSON（{ version, ...settings }）
export function serializeSettings(settings: Settings): string {
  const { quality, inputDevice, trackpadScroll, language, theme, muted } = settings;
  return JSON.stringify({
    version: SETTINGS_VERSION,
    quality,
    inputDevice,
    trackpadScroll,
    language,
    theme,
    muted,
  });
}
