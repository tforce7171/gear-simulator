import { MAX_SAVE_FILE_BYTES } from '../constants';
import { parseScene } from '../scene/parse';
import type { Scene } from '../scene/types';

// 保存形式（design.md §9）。JSON のエクスポート、作品と自動保存はすべてこの形式を使う。
// 読み込みは parseSaveFile（文字列）→ parseSaveFileObject の 1 か所で、
// 形式の確認 → migrate で最新版まで変換 → core/scene の parseScene（形と意味の検証）の順に通す。
// 検証の規則は core/scene に置き、ここには重ねて書かない

// 2: 段階 2 の歯車（ハスバ・かさ・ウォーム・ホイール・ねじ歯車）と bevel・skew の配置（S2-05）
// 3: 段階 3 の部品（固定具 anchors・キャリア carriers・ラック racks のコレクションと、内歯車・concentric・planet・rack の
//    配置）。3 つのコレクションは必須（S3-05）
export const CURRENT_SAVE_VERSION = 3;

export interface SaveFile {
  readonly format: 'gear-simulator';
  readonly version: number; // 1 から始める
  readonly scene: Scene;
}

export type SaveFileErrorCode =
  | 'too-large' // 5 MB 超
  | 'invalid-json' // JSON として読めない
  | 'not-gear-simulator' // format が違う、オブジェクトでない
  | 'invalid-version' // version が 1 以上の整数でない
  | 'unsupported-version' // 最新より新しい（または移行が無い）
  | 'invalid-scene'; // 検証の失敗

export interface SaveFileError {
  readonly code: SaveFileErrorCode;
  readonly path?: string; // 'gears.gear_1.teeth' の形（invalid-scene のとき）
}

export type ParseResult =
  | { readonly ok: true; readonly file: SaveFile; readonly migratedFrom: number | null }
  | { readonly ok: false; readonly error: SaveFileError };

// バージョン n の生データ → n+1 の生データ
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

// 1 → 2（S2-05）: version 1 のシーンは平歯車と root・mesh・detached だけで、version 2 の形にそのまま含まれるので
// 中身は変えない（version は migrate が書き換える）。段階 2 の部品は version 2 の parseScene・validateScene が検証する
const v1ToV2: Migration = (raw) => raw;

// 2 → 3（S3-05）: anchors・carriers・racks のコレクションを {} で足す。S3-01〜S3-04 の間に version 2 のまま保存された
// ファイルは、すでに持っていればそのまま残す（そのときの parseScene は無いものを {} で補って読んでいた）。
// 中身の検証は version 3 の parseScene・validateScene が行う。scene がオブジェクトでなければそのまま渡して、そこで弾く
const v2ToV3: Migration = (raw) => {
  const scene = raw.scene;
  if (!isPlainObject(scene)) return raw;
  return {
    ...raw,
    scene: {
      ...scene,
      anchors: scene.anchors ?? {},
      carriers: scene.carriers ?? {},
      racks: scene.racks ?? {},
    },
  };
};

export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: v1ToV2, 2: v2ToV3 };

export function toSaveFile(scene: Scene): SaveFile {
  return { format: 'gear-simulator', version: CURRENT_SAVE_VERSION, scene };
}

// 2 スペースの字下げ、末尾に改行
export function serializeSaveFile(file: SaveFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function fail(code: SaveFileErrorCode, path?: string): { ok: false; error: SaveFileError } {
  return { ok: false, error: path === undefined ? { code } : { code, path } };
}

// UTF-8 にしたときのバイト数
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      bytes += 4; // サロゲートペア
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function isTooLarge(text: string): boolean {
  // UTF-16 の 1 単位は UTF-8 で 1〜3 バイトなので、長さだけで決まることが多い
  if (text.length > MAX_SAVE_FILE_BYTES) return true;
  if (text.length * 3 <= MAX_SAVE_FILE_BYTES) return false;
  return utf8Length(text) > MAX_SAVE_FILE_BYTES;
}

// version から latest まで順に移行する。version の確かめもここで行う
export function migrate(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  latest: number = CURRENT_SAVE_VERSION,
): { ok: true; raw: Record<string, unknown>; from: number } | { ok: false; error: SaveFileError } {
  const from = raw.version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return fail('invalid-version');
  }
  if (from > latest) return fail('unsupported-version');
  let current = raw;
  for (let n = from; n < latest; n += 1) {
    const step = Object.hasOwn(migrations, n) ? migrations[n] : undefined;
    if (step === undefined) return fail('unsupported-version');
    try {
      current = { ...step(current), version: n + 1 };
    } catch {
      return fail('invalid-scene');
    }
  }
  return { ok: true, raw: current, from };
}

// IndexedDB から読んだ値（自動保存・作品）と、parseSaveFile が JSON から作った値の読み込み。例外を投げない
export function parseSaveFileObject(raw: unknown): ParseResult {
  if (!isPlainObject(raw) || raw.format !== 'gear-simulator') return fail('not-gear-simulator');
  const migrated = migrate(raw);
  if (!migrated.ok) return migrated;
  const parsed = parseScene(migrated.raw.scene);
  if (!parsed.ok) {
    const path = parsed.errors[0]?.path;
    return fail('invalid-scene', path === '' ? undefined : path);
  }
  return {
    ok: true,
    file: toSaveFile(parsed.scene),
    migratedFrom: migrated.from === CURRENT_SAVE_VERSION ? null : migrated.from,
  };
}

// JSON の文字列（インポートしたファイル）の読み込み。5 MB を超えたら解析しない。例外を投げない
export function parseSaveFile(text: string): ParseResult {
  if (isTooLarge(text)) return fail('too-large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('invalid-json');
  }
  return parseSaveFileObject(raw);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

// ファイル名に使えない文字（\ / : * ? " < > | と制御文字）
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を置き換えるため
const INVALID_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

// エクスポートのファイル名。作品名があれば <作品名>.json、なければ gear-simulator-YYYYMMDD-HHmmss.json（ローカル時刻）
export function exportFileName(now: Date, workName: string | null): string {
  if (workName !== null) {
    const name = workName
      .replace(INVALID_FILE_CHARS, '_')
      .trim()
      .replace(/[.\s]+$/, '');
    if (name !== '') return `${name}.json`;
  }
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `gear-simulator-${date}-${time}.json`;
}
