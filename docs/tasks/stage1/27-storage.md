---
id: S1-27
title: 保存（IndexedDB）
status: done
depends: [S1-11, S1-15]
---

# S1-27 保存（IndexedDB）

## 目的
作業中のシーンを自動で保存して起動時に戻し、名前とサムネイル付きの作品として残せるようにする（要件 §10、design.md §9）。

## 範囲
- IndexedDB の `gear-simulator` データベース（バージョン 1。design.md §9）
  - `works` ストア（keyPath `id`）: `{ id, name, updatedAt, thumbnail: Blob, file: SaveFile }`
  - `autosave` ストア: キー `'current'` の 1 件だけ。`{ updatedAt, file: SaveFile }`
- **自動保存**: シーンの参照が変わってから `AUTOSAVE_DEBOUNCE_MS`（1000 ms）後に、最後のシーンを 1 回だけ書く。続けて変わったら待ち直す。`pagehide` と `visibilitychange`（hidden）のときは待たずにすぐ書く（書き切れなくてもよい）。
- **起動時の復元**: 最初の描画の前に `autosave` を読み、あればそのシーンで始める。履歴は空。読めない・壊れているときは空のシーンで始め、S1-15 のトースト（`showToast`）で 1 回知らせる（「自動保存を復元できなかった」）。`console.warn` は可、`console.error` は出さない。
- **作品として保存**: ツールバーの「保存」（S1-15 が置き場を用意済み）。
  - いま開いている作品がなければ、名前を入れるダイアログを出す（初期値「作品 1」のように、既存の名前と重ならない番号）。保存すると、それが「いま開いている作品」になる。
  - いま開いている作品があれば、ダイアログに名前（変更可）と「上書き保存」「新しい作品として保存」を出す。
  - サムネイル: その時点の画面から 256×256（`THUMBNAIL_SIZE`）の PNG を作る。キャンバスの中央から正方形を切り出して縮める。撮る間は選択の強調・候補・ハンドル・情報表示を隠す（情報表示の矢印は `Renderer.setInfoArrows([])`、ラベルは DOM なので canvas の画には入らない。S1-23）。
- **作品一覧**: ツールバーの「作品一覧」でダイアログを開く。
  - カード: サムネイル、名前、更新日時（言語に合わせた書式）、「開く」「名前を変更」「削除」。更新日時の新しい順。
  - 作品がないときは「保存した作品はまだない」と出す。
  - 削除は確認してから行う。いま開いている作品を消したら、「いま開いている作品」をなしにする（シーンはそのまま）。
  - 開く: S1-11 の `replaceScene` で読み込む。Undo で開く前のシーンに戻せる。開いた作品が「いま開いている作品」になる。
- 「いま開いている作品」は `AppState.currentWork: { id: string; name: string } | null` に持つ（design.md §7。保存しない。再読み込み後は null）。
- IndexedDB が使えない（プライベートモードなど）ときは、保存と一覧のボタンを押すとトースト（`showToast`）でエラーを知らせ、自動保存は止める。アプリは動き続ける。想定内の失敗なので `console.warn` にとどめ、`console.error` は出さない（design.md §7）。
- `SaveFile` の読み込み（自動保存の復元、作品を開く）は、すべて `core/io` の `parseSaveFileObject` の 1 か所を通す（design.md §9）。このタスクでは、`format === 'gear-simulator'`・`version === 1`・`scene` に `shafts`・`gears`・`motors` のオブジェクトがあることを確かめてから、S1-03 の `validateScene` を呼ぶところまで作る（形の崩れたデータで `validateScene` が例外を投げうるので、このタスクの間は例外を受けて失敗にする）。移行と形の確認は S1-28 が同じ関数の中に足す。

## 範囲外
- JSON のエクスポートとインポート、`migrate` と形の確認（S1-28。`parseSaveFileObject` の中に足すので、自動保存と作品の読み込みもそのまま同じ検証を通る）
- 設定の localStorage 保存（S1-30）
- 作品の並べ替え・検索・複製（作らない）

## 作るもの
- `src/core/io/save-file.ts`
  ```ts
  export const CURRENT_SAVE_VERSION = 1;
  export function toSaveFile(scene: Scene): SaveFile;
  // 読み込みの 1 か所。S1-28 が移行と形の確認を足し、エラーの型も S1-28 で詳しくする
  export function parseSaveFileObject(raw: unknown): { ok: true; file: SaveFile } | { ok: false; error: { code: string } };
  ```
- `src/core/io/thumbnail.ts`
  ```ts
  // 幅 w・高さ h のキャンバスから切り出す正方形
  export function centerSquareCrop(w: number, h: number): { sx: number; sy: number; size: number };
  export function nextDefaultWorkName(existing: readonly string[], base: string): string; // base = t('work.defaultName') の「作品」
  ```
- `src/storage/db.ts`
  ```ts
  export interface WorkRecord { id: string; name: string; updatedAt: number; thumbnail: Blob; file: SaveFile }
  export type WorkSummary = Omit<WorkRecord, 'file'>;
  export function openDb(): Promise<IDBDatabase>;
  export function listWorks(): Promise<WorkSummary[]>; // updatedAt の降順
  export function getWork(id: string): Promise<WorkRecord | undefined>;
  export function putWork(work: WorkRecord): Promise<void>;
  export function renameWork(id: string, name: string): Promise<void>;
  export function deleteWork(id: string): Promise<void>;
  export function loadAutosave(): Promise<unknown>; // キー 'current' の { updatedAt, file } の file。無ければ undefined。parseSaveFileObject に渡す
  export function saveAutosave(file: SaveFile): Promise<void>; // キー 'current' に { updatedAt: Date.now(), file } を書く
  ```
- `src/storage/autosave.ts`: デバウンスの仕組み。書き込み関数とタイマーを注入できる形にする
  ```ts
  export function createAutosaver(write: (scene: Scene) => Promise<void>, delayMs: number): {
    notify(scene: Scene): void; // シーンが変わったら呼ぶ
    flush(): Promise<void>;      // 待たずに書く
    pending(): boolean;
  };
  ```
- `src/ui/` に保存ダイアログ、作品一覧ダイアログ（エラーの表示は S1-15 のトーストを使う）。主な要素に `data-testid`（`save-dialog`、`works-dialog`、`work-card`、`work-open`、`work-rename`、`work-delete`）
- 辞書のキー（日・英）: ダイアログ、空の一覧、確認、エラーの文言。ツールバーのボタン名（`toolbar.save`・`toolbar.save.tooltip`・`toolbar.works`・`toolbar.works.tooltip`）は S1-15 で足し済み。ボタンは `UiShell.toolbar.button('save')`・`button('works')` で受け取り、動作を付けて `disabled = false` にする。
- `__gearSim` に追加
  ```ts
  getStorageStatus(): { lastAutosaveAt: number | null; pendingAutosave: boolean; currentWorkId: string | null };
  ```

## 受け入れ条件
- [x] 編集して 1 秒待ってから再読み込みすると、同じシーンで始まる。
- [x] 保存 → 別のシーンにする → 作品一覧から開く で、保存したシーンに戻る。Undo で開く前に戻る。
- [x] 作品一覧に、サムネイル・名前・更新日時が新しい順に並ぶ。名前の変更と削除ができる。
- [x] IndexedDB が使えなくてもアプリは動き、エラーのトーストが出る。

## テストケース
### Vitest
- [x] `toSaveFile(scene)` → `{ format: 'gear-simulator', version: 1, scene }`（scene は同じ参照でよい）。
- [x] `parseSaveFileObject`: `toSaveFile(シーン A)` → ok で同じシーン。`undefined`、`{ format: 'other' }`、`version: 2`、`scene: { shafts: 1 }`、歯数 81 の歯車を含むシーン → すべて `ok: false`（例外を投げない）。
- [x] `centerSquareCrop(1280, 800)` → `{ sx: 240, sy: 0, size: 800 }`。`(600, 900)` → `{ sx: 0, sy: 150, size: 600 }`。
- [x] `nextDefaultWorkName([], '作品')` → `作品 1`。`['作品 1', '作品 3']` → `作品 2`。
- [x] `createAutosaver`（`vi.useFakeTimers()`）: `notify` を 0・300・600 ms に 3 回 → 1599 ms までは書かない、1600 ms で 1 回だけ、最後のシーンで書く。`pending()` は書く前 true、後 false。
- [x] `flush()` は待たずに 1 回書き、その後タイマーが来ても重ねて書かない。`notify` なしの `flush()` は書かない。

### Playwright
- [x] 自動保存と復元: S1-23 のシーン A を `loadScene` → `getStorageStatus().pendingAutosave` が false になるまで待つ → 再読み込み → `getScene()` がシーン A と等しい。
- [x] 何も保存されていない状態で起動 → 空のシーン、トーストなし、コンソールエラー 0 件。
- [x] 作品の保存と読み込み: シーン A を読む → 「保存」→ 名前に `テスト作品` → 保存 → `getStorageStatus().currentWorkId` が null でない → 空のシーンを `loadScene` → 「作品一覧」→ カード 1 枚、名前 `テスト作品`、サムネイルの `img` の `naturalWidth === 256` かつ `naturalHeight === 256` → 「開く」→ `getScene()` がシーン A と等しい → Ctrl+Z → 空のシーン。
- [x] 上書きと新規: 作品を開いた状態で歯数を変えて「上書き保存」→ 一覧は 1 枚のまま、更新日時が新しくなる。「新しい作品として保存」→ 2 枚になり、新しいほうが先頭。
- [x] 名前の変更: `別の名前` に変えて一覧を開き直すと `別の名前`。削除 → 確認 → 一覧が空で「保存した作品はまだない」が出る。
- [x] IndexedDB を使えなくする（`addInitScript` で `indexedDB.open` が例外を投げるようにする）→ 起動できる、「保存」でエラーのトーストが出る、コンソールエラー 0 件。

## 人が手で確かめる項目
- サムネイルが作品を見分けられる絵になっているか（選択の枠や候補が写り込んでいないか）。
- タブを閉じる直前の編集が、次に開いたときに残っているか。

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（`__gearSim.getStorageStatus` を design.md §10 に書く）
- [x] `status: done` にしてコミットした
