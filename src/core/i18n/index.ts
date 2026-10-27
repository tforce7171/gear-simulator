// 辞書と翻訳関数（design.md §8）。純粋関数のみ
import { en } from './en';
import { ja, type MessageKey } from './ja';

export type { MessageKey } from './ja';

export type Lang = 'ja' | 'en';
export type MessageParams = Readonly<Record<string, string | number>>;

const dictionaries: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = { ja, en };

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

// ブラウザの言語が ja で始まれば日本語、それ以外（空・未定義を含む）は英語。大文字小文字を区別しない
export function detectLanguage(browserLanguage: string | undefined): Lang {
  return browserLanguage?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

// {name} を params.name で置き換える。params に無い差し込みはそのまま残す
export function interpolate(message: string, params?: MessageParams): string {
  if (params === undefined) return message;
  return message.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

export function translate(lang: Lang, key: MessageKey, params?: MessageParams): string {
  return interpolate(dictionaries[lang][key], params);
}

// 文字列に含まれる差し込みの名前（重複なし、現れた順）。テストと検証用
export function placeholdersOf(message: string): string[] {
  const names: string[] = [];
  for (const match of message.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
