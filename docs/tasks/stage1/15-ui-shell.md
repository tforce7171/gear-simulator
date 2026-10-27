---
id: S1-15
title: 画面の骨組み
status: done
depends: [S1-04, S1-12]
---

# S1-15 画面の骨組み

## 目的
要件 §7.4 の画面の配置（左に部品パレット、右にプロパティパネル、上にツールバー、右下に軸の目印）を作り、後続のタスクがボタンやパネルの中身を差し込める場所を用意する。あわせて、エラーや通知を出すトーストを用意する（design.md §7）。

## 範囲
- 素の TypeScript と CSS で作る配置
  - 上: ツールバー（高さ 44px 前後）
  - 左: 部品パレット（幅 200px 前後）
  - 右: プロパティパネル（幅 260px 前後）
  - 中央: 3D の描画領域。残りの領域をすべて使う
  - 描画領域の右下: 軸の目印の置き場（96×96px 前後。目印そのものは S1-14 がここに置く）
- 描画領域の大きさが変わったら（ウィンドウのリサイズ）、レンダラーとカメラの縦横比を合わせる（`ResizeObserver`）
- ツールバーのボタン（並び順もこの通り）。このタスクでは置くだけで、`disabled` にしておく。各担当タスクで有効にする
  | ボタン | `data-testid` | 担当 |
  |---|---|---|
  | 作品一覧 | `toolbar-works` | S1-27 |
  | 保存 | `toolbar-save` | S1-27 |
  | エクスポート | `toolbar-export` | S1-28 |
  | インポート | `toolbar-import` | S1-28 |
  | テーマ | `toolbar-theme` | S1-24 |
  | 情報表示 | `toolbar-info` | S1-23 |
  | ミュート | `toolbar-mute` | S1-25 |
  | 設定 | `toolbar-settings` | S1-30 |
- 部品パレットの中身の置き場（中身は S1-17・S1-18）。このタスクでは見出しだけ置く
- プロパティパネル: 何も選ばれていないときの案内文（例: 「部品を選ぶと、ここに設定が出る」）。中身を差し替える口を用意する（中身は S1-20）
- 文字列はすべて `t()` 経由。ボタンには `aria-label` と `title`（ツールチップ）も `t()` で付ける。言語が変わったら（`onLanguageChange`）すべての文字列を書き換える
- パネル上のポインター操作がカメラへ伝わらないこと。パネル上のホイールはパネルのスクロールになる
- トースト（エラー・通知）
  - 描画領域の下寄りに重ねて出す。複数なら積み重ねる（新しいものが下）。一定時間（例: 通知 3 秒、エラー 6 秒）で消え、閉じるボタンでも消せる
  - 文字列は `t()` 経由（キーと差し込みの値を受ける）。言語が変わったら、出ているトーストの文字列も書き換える
  - 種類は `'info' | 'error'`。エラーは `role="alert"`、通知は `role="status"`
  - 想定内の失敗はトーストと `console.warn` にとどめ、`console.error` は出さない（design.md §7）
  - 使うのは後続のタスク（読み込めないファイル S1-28、保存の失敗 S1-27 など）。このタスクでは仕組みだけ作る

## 範囲外
- 各ボタンの動作（上の表の担当タスク）
- パレットの部品とドラッグ（S1-17）、生やす歯車の大きさの選び方（S1-17・S1-18）
- プロパティパネルの中身（S1-20）
- 軸の目印そのもの（S1-14）
- コンテキストメニュー（S1-29）、設定画面（S1-30）
- テーマに合わせた UI の配色（S1-24）。このタスクでは落ち着いた中間色で作る

## 作るもの
- `src/ui/shell.ts`
  ```ts
  export interface UiShell {
    canvasHost: HTMLElement;       // レンダラーの canvas を入れる
    gizmoSlot: HTMLElement;        // 軸の目印の置き場
    toolbar: {
      button(id: ToolbarButtonId): HTMLButtonElement;
    };
    palette: { body: HTMLElement };
    properties: {
      setContent(content: HTMLElement | null): void; // null で案内文に戻す
    };
    dispose(): void;
  }
  export type ToolbarButtonId =
    'works' | 'save' | 'export' | 'import' | 'theme' | 'info' | 'mute' | 'settings';
  export function createUiShell(root: HTMLElement): UiShell;
  ```
- `src/ui/dom.ts`（小さな補助。任意）
  ```ts
  // 要素の文字列を t(key) で入れ、言語の切り替えで書き換える。解除関数を返す
  export function bindText(el: HTMLElement, key: MessageKey, attr?: 'textContent' | 'title' | 'aria-label'): () => void;
  ```
- `src/ui/toast.ts`
  ```ts
  export type ToastKind = 'info' | 'error';
  // 描画領域に重ねてトーストを出す。閉じる関数を返す
  export function showToast(message: MessageKey, kind: ToastKind, params?: MessageParams): () => void;
  ```
  - トーストの要素に `data-testid="toast"` と `data-kind`（種類）を付ける
- `src/ui/shell.css`（または同等のスタイル）
- 辞書（`ja.ts`・`en.ts`）に、ツールバー・パレットの見出し・プロパティの案内文のキーを足す（例: `toolbar.works`、`palette.title`、`properties.empty`）と、トーストの閉じるボタンのキー（例: `toast.close`）
- `e2e/visual/ui-shell.spec.ts`

## 受け入れ条件
- [x] 4 つの領域と軸の目印の置き場が、要件 §7.4 の配置で出る
- [x] 描画領域がパネルに隠れず、ウィンドウの大きさに追従する
- [x] ツールバーの 8 つのボタンが並び、言語の切り替えで表示が変わる
- [x] パネルの上でドラッグやホイールをしてもカメラが動かない
- [x] `showToast` でエラー・通知のトーストが出て、時間がたつか閉じるボタンで消える

## テストケース
### Vitest
- なし（DOM の組み立てが主なので Playwright で確かめる）
### Playwright（`e2e/ui-shell.spec.ts`）
- [x] 8 つの `toolbar-*` が表示され、左から上の表の順に並ぶ（`boundingBox().x` が増えていく）
- [x] パレット、プロパティパネル、canvas の `boundingBox` が互いに重ならず、canvas が中央にある
- [x] `page.setViewportSize` で幅を 1280 → 1000 に縮める → canvas の幅が同じだけ縮み、canvas の描画バッファの縦横比が表示の縦横比と一致する（`canvas.width / canvas.height` と `clientWidth / clientHeight`）
- [x] プロパティパネルに案内文が出ている
- [x] `locale: 'ja-JP'` で開く → `toolbar-save` の文字が日本語の辞書の値。`__gearSim.setLanguage('en')` → 英語の辞書の値に変わる。`title` 属性も変わる
- [x] パレット・プロパティパネル・ツールバーの上の `pointerdown` と `wheel` が canvas に届かない（canvas 側にテスト用のリスナーを `page.evaluate` で付けて数える）。カメラが動かないことの確認は、S1-13 と S1-15 の両方がそろう S1-16 で行う
- [x] トースト（`e2e/toast.spec.ts`）: `locale: 'ja-JP'` で開き、`page.evaluate(() => import('/src/ui/toast.ts').then((m) => m.showToast('app.title', 'error')))` → `data-testid="toast"` が 1 つ出て、文字が日本語の辞書の値、`role="alert"`。`__gearSim.setLanguage('en')` → 英語の値に変わる。閉じるボタンを押す → 消える。`'info'` で出したものは、時間がたつと消える（`page.clock` で時間を進めてよい）
### Playwright（見た目、`e2e/visual/ui-shell.spec.ts`）
- [x] 日本語の UI のスクリーンショットを `screenshots/ui-ja.png`、英語を `screenshots/ui-en.png` に保存する。真っ黒・真っ白でないこと

## 人が手で確かめる項目
- 文字の大きさ・余白・並びが整っていて、英語の長い文字列でもボタンが崩れない
- 狭いウィンドウ（幅 1000px 前後）でも使える

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した
- [x] `status: done` にしてコミットした
