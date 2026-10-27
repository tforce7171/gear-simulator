import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, onLanguageChange, setLanguage, t } from './i18n';

const initial = getLanguage();
afterEach(() => setLanguage(initial));

describe('app/i18n', () => {
  it('t は現在の言語で引く', () => {
    setLanguage('ja');
    expect(t('app.title')).toBe('歯車シミュレーター');
    setLanguage('en');
    expect(t('app.title')).toBe('Gear Simulator');
    expect(getLanguage()).toBe('en');
  });

  it('言語が変わったときだけ知らせ、解除後は知らせない', () => {
    setLanguage('ja');
    const listener = vi.fn();
    const off = onLanguageChange(listener);
    setLanguage('ja');
    expect(listener).not.toHaveBeenCalled();
    setLanguage('en');
    expect(listener).toHaveBeenCalledExactlyOnceWith('en');
    off();
    setLanguage('ja');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
