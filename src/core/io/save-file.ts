import type { Scene } from '../scene/types';
import { validateScene } from '../scene/validate';

// 保存形式（design.md §9）。JSON のエクスポート、作品と自動保存はすべてこの形式を使う

export const CURRENT_SAVE_VERSION = 1;

export interface SaveFile {
  readonly format: 'gear-simulator';
  readonly version: number; // 1 から始める
  readonly scene: Scene;
}

// 読み込みの失敗の理由。S1-28 が種類を足して詳しくする
export interface SaveFileError {
  readonly code: string;
}

export type ParseResult =
  | { readonly ok: true; readonly file: SaveFile }
  | { readonly ok: false; readonly error: SaveFileError };

export function toSaveFile(scene: Scene): SaveFile {
  return { format: 'gear-simulator', version: CURRENT_SAVE_VERSION, scene };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function fail(code: string): ParseResult {
  return { ok: false, error: { code } };
}

// 読み込みの 1 か所（自動保存の復元・作品を開く。S1-28 でインポートも）。例外を投げない。
// S1-28 が移行と形の確認をこの中に足す
export function parseSaveFileObject(raw: unknown): ParseResult {
  if (!isPlainObject(raw) || raw.format !== 'gear-simulator') return fail('not-gear-simulator');
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    return fail('invalid-version');
  }
  if (raw.version > CURRENT_SAVE_VERSION) return fail('unsupported-version');
  const scene = raw.scene;
  if (
    !isPlainObject(scene) ||
    !isPlainObject(scene.shafts) ||
    !isPlainObject(scene.gears) ||
    !isPlainObject(scene.motors)
  ) {
    return fail('invalid-scene');
  }
  // 部品の形までは確かめていないので、validateScene が例外を投げうる（形の確認は S1-28）
  try {
    const typed = scene as unknown as Scene;
    if (!validateScene(typed).ok) return fail('invalid-scene');
    return { ok: true, file: { format: 'gear-simulator', version: raw.version, scene: typed } };
  } catch {
    return fail('invalid-scene');
  }
}
