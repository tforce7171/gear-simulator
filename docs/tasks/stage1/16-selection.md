---
id: S1-16
title: 選択、ピッキング、Esc、Delete
status: doing
depends: [S1-11, S1-13, S1-15]
---

# S1-16 選択、ピッキング、Esc、Delete

## 目的
画面上の部品をクリックで選べるようにし、選んだ物を削除・元に戻せるようにする。ここで作るピッキングと選択は、生やす（S1-18）、ハンドル（S1-17・S1-19）、プロパティ（S1-20）、手で回す（S1-21）の土台になる。

## 範囲
- レイキャストによるピッキング。当たった物を次の優先順位で 1 つ返す: ハンドル（S1-17・S1-19）＞ 候補（S1-18）＞ 歯車 ＞ モーター ＞ シャフト。ハンドルと候補はこのタスクではまだ無いが、優先順位の仕組みはここで作る
  - レイキャストのカメラは `Renderer.activeCamera()`（S1-14 で平行投影のカメラに切り替わるようになった。`Renderer.camera` は透視投影のカメラだけを指す）
- S1-13 の `hitTest` を、このピッキングに差し替える（何かに当たれば「部品の上」）。差し替え口は `CameraInput.setHitTest((pageX, pageY) => boolean)`（`src/input/camera.ts`）。経路が `'app'` のポインター（部品の上の左ボタン）はカメラが無視するので、クリックの受け取り手はこのタスクで canvas に付ける。F の寄る先は `createCameraInput` の `getSelection` に `AppState.selection` を渡して有効にする（`main.ts`）
- 選択
  - 左クリック（`DRAG_THRESHOLD_PX` 未満の移動で離す）した部品を選ぶ。選択は 1 つだけ（複数選択は扱わない。`AppState.selection` は `string | null`。design.md §7）
  - 選べるのは歯車とシャフト。モーターをクリックしたら、そのシャフトを選ぶ
  - 何もない所を左クリック → 選択を外す（左ドラッグでのカメラ回転では外さない）
  - Esc → 選択を外す
  - シーンが変わって選択中の ID が無くなったら（削除、Undo など）、選択から外す
- ハイライト: 選択中の部品を目立たせる（発光色や輪郭線など。方法は実装に任せる）。マウスを乗せた部品にも弱いハイライトを出す。ロックの赤（S1-22）と見分けられる色（例: 水色）にする
- Delete（Mac 用に Backspace も）: 選択中の部品を S1-11 の `deleteParts` で消す
  - 歯車を消すと、その歯車を親とする `mesh` のシャフト（とその先）は `detached` になってその場に残る
  - シャフトを消すと、載っている歯車とモーターも消え、その歯車の子は同じく `detached` になる
- Ctrl+Z → Undo、Ctrl+Shift+Z → Redo（Mac の Cmd も同じ）。S1-11 の履歴を使う
- キー入力は S1-13 の共通の処理に乗せる（テキスト入力中は効かない）

## 範囲外
- 手で回す（S1-21）。このタスクでは、歯車の上の左ドラッグは「何も起きない（カメラも回らない）」
- ハンドル（S1-17・S1-19）、候補（S1-18）
- コンテキストメニューからの削除（S1-29）
- 複数選択、範囲選択（段階 1 では扱わない）

## 作るもの
- `src/render/picking.ts`
  ```ts
  export type PickKind = 'handle' | 'candidate' | 'gear' | 'motor' | 'shaft';
  export interface PickHit { kind: PickKind; id: string; point: Vec3 }
  export function pick(x: number, y: number): PickHit | null; // 画面座標（CSS ピクセル、canvas 基準でなくページ基準）
  ```
  - render が作る Object3D の `userData` に `{ pickKind, pickId }` を入れておき、それで判別する
  - 細いシャフトはそのままだと当てにくいので、見えない太めの当たり判定用の形を使ってよい
- `src/input/pick-priority.ts`（純粋関数）
  ```ts
  // レイの当たり（距離順とは限らない）から、優先順位に従って 1 つ選ぶ
  export function choosePick(hits: ReadonlyArray<{ kind: PickKind; id: string; distance: number }>): { kind: PickKind; id: string } | null;
  ```
  - 同じ種類の中では手前（distance が小さい）を選ぶ
- `src/app/selection.ts`（純粋関数）
  ```ts
  export function selectionForPick(hit: { kind: PickKind; id: string } | null, scene: Scene): string | null;
  export function pruneSelection(selection: string | null, scene: Scene): string | null;
  ```
- `__gearSim` に追加（design.md §10 も更新する）
  ```ts
  pick(x: number, y: number): PickHit | null;
  select(id: string | null): void;
  ```
  - `getSelection()`（design.md §10 の基本の API）は、選択が無ければ `[]`、あれば `[id]` を返す
- `e2e/fixtures/chain-three.json`: 縦軸の起点のシャフトに中・20 歯の歯車 A、その外周に B（中・20 歯）、B の外周に C（中・20 歯）。A→B→C の木

## 受け入れ条件
- [ ] 歯車・シャフト・モーターをクリックすると、その部品（モーターならシャフト）が選ばれ、ハイライトされる
- [ ] 何もない所のクリックと Esc で選択が外れる
- [ ] Delete で選択中の部品が消え、その先は浮いたまま残る
- [ ] Ctrl+Z／Ctrl+Shift+Z で元に戻す・やり直す
- [ ] 歯車の上の左ドラッグではカメラが回らず、Alt+左ドラッグでは回る

## テストケース
### Vitest
- [ ] `choosePick`: `[shaft(1), gear(5)]` → gear（距離より種類が優先）。`[gear(5), gear(2)]` → 距離 2 の gear。`[gear(1), handle(9)]` → handle。空 → null
- [ ] `selectionForPick`: gear → `gearId`、motor → そのモーターの `shaftId`、shaft → `shaftId`、null → `null`
- [ ] `pruneSelection`: シーンに無い ID → `null`、ある ID → そのまま、`null` → `null`
### Playwright（`e2e/selection.spec.ts`）
準備: `chain-three.json` を読み込み、`setCamera` で上から見下ろす視点にする。歯車の中心は `getLayout().gears[id].center` を `projectToScreen` して得る。
- [ ] B の中心をクリック → `getSelection()` が `[B]`。`pick` の結果も `{ kind: 'gear', id: B }`
- [ ] A のシャフトの、歯車から外れた所（`getLayout().shafts[id]` の `span` の端の近く）をクリック → `[A のシャフト]`
- [ ] 何もない所をクリック → `[]`
- [ ] B を選んで Esc → `[]`
- [ ] B を選んで、何もない所で左ドラッグ（カメラ回転）→ 選択は `[B]` のまま
- [ ] B を選んで Delete → `getScene().gears` に B が無い。C のシャフトの `placement.kind` が `'detached'`。C の中心（`getLayout`）が削除前と同じ（`toBeCloseTo`）。`getSelection()` が `[]`
- [ ] 続けて Ctrl+Z → B が戻り、C のシャフトが `'mesh'` に戻る。Ctrl+Shift+Z → また消える
- [ ] A のシャフトを選んで Delete → A とそのシャフトが消え、B のシャフトが `'detached'`
- [ ] 歯車 B の上で左ドラッグ（100px）→ `getCamera()` が変わらない。Alt を押しながら同じドラッグ → 変わる
- [ ] パレットの上で左ドラッグ → `getCamera()` が変わらない
- [ ] B を選んで F → 移り終わった後、`getCamera().target` が B の中心に近い（歯先円半径以内）
- [ ] プロパティパネルなどの `input` にフォーカスがあるとき（テスト用の input でよい）、Delete を押しても部品は消えない

## 人が手で確かめる項目
- 選択と、マウスを乗せたときのハイライトが見やすく、ロックの赤と区別できる
- 細いシャフトもクリックしやすい

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（§10 の `__gearSim` の API）
- [ ] `status: done` にしてコミットした
