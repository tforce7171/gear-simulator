---
id: S1-28
title: JSON のエクスポートとインポート
status: done
depends: [S1-27]
---

# S1-28 JSON のエクスポートとインポート

## 目的
作品を JSON ファイルに書き出し、読み込めるようにする（要件 §10）。どこから来たか分からないファイルを読んでも壊れないよう、バージョンの移行と検証をここで完成させ、自動保存と作品の読み込みもこれに切り替える。

## 範囲
- **エクスポート**: ツールバーの「エクスポート」（S1-15 が置き場を用意済み）で、いまのシーンを `SaveFile` の JSON（2 スペースの字下げ、末尾に改行）としてダウンロードする。
  - ファイル名: いま開いている作品（S1-27）があれば `<作品名>.json`、なければ `gear-simulator-YYYYMMDD-HHmmss.json`（ローカル時刻）。作品名のうちファイル名に使えない文字（`\ / : * ? " < > |` と制御文字）は `_` に置き換え、前後の空白と末尾の `.` を取り、空になったら日時の名前にする。
- **インポート**: ツールバーの「インポート」で、ファイル選択（`accept=".json,application/json"`）を開く。
  - 読めたら、S1-11 の `replaceScene` で読み込み、全体表示する。Undo で読み込む前に戻せる。「いま開いている作品」はなしにする。
  - 読めなかったら、理由ごとの文言を S1-15 のトースト（`showToast`）で出し、シーンは変えない。例外を投げない。想定内の失敗なので `console.warn` にとどめ、`console.error` は出さない（design.md §7）。
- **読み込みの関数** `parseSaveFile`（文字列）→ `parseSaveFileObject`（S1-27 で作った 1 か所）: JSON の解析 → 形式の確認 → `migrate` で最新版まで順に変換 → core/scene の検証関数でシーンを検証。どの段階の失敗も `{ ok: false, error }` で返す。検証はこの流れの 1 か所だけで行い、`save-file.ts` に規則を重ねて書かない（design.md §9）。
- S1-27 の `parseSaveFileObject` の簡易な確認を、この流れに置き換える（自動保存の復元、作品を開くも同じ関数なので、そのまま同じ検証を通る）。作品を開くときに失敗したら、トーストで知らせてシーンは変えない。

### 移行
- `version` は 1 以上の整数。いまの最新は 1（`CURRENT_SAVE_VERSION`）。
- 移行は「バージョン n の生データ → n+1 の生データ」の関数を `MIGRATIONS[n]` に登録し、`version` から最新まで順に適用する。いまは登録なし。段階 3 で `anchors` を足すとき（design.md §4）に最初の移行を書く。
- 最新より新しい `version` は `unsupported-version`（新しいアプリで作られたファイル）。

### 検証の規則
検証は core/scene に集める。S1-03 の `validateScene` は型どおりの `Scene` を前提にしているので、このタスクで core/scene に「生の値（`unknown`）の形を確かめて `Scene` を作り、続けて `validateScene` を呼ぶ」関数を足す（例: `parseScene(raw: unknown)`）。`parseSaveFileObject` は `migrate` の後にこれを 1 回呼ぶ。
- 形の確認（このタスクで足す）
  - `scene` に `shafts`・`gears`・`motors` があり、それぞれ通常のオブジェクト。
  - ID の接頭辞が種類に合う（`shaft_`・`gear_`・`motor_`）。
  - シャフト: `placement.kind` が `root` / `detached` なら `origin` が数 3 つ、`axis` が `'x' | 'y' | 'z'`。`mesh` なら `parentGearId` と `childGearId` が文字列、`angle` が数（`mesh` は `axis` を持たない。design.md §4）。
  - 歯車: `kind === 'spur'`、`size` が `S | M | L`、`teeth`・`offset` が数。モーター: `size` が `S | M | L`、`rpm` が数、`direction` が数、`on` が真偽値。
  - 知らないフィールドは捨てる（返すシーンには型にあるフィールドだけを入れる。`mesh` の placement に `axis` があっても捨てる）。
- 意味の確認（S1-03 の `validateScene` の規則）: キーと `id` の一致、参照先の存在、歯数の範囲と整数、`rpm` の範囲、`direction` が `1 | -1`、モーターは 1 本に 1 個まで、`mesh` の親子の条件、配置の木に閉路がない、数値が有限。
- エラーの位置 `path`（`'gears.gear_1.teeth'` の形）は core/scene の検証関数が返す。S1-03 の `SceneError` に `path` を足す。
- ファイルが 5 MB を超えたら読まずに `too-large`。

### S1-27 で済んでいること
- `src/core/io/save-file.ts` に `SaveFile`・`CURRENT_SAVE_VERSION`・`toSaveFile`・`parseSaveFileObject` がある。`parseSaveFileObject` は今 `{ ok: true, file } | { ok: false, error: { code: string } }` を返し、`code` は `'not-gear-simulator'`・`'invalid-version'`・`'unsupported-version'`・`'invalid-scene'` の 4 種類（このタスクの `SaveFileErrorCode` と同じ名前）。結果の型を `ParseResult`（`migratedFrom` つき）に広げ、`validateScene` の例外を受ける仮の `try` を形の確認に置き換える。
- 呼んでいるのは `src/app/restore.ts`（自動保存の復元。失敗はトースト `storage.restoreFailed`）と `src/app/works.ts` の作品を開く（失敗はトースト `storage.openFailed` でシーンは変えない）。どちらも `parsed.file.scene` を使うだけなので、結果の型を広げても変えなくてよい。
- IndexedDB は `src/storage/db.ts`（データベース `gear-simulator`・バージョン 1、ストア `autosave` のキー `'current'`）。壊れた自動保存のテストで直接書くときは、ページが開いた後（`isReady` の後）に `indexedDB.open('gear-simulator', 1)` で同じストアに `put(値, 'current')` する。自動保存のデバウンスは 1 秒なので、書いた後に `loadScene` などでシーンを変えなければ上書きされない。
- 「いま開いている作品」は `AppState.currentWork`。インポートで「なしにする」のは `store.dispatch({ type: 'setCurrentWork', work: null })`。エクスポートのファイル名には `currentWork.name` を使う。

## 範囲外
- URL での共有（要件で作らない）
- ドラッグ＆ドロップでのインポート（作らない）
- 段階 2・3 の形式の拡張と移行（S2-05、S3-05）

## 作るもの
- `src/core/io/save-file.ts`（S1-27 のものに足す）
  ```ts
  export type SaveFileErrorCode =
    | 'too-large'           // 5 MB 超
    | 'invalid-json'        // JSON として読めない
    | 'not-gear-simulator'  // format が違う、オブジェクトでない
    | 'invalid-version'     // version が 1 以上の整数でない
    | 'unsupported-version' // 最新より新しい
    | 'invalid-scene';      // 検証の失敗
  export interface SaveFileError { code: SaveFileErrorCode; path?: string } // path は 'gears.gear_1.teeth' の形
  export type ParseResult =
    | { ok: true; file: SaveFile; migratedFrom: number | null }
    | { ok: false; error: SaveFileError };

  export function serializeSaveFile(file: SaveFile): string;
  export function parseSaveFile(text: string): ParseResult;
  export function parseSaveFileObject(raw: unknown): ParseResult; // IndexedDB から読んだ値用
  export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
  export const MIGRATIONS: Readonly<Record<number, Migration>>;
  export function migrate(
    raw: Record<string, unknown>,
    migrations?: Readonly<Record<number, Migration>>,
    latest?: number,
  ): { ok: true; raw: Record<string, unknown>; from: number } | { ok: false; error: SaveFileError };
  export function exportFileName(now: Date, workName: string | null): string;
  ```
- ツールバーの「エクスポート」「インポート」の動作。エラーは S1-15 のトーストで出す。
- 辞書のキー（日・英）: エラーの理由ごとの文言（6 種類）。ツールバーのボタン名（`toolbar.export`・`toolbar.export.tooltip`・`toolbar.import`・`toolbar.import.tooltip`）は S1-15 で足し済み。ボタンは `UiShell.toolbar.button('export')`・`button('import')` で受け取り、動作を付けて `disabled = false` にする。
- テスト用のフィクスチャ: `e2e/fixtures/invalid-teeth.json`（S の歯車に `teeth: 81`）、`e2e/fixtures/future-version.json`（`version: 99`）

## 受け入れ条件
- [ ] エクスポートしたファイルをインポートすると、同じシーンに戻る。
- [ ] 壊れたファイル、他のアプリのファイル、新しすぎるバージョン、範囲外の値を含むファイルを読むと、理由の分かるエラーが出て、シーンは変わらない。
- [ ] インポートは Undo で取り消せる。
- [ ] 自動保存と作品の読み込みも同じ検証を通る。

## テストケース
### Vitest
- [ ] 往復: 歯車 3 枚・モーター 1 つのシーン → `serializeSaveFile(toSaveFile(scene))` → `parseSaveFile` → `ok`、`file.scene` が元と `toEqual`、`migratedFrom === null`。空のシーンも同じ。
- [ ] `serializeSaveFile` の出力は 2 スペースの字下げで、末尾が `\n`。
- [ ] `parseSaveFile('{')` → `invalid-json`。`'null'`、`'1'`、`'[]'`、`'{}'`、`'{"format":"other","version":1}'` → `not-gear-simulator`。
- [ ] `version` が `0`、`1.5`、`"1"`、なし → `invalid-version`。`99` → `unsupported-version`。
- [ ] 6 MB の文字列 → `too-large`（JSON の解析をしない）。
- [ ] `invalid-scene` と `path`:
  - S の歯車の `teeth: 81` → `gears.<id>.teeth`。`teeth: 12.5` → 同じ。
  - 歯車の `shaftId` が存在しない → `gears.<id>.shaftId`。
  - モーターの `rpm: 0`、`rpm: 121` → `motors.<id>.rpm`。`direction: 0` → `motors.<id>.direction`。
  - `root` のシャフトの `placement.axis: 'w'` → `shafts.<id>.placement.axis`。`origin: [0, NaN, 0]`（JSON では `null`）→ `shafts.<id>.placement.origin`。
  - キーと `id` の不一致 → `gears.<key>.id`。
  - 2 本の `mesh` のシャフトが互いを親にする閉路 → `invalid-scene`（`path` はどちらかのシャフト）。
- [ ] 知らないフィールド（ルートの `extra`、歯車の `color`、`mesh` の placement の `axis`）は結果から消える。
- [ ] `migrate`: 架空の移行 `{1: v1→v2, 2: v2→v3}` と `latest = 3` を渡すと、version 1 のデータに順に適用され `from === 1`、`version === 3`。version 3 なら何もしない。移行が途中で抜けている（`{1: …}` だけで latest 3）→ `unsupported-version`。
- [ ] どんな入力でも例外を投げない: `parseSaveFileObject` に `undefined`、`null`、`0`、`'x'`、`[]`、`{ format: 'gear-simulator' }`、`{ format: 'gear-simulator', version: 1, scene: { shafts: null } }` を渡して、すべて `ok: false`。
- [ ] `exportFileName(new Date(2026, 9, 27, 9, 5, 3), null)` → `gear-simulator-20261027-090503.json`。`'a/b:c'` → `a_b_c.json`。`' . '` → 日時の名前。

### Playwright
- [ ] エクスポート → インポート: シーン A（S1-23）を読む → 「エクスポート」→ `page.waitForEvent('download')` → 中身を JSON として読み、`format === 'gear-simulator'`、`version === 1`、`scene` がシーン A と等しい → 空のシーンを読む → 「インポート」で同じファイルを `setInputFiles` → `getScene()` がシーン A と等しい → Ctrl+Z → 空のシーン。
- [ ] `invalid-teeth.json` をインポート → トーストが見え、歯数の範囲の文言を含む。`getScene()` は変わらない。
- [ ] `future-version.json` → 新しいバージョンの文言。
- [ ] 中身が `not json` のファイル → 読めないファイルの文言。
- [ ] 自動保存が壊れている（一度開いたページで `page.evaluate` から IndexedDB の `autosave` に `{ updatedAt: 0, file: { format: 'gear-simulator', version: 1, scene: { shafts: 1 } } }` を直接書き、自動保存が上書きしないうちに再読み込みする）→ 空のシーンで起動し、復元できなかったトーストが出る。
- [ ] 上のすべてでコンソールエラー 0 件。

## 人が手で確かめる項目
- 書き出したファイルを別のブラウザで読み込めるか。
- エラーの文言が、日本語・英語ともに何をすればよいか分かる表現か。

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（`parseSaveFile` の結果の型とエラーの種類、5 MB の上限、知らないフィールドを捨てることを design.md §9 に書く。S1-03 の資料の `SceneError` に `path` を足したことを書く）
- [x] `status: done` にしてコミットした
