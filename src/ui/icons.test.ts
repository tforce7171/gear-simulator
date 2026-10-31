import { describe, expect, it } from 'vitest';
import { PALETTE_KIND_LIST } from '../core/layout/candidates';
import type { SizeKey } from '../core/scene/types';
import { PALETTE_KIND_ICONS, ROOT_SHAFT_ICON, SIZE_ICONS } from './icons';

// S4-08: パレットのアイコン。種類を足したときの書き忘れは Record の型でも検出する
const SIZES: readonly SizeKey[] = ['S', 'M', 'L'];

function expectIcon(svg: string | undefined, name: string): void {
  expect(svg, `${name} のアイコンがある`).toBeTypeOf('string');
  const s = svg ?? '';
  expect(s.startsWith('<svg'), `${name}: SVG`).toBe(true);
  expect(s.endsWith('</svg>'), `${name}: SVG が閉じている`).toBe(true);
  expect(s).toContain('viewBox="0 0 24 24"');
  // 色はテーマ・選択の状態（文字の色）に従う。色を直に書かない
  expect(s, `${name}: currentColor で描く`).toContain('currentColor');
  expect(s, `${name}: 色を直に書かない`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  // 読み上げ・ボタンの文字に混ざらない（文字のラベルはそのまま残す）
  expect(s).toContain('aria-hidden="true"');
  expect(s).not.toMatch(/<text|<title/);
}

describe('パレットのアイコン（S4-08）', () => {
  it('パレットの種類の一覧のすべてにアイコンがある', () => {
    expect(PALETTE_KIND_LIST.length).toBe(9);
    for (const kind of PALETTE_KIND_LIST) expectIcon(PALETTE_KIND_ICONS[kind], kind);
  });

  it('アイコンの表に一覧に無い種類が無い（一覧と表が同じ）', () => {
    expect(Object.keys(PALETTE_KIND_ICONS).sort()).toEqual([...PALETTE_KIND_LIST].sort());
  });

  it('種類ごとに違う絵', () => {
    const svgs = PALETTE_KIND_LIST.map((k) => PALETTE_KIND_ICONS[k]);
    expect(new Set(svgs).size).toBe(svgs.length);
  });

  it('大きさ S/M/L のすべてにアイコンがあり、それぞれ違う絵', () => {
    for (const size of SIZES) expectIcon(SIZE_ICONS[size], `size-${size}`);
    expect(new Set(SIZES.map((s) => SIZE_ICONS[s])).size).toBe(3);
  });

  it('起点のシャフトにアイコンがある', () => {
    expectIcon(ROOT_SHAFT_ICON, 'rootShaft');
  });
});
