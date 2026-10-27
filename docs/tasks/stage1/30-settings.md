---
id: S1-30
title: 設定画面
status: todo
depends: [S1-14, S1-24, S1-25]
---

# S1-30 設定画面

## 目的
品質・入力デバイス・2 本指スクロールの割り当て・言語・テーマを 1 か所で変えられるようにし、ミュートを含む設定を次の起動に持ち越す（要件 §7.4、§10、design.md §9）。

## 範囲
- **設定画面**: ツールバーの「設定」（S1-15 が置き場を用意済み）でダイアログを開く。
  | 項目 | 選択肢 | 初期値 | 決めたタスク |
  |---|---|---|---|
  | 品質 | 高品質 / 軽量 | 高品質 | S1-24 |
  | 入力デバイス | 自動 / マウス / トラックパッド（`inputDevice`: `'auto' \| 'mouse' \| 'trackpad'`） | 自動 | S1-14 |
  | 2 本指スクロールの割り当て | 平行移動 / 回転（`trackpadScroll`: `'pan' \| 'orbit'`） | 平行移動 | S1-14 |
  | 言語 | 日本語 / English（`language`） | ブラウザの言語（design.md §8） | S1-12（このタスクで `settings` に入れる） |
  | テーマ | 真鍮 / 木製 | 真鍮 | S1-24 |
  - 選ぶとすぐ反映する（OK・キャンセルはない）。閉じるボタンと Esc とダイアログの外のクリックで閉じる。
  - ミュートは設定画面に置かない（ツールバーと `M` キー、S1-25）が、保存はする。
  - 言語の選択肢の表示名は、いまの言語に関係なく「日本語」「English」と書く。
  - ツールバーのテーマボタン（S1-24）やミュートで変えた値も、設定画面に反映される（同じ `AppState.settings` を見る）。
- **保存**: `AppState.settings` の参照が変わったら、localStorage の `gear-simulator:settings` に JSON で書く。
  - 形: `{ "version": 1, "quality": …, "inputDevice": …, "trackpadScroll": …, "language": …, "theme": …, "muted": … }`（フィールド名は `AppState.settings` に合わせる）。
  - 起動時、最初の描画の前に読む。
  - 読み書きは try/catch で囲む。`localStorage` にアクセスできない、`getItem` が投げる、JSON が壊れている → すべて初期値。`setItem` が投げる（容量超過など）→ 書かずに続け、S1-15 のトースト（`showToast`）で「設定を保存できなかった」を 1 回だけ知らせる（起動中に何度失敗しても 1 回）。どちらも想定内の失敗なので `console.warn` にとどめ、`console.error` は出さない（design.md §7）。
  - **項目ごとに検証する**: 不正な値・欠けた項目はその項目だけ初期値にし、正しい項目は生かす。知らない項目は捨てる。
  - `version` が 1 でないときは全項目を初期値にする（形式を変えたときの移行は、そのときのタスクで書く）。
- **言語の結び付け**: S1-12 の言語は i18n のモジュールが持っている。`settings.language: Lang` を足し、起動時は保存された値（なければ `detectLanguage(navigator.language)`）で `setLanguage` を呼ぶ。設定画面や `__gearSim.setLanguage` で変わったら、`settings.language` と i18n の言語がいつも一致するようにする。
- **テーマと音の材質の結び付け**: テーマが変わったら（起動時を含む）、音の材質を `THEME_AUDIO_MATERIAL[theme]`（S1-24）にする（S1-25 の `setMaterial`）。

## 範囲外
- 各設定の効き目そのもの（品質・テーマ S1-24、入力デバイス・2 本指スクロール S1-14、言語 S1-12、ミュート S1-25）
- 情報表示の ON/OFF の保存（要件の保存対象ではないので保存しない）
- 音量の設定（要件にないので作らない）

## 作るもの
- `src/core/settings.ts`（純粋関数）
  ```ts
  export const SETTINGS_STORAGE_KEY = 'gear-simulator:settings';
  export const SETTINGS_VERSION = 1;
  export function defaultSettings(navigatorLanguage: string): Settings;
  export function parseSettings(raw: unknown, defaults: Settings): Settings; // 項目ごとに初期値で補う
  export function serializeSettings(settings: Settings): string;
  ```
  - `Settings` は `AppState.settings` の型（design.md §7）。各タスクが足した項目（入力デバイス・2 本指スクロール S1-14、テーマ・品質 S1-24、ミュート S1-25）に言語を足して、design.md §7 の形にそろえる。
  - S1-14 の時点では `Settings` と初期値 `DEFAULT_SETTINGS` は `src/app/store.ts` にあり、`inputDevice` の型は `src/input/wheel.ts` の `InputDeviceSetting`、`trackpadScroll` は `TrackpadScroll` を使っている。`core` は `input` を import できないので、`src/core/settings.ts` に移すときは文字列の共用体を `core` 側で定義し、`input/wheel.ts` と `app/store.ts` がそれを使う形に直す。
- `src/storage/settings-storage.ts`
  ```ts
  export function loadSettings(storage: Storage | undefined, defaults: Settings): Settings;
  export function saveSettings(storage: Storage | undefined, settings: Settings): void;
  ```
- `src/ui/settings-dialog.ts`: 設定画面。要素に `data-testid="settings-dialog"`、各項目に `data-setting="<フィールド名>"`
- 辞書のキー（日・英）: 画面の題名、各項目名と選択肢、保存できなかったときの文言。ツールバーのボタン名（`toolbar.settings`・`toolbar.settings.tooltip`）は S1-15 で足し済み。ボタンは `UiShell.toolbar.button('settings')` で受け取り、動作を付けて `disabled = false` にする。
- `__gearSim` に追加（変更は S1-14 の `updateSettings` を使う）
  ```ts
  getSettings(): Settings;
  ```

## 受け入れ条件
- [ ] 設定画面で 5 項目を変えられ、すぐ反映される。
- [ ] 再読み込みしても、5 項目とミュートが残る。
- [ ] localStorage が使えない・壊れていても、初期値で起動してエラーを出さない。
- [ ] 木製テーマにすると音の材質も木になる。

## テストケース
### Vitest
- [ ] `defaultSettings('ja-JP').language === 'ja'`、`defaultSettings('en-US').language === 'en'`、`defaultSettings('fr').language === 'en'`。theme `brass`、quality `high`、muted `false`。
- [ ] `parseSettings(undefined | null | 1 | 'x' | [], d)` → `d` と等しい。
- [ ] `parseSettings({ version: 1, theme: 'wood' }, d)` → theme `wood`、他は `d` のまま。
- [ ] `parseSettings({ version: 1, theme: 'gold', quality: 'low', muted: 'yes' }, d)` → theme `brass`、quality `low`、muted `false`。
- [ ] `parseSettings({ version: 2, theme: 'wood' }, d)` → `d`。
- [ ] `parseSettings({ version: 1, unknown: 1 }, d)` の結果に `unknown` がない。
- [ ] 往復: すべての項目を初期値と違う値にした設定 → `serializeSettings` → `JSON.parse` → `parseSettings` → 元と `toEqual`。
- [ ] `loadSettings`: `undefined` → 初期値。`getItem` が投げる偽の Storage → 初期値。`'{bad'` を返す → 初期値。
- [ ] `saveSettings`: `setItem` が投げる偽の Storage → 例外を外に出さない。`undefined` → 何もしない。

### Playwright
- [ ] 設定画面を開き、テーマ「木製」→ `getRenderInfo().theme === 'wood'`、`getAudio().material === 'wood'`。品質「軽量」→ `getRenderInfo().quality === 'low'`。
- [ ] 言語「English」→ ツールバーとダイアログの文字が英語になる（例: 設定画面の題名が `Settings`）。
- [ ] 上の 3 つと、入力デバイス「マウス」、ミュート（`M`）を変えて再読み込み → `getSettings()` の 5 項目と muted が変えた値のまま。ツールバーのミュートボタンが `aria-pressed="true"`。
- [ ] ツールバーのテーマボタンで木製にしてから設定画面を開く → テーマの選択が「木製」。
- [ ] `addInitScript` で localStorage に `gear-simulator:settings = '{bad'` を入れて起動 → `getSettings()` が初期値、コンソールエラー 0 件。
- [ ] `addInitScript` で `Storage.prototype.getItem` と `setItem` が例外を投げるようにして起動 → 初期値で起動、設定を変えても動き続ける、保存できなかったトーストが 1 回だけ出る（2 回目の変更では増えない）、コンソールエラー 0 件。
- [ ] Esc で設定画面が閉じる。

## 人が手で確かめる項目
- 設定画面の配置が日本語・英語の両方で崩れないか。
- 入力デバイスと 2 本指スクロールの割り当てを変えたとき、実機のマウスとトラックパッドで期待どおりに効くか。

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`Settings` の型と保存の形を design.md §7・§9 に、`__gearSim.getSettings` を §10 に書く）
- [ ] `status: done` にしてコミットした
