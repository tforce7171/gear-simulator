---
id: S1-29
title: コンテキストメニュー
status: todo
depends: [S1-14, S1-20, S1-23]
---

# S1-29 コンテキストメニュー

## 目的
右クリックで、その場所に合った操作をすぐ選べるようにする（要件 §7.1）。

## 範囲
- **開き方**: S1-13 の「コンテキストメニューの要求」（右ボタンを押して `DRAG_THRESHOLD_PX` 未満の移動で離した）を受けて開く。それ以上動かしたらカメラの回転で、メニューは開かない。ブラウザ標準のメニューを出さないのも S1-13 で済んでいる。要求は `CameraInput.onContextRequest((e: { x, y }) => …)`（ページ座標）で受け取る。`main.ts` で `__gearSim.getLastContextRequest` 用に覚えている所に、メニューを開く処理を足す。「ここに寄る」は `CameraInput.dollyToPoint`、「全体表示」は `CameraInput.fitAll` を呼ぶ。
- **対象の決め方**: 離した位置でピッキング（S1-16）する。
  - 部品（歯車・シャフト・モーター）の上: 左クリックと同じ規則（S1-16 の `selectionForPick`。モーターはシャフトとして選ばれる）で選択を置き換えてから、部品のメニューを開く。メニューの対象は選ばれた部品。
  - 何もない所: 選択は変えずに、何もない所のメニューを開く。
- **部品のメニュー**
  | 項目 | 動作 |
  |---|---|
  | 削除 | 対象を Delete キー（S1-16）と同じ規則で削除する。Undo できる |
  | モーターを付ける／外す | 対象のシャフトにモーターがなければ「付ける」、あれば「外す」と表示する。付けるときの初期値（大きさ・回転数・向き・ON）は S1-20 のプロパティパネルで付けるときと同じ。Undo できる |
  | ここに寄る | 右クリックした点を回転の中心にして寄る。ダブルクリック（S1-13）と同じ動き |
  - 「対象のシャフト」: シャフトならそれ自身、**歯車ならその歯車が載っているシャフト**。歯車の上で右クリックしてモーターを付けたいことが多く、歯車とシャフトの区別を求めないため。
- **何もない所のメニュー**
  | 項目 | 動作 |
  |---|---|
  | 全体表示 | Home キー（S1-13）と同じ |
  | 眺めるモード | `view.watchMode` を切り替える（S1-14）。いまの状態をチェックの印で示す |
  | 情報表示 | `view.infoOverlay` を切り替える（S1-23）。いまの状態をチェックの印で示す |
- **閉じ方**: 項目を選ぶ、Esc、メニューの外でのクリック・ホイール、ウィンドウのリサイズ・フォーカスを失う。メニューを開いている間の Esc はメニューを閉じるだけで、選択は解除しない。
- **キーボード**: 開いたら最初の項目にフォーカス。↑↓ で移動（端で折り返す）、Enter で実行。`role="menu"` と `role="menuitem"`（チェックの項目は `menuitemcheckbox` と `aria-checked`）。
- **位置**: カーソルの右下に出す。画面からはみ出すなら左や上に反転し、それでも足りなければ画面の端に寄せる。
- 項目の並びと表示名・有効かどうかは純粋関数で決め、Vitest で確かめる。

## 範囲外
- モーターの詳しい設定（プロパティパネル、S1-20）
- ハンドル（S1-19）の上での右クリックの特別扱い（部品の上と同じに扱う）
- 長押しなどタッチでの開き方（要件 §14 のタッチ対応）

## 作るもの
- `src/ui/context-menu/items.ts`（DOM を使わない純粋関数）
  ```ts
  export type ContextTarget =
    | { kind: 'part'; partId: string; point: Vec3 }  // partId は選ばれた ShaftId | GearId
    | { kind: 'empty' };
  export type MenuAction = 'delete' | 'attachMotor' | 'detachMotor' | 'focusHere' | 'frameAll' | 'toggleWatch' | 'toggleInfo';
  export interface MenuItem { action: MenuAction; labelKey: string; checked?: boolean }
  export function targetShaftId(scene: Scene, partId: string): ShaftId | null;
  export function buildContextMenuItems(target: ContextTarget, state: AppState): MenuItem[];
  export function placeMenu(
    cursor: { x: number; y: number },
    menu: { width: number; height: number },
    viewport: { width: number; height: number },
  ): { left: number; top: number };
  ```
- `src/ui/context-menu/`: メニューの表示と操作。要素に `data-testid="context-menu"`、項目に `data-action`
- 辞書のキー（日・英）: 各項目の表示名
- `__gearSim` に追加（S1-14 で同等のものを作っていればそれを使う）。S1-14 では `setWatchMode(on)` だけ足し、読むものは作っていない（眺めるモードの状態は `AppState.view.watchMode`。ストアのアクションは `{ type: 'setWatchMode', on }`）
  ```ts
  getView(): { infoOverlay: boolean; watchMode: boolean };
  ```
  - 注視点は S1-13 の `getCamera().target` で読む。

## 受け入れ条件
- [ ] 歯車の上で右クリックすると、削除・モーターを付ける（または外す）・ここに寄る が出て、それぞれ動く。
- [ ] 何もない所で右クリックすると、全体表示・眺めるモード・情報表示 が出て、それぞれ動く。チェックの印がいまの状態と合う。
- [ ] 右ドラッグではメニューが出ず、カメラが回る。ブラウザ標準のメニューは出ない。
- [ ] 画面の端で開いてもメニューが画面に収まる。

## テストケース
### Vitest
- [ ] `targetShaftId`: シャフト → 自身、歯車 → その `shaftId`、存在しない ID → null。
- [ ] `buildContextMenuItems`
  - 歯車（シャフトにモーターなし）→ `['delete', 'attachMotor', 'focusHere']`
  - 歯車（シャフトにモーターあり）→ `['delete', 'detachMotor', 'focusHere']`
  - モーターの付いたシャフト → `['delete', 'detachMotor', 'focusHere']`
  - 何もない所、眺めるモード OFF・情報表示 ON → `['frameAll', 'toggleWatch', 'toggleInfo']`、`toggleWatch.checked === false`、`toggleInfo.checked === true`
- [ ] `placeMenu`（viewport 1000×800、menu 200×150）: cursor (100, 100) → (100, 100)。(900, 100) → (700, 100)。(100, 700) → (100, 550)。(950, 750) → (750, 600)。menu 200×900 で cursor (100, 100) → top 0。

### Playwright
共通: シーン A（S1-23）を読む。g2 のシャフト s2 にはモーターがない。
- [ ] g2 の中心（`projectToScreen`）で右クリック → `context-menu` が見え、項目が 3 つ、2 つ目の `data-action` が `attachMotor`、`getSelection()` が `[g2]`。
- [ ] 「モーターを付ける」→ メニューが閉じる、`getScene().motors` に `shaftId === s2` のものが 1 つ増える。同じ所で右クリック → 2 つ目が `detachMotor`。選ぶ → モーターが消える。Ctrl+Z → モーターが戻る。
- [ ] g3 で右クリック →「削除」→ `getScene().gears` に g3 がない。Ctrl+Z → 戻る。
- [ ] g2 で右クリック →「ここに寄る」→ カメラの動きが終わってから、`getCamera().target` と `pick(右クリックした位置).point` の距離 < 1 mm。
- [ ] 何もない所（画面の左上の隅、パレットとツールバーを避けた位置）で右クリック → 項目 3 つ。「情報表示」→ `getView().infoOverlay === true`、ラベル 3 個。もう一度開く → `aria-checked="true"`。
- [ ] 「眺めるモード」→ `getView().watchMode === true`。もう一度 → false。
- [ ] 「全体表示」→ Home キーを押したときと同じ `getCamera().target`（各成分の差 < 1 mm）。
- [ ] 右ボタンで 50 px ドラッグ → メニューが出ない、`getCamera().position` が変わる。
- [ ] メニューを開いて Esc → メニューが閉じ、`getSelection()` は `[g2]` のまま。
- [ ] 右下の隅で右クリック → メニューの矩形が画面内に収まる。
- [ ] 上のすべてでコンソールエラー 0 件。

## 人が手で確かめる項目
- トラックパッドの 2 本指クリックでも開くか（Mac）。
- 右ドラッグでカメラを回すつもりで、少しだけ動かしたときにメニューが誤って出ないか。

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`__gearSim.getView` を design.md §10 に書く）
- [ ] `status: done` にしてコミットした
