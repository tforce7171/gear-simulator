import { describe, expect, it } from 'vitest';
import { isTypingTarget, type KeyBinding, matchesBinding } from './keyboard';

// jsdom を使わず、tagName と isContentEditable だけを持つ物で確かめる
function el(tagName: string, isContentEditable = false): EventTarget {
  return { tagName, isContentEditable } as unknown as EventTarget;
}

describe('isTypingTarget', () => {
  it('input → true', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
  });
  it('textarea・select → true', () => {
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
  });
  it('contenteditable → true', () => {
    expect(isTypingTarget(el('DIV', true))).toBe(true);
  });
  it('button → false', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
  });
  it('canvas・body → false', () => {
    expect(isTypingTarget(el('CANVAS'))).toBe(false);
    expect(isTypingTarget(el('BODY'))).toBe(false);
  });
  it('null → false', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

function key(
  patch: Partial<
    Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>
  >,
) {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...patch,
  };
}

describe('matchesBinding', () => {
  const f: KeyBinding = { key: 'f' };
  it('文字キーは event.key で、大文字・小文字を区別しない', () => {
    expect(matchesBinding(f, key({ key: 'f', code: 'KeyF' }))).toBe(true);
    expect(matchesBinding(f, key({ key: 'F', code: 'KeyF', shiftKey: true }))).toBe(true);
    // 配列の違うキーボードで KeyF の位置に別の文字があっても、文字で判定する
    expect(matchesBinding(f, key({ key: 'u', code: 'KeyF' }))).toBe(false);
  });
  it('Ctrl・Alt は指定しなければ押されていないこと', () => {
    expect(matchesBinding(f, key({ key: 'f', ctrlKey: true }))).toBe(false);
    expect(matchesBinding(f, key({ key: 'f', metaKey: true }))).toBe(false);
    expect(matchesBinding(f, key({ key: 'f', altKey: true }))).toBe(false);
  });
  it('ctrl: true は Ctrl か Meta（Mac の Cmd）', () => {
    const undo: KeyBinding = { key: 'z', ctrl: true, shift: false };
    expect(matchesBinding(undo, key({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(matchesBinding(undo, key({ key: 'z', metaKey: true }))).toBe(true);
    expect(matchesBinding(undo, key({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe(false);
  });
  it('名前のあるキー（Home）', () => {
    expect(matchesBinding({ key: 'Home' }, key({ key: 'Home', code: 'Home' }))).toBe(true);
    expect(matchesBinding({ key: 'Home' }, key({ key: 'End', code: 'End' }))).toBe(false);
  });
  it('テンキーは event.code', () => {
    const numpad7: KeyBinding = { code: 'Numpad7' };
    expect(matchesBinding(numpad7, key({ key: '7', code: 'Numpad7' }))).toBe(true);
    expect(matchesBinding(numpad7, key({ key: '7', code: 'Digit7' }))).toBe(false);
  });
});
