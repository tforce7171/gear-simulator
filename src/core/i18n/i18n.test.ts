import { describe, expect, expectTypeOf, it } from 'vitest';
import { en } from './en';
import {
  detectLanguage,
  interpolate,
  type Lang,
  type MessageKey,
  placeholdersOf,
  translate,
} from './index';
import { ja } from './ja';

const keys = Object.keys(ja) as MessageKey[];
const langs: readonly Lang[] = ['ja', 'en'];

describe('detectLanguage', () => {
  it.each(['ja', 'ja-JP', 'JA-jp'])('%s は日本語', (lang) => {
    expect(detectLanguage(lang)).toBe('ja');
  });

  it.each(['en-US', 'fr', '', undefined])('%s は英語', (lang) => {
    expect(detectLanguage(lang)).toBe('en');
  });
});

describe('translate', () => {
  it('app.title を各言語で引ける', () => {
    expect(translate('ja', 'app.title')).toBe('歯車シミュレーター');
    expect(translate('en', 'app.title')).toBe('Gear Simulator');
  });

  it('{count} を params.count で置き換える', () => {
    const out = interpolate('{count} 個の歯車', { count: 3 });
    expect(out).toContain('3');
    expect(out).toBe('3 個の歯車');
  });

  it('同じ差し込みが何度あってもすべて置き換える', () => {
    expect(interpolate('{a}-{b}-{a}', { a: 'x', b: 1 })).toBe('x-1-x');
  });

  it('足りない差し込みは {name} のまま残る', () => {
    expect(interpolate('{count} / {name}', { count: 3 })).toBe('3 / {name}');
    expect(interpolate('{name}')).toBe('{name}');
    expect(interpolate('{name}', {})).toBe('{name}');
  });

  it('params を渡しても差し込みの無い文字列は変わらない', () => {
    for (const lang of langs) {
      expect(translate(lang, 'app.title', { count: 3 })).toBe(translate(lang, 'app.title'));
    }
  });
});

describe('placeholdersOf', () => {
  it('差し込みの名前を重複なく返す', () => {
    expect(placeholdersOf('{a} と {b} と {a}')).toEqual(['a', 'b']);
    expect(placeholdersOf('差し込みなし')).toEqual([]);
  });
});

describe('辞書', () => {
  it('ja と en が同じキーをちょうど持つ', () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort());
  });

  it.each(keys)('%s の値は ja・en とも空文字でない', (key) => {
    expect(ja[key]).not.toBe('');
    expect(en[key]).not.toBe('');
  });

  it.each(keys)('%s の差し込みは ja と en で同じ集合', (key) => {
    expect(new Set(placeholdersOf(en[key]))).toEqual(new Set(placeholdersOf(ja[key])));
  });

  // S5-02: プロパティパネルの文言には括弧書きを使わない
  it.each(keys.filter((key) => key.startsWith('properties.')))(
    '%s の値は ja・en とも括弧を含まない（S5-02）',
    (key) => {
      expect(ja[key]).not.toMatch(/[（）()]/);
      expect(en[key]).not.toMatch(/[（）()]/);
    },
  );
});

describe('型', () => {
  it('存在しないキーは型エラーになる', () => {
    // 型の検査だけが目的なので呼ばない
    const call = () =>
      // @ts-expect-error 辞書に無いキー
      translate('ja', 'no.such.key');
    expectTypeOf(call).toBeFunction();
  });

  it('en は MessageKey をすべて持つ', () => {
    expectTypeOf(en).toExtend<Record<MessageKey, string>>();
    expectTypeOf(ja).toExtend<Record<MessageKey, string>>();
  });
});
