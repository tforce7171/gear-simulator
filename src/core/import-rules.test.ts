import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Biome の noRestrictedImports で表しきれない規則を補う（design.md §1）
const CORE_DIR = dirname(fileURLToPath(import.meta.url));

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// この検査ファイル自身は禁止パターンを文字列として持つので除外する
const SELF = fileURLToPath(import.meta.url);
const files = listTsFiles(CORE_DIR).filter((f) => f !== SELF);

const FORBIDDEN_MODULES: readonly RegExp[] = [
  /from\s+['"]three['"]/,
  /from\s+['"]three\//,
  /from\s+['"]camera-controls['"]/,
  /import\s*\(\s*['"](three|three\/[^'"]*|camera-controls)['"]\s*\)/,
];

const FORBIDDEN_GLOBALS: readonly RegExp[] = [
  /\bwindow\./,
  /\bdocument\./,
  /\bindexedDB\b/,
  /\blocalStorage\b/,
  /\bAudioContext\b/,
];

// import / export ... from '...'、import '...'、import('...') の指定子を取り出す
const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

function relativeImportsOutsideCore(file: string, source: string): string[] {
  const bad: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const spec = match[1];
    if (spec === undefined || !spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    const rel = relative(CORE_DIR, target);
    if (rel === '..' || rel.startsWith(`..${sep}`)) bad.push(spec);
  }
  return bad;
}

describe('src/core の import 規則', () => {
  it('検査する対象のファイルがある', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('three・camera-controls を import しない', () => {
    const violations = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return FORBIDDEN_MODULES.some((re) => re.test(src));
    });
    expect(violations.map((f) => relative(CORE_DIR, f))).toEqual([]);
  });

  it('src/core の外への相対 import をしない', () => {
    const violations = files.flatMap((f) =>
      relativeImportsOutsideCore(f, readFileSync(f, 'utf8')).map(
        (spec) => `${relative(CORE_DIR, f)}: ${spec}`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it('ブラウザのグローバル（window・document・indexedDB・localStorage・AudioContext）を使わない', () => {
    const violations = files.flatMap((f) => {
      const src = readFileSync(f, 'utf8');
      return FORBIDDEN_GLOBALS.filter((re) => re.test(src)).map(
        (re) => `${relative(CORE_DIR, f)}: ${re.source}`,
      );
    });
    expect(violations).toEqual([]);
  });
});
