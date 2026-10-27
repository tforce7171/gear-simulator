---
id: S1-13
title: カメラ（基本）
status: done
depends: [S1-04]
---

# S1-13 カメラ（基本）

## 目的
camera-controls を入れ、要件 §7.1・§7.2 のマウスとキーボードのカメラ操作を作る。あわせて、ポインター入力を「カメラが受け取るもの」と「アプリ（歯車・ハンドル・候補）が受け取るもの」に振り分ける仕組みを作り、後続のタスク（S1-16 選択、S1-21 手で回す、S1-29 コンテキストメニュー）がそこへ乗れるようにする。

## 範囲
- camera-controls（yomotsu）の導入。S1-04 の固定カメラを置き換える
- マウスの割り当て
  | 操作 | 動作 |
  |---|---|
  | 何もない所で左ドラッグ／右ドラッグ／Alt+左ドラッグ（Alt なら部品の上でも） | 回転（注視点のまわりを周回） |
  | 中ドラッグ／Shift+右ドラッグ／Space+左ドラッグ（部品の上でも） | 平行移動 |
  | ホイール | カーソル位置に向かってズーム（`dollyToCursor`） |
  | ダブルクリック | 当たった点（部品または床）を注視点にし、距離を半分にして寄る。何にも当たらなければ何もしない |
  | 部品の上で左ボタン（修飾キーなし） | カメラは動かさず、アプリへ渡す（このタスクでは受け取り手がいないので何も起きない） |
  | 右クリック（ドラッグなし） | ブラウザ標準のメニューを出さず、「コンテキストメニューの要求」を通知する（中身は S1-29） |
- 右ボタンは、押した位置から `DRAG_THRESHOLD_PX`（4px）以上動いた時点で初めて回転を始める。動かずに離したらコンテキストメニューの要求になる
- キーボード
  - F: 選択中の物に寄る（`AppState.selection` が `null` なら全体表示。`selection` は S1-16 で足すので、それまでは常に全体表示）
  - Home: 全体表示
  - 部品が 1 つもないときの全体表示は、初期の視点に戻す
  - 寄る・全体表示・ダブルクリックは、なめらかに移る（camera-controls の transition）
- 「部品の上か」の判定は差し込み式にする（`hitTest`）。このタスクでは常に「何もない所」を返す既定の実装を置き、S1-16 が本物のピッキングに差し替える
- キー入力の共通の処理: フォーカスが `input`・`textarea`・`select`・`contenteditable` にあるときはショートカットを無視する
- 部品の範囲（AABB）を求める純粋関数と、範囲が画面に収まる距離を求める純粋関数

## 範囲外
- トラックパッド、視点切替、平行投影、眺めるモード（S1-14）
- ピッキングと選択、F の選択中の場合のテスト（S1-16）
- 手で回す（S1-21）
- コンテキストメニューの中身（S1-29）
- Space の押して離すでの一時停止（S1-22）。このタスクでは Space を「押している間は平行移動の修飾キー」としてだけ扱う

## 作るもの
- `src/input/pointer-route.ts`（純粋関数。DOM に触れない）
  ```ts
  export const DRAG_THRESHOLD_PX = 4;
  export type PointerRoute = 'camera-rotate' | 'camera-pan' | 'app' | 'none';
  export interface PointerDownInput {
    button: number;        // 0 左, 1 中, 2 右
    altKey: boolean;
    shiftKey: boolean;
    spaceHeld: boolean;
    overInteractive: boolean; // hitTest の結果
  }
  export function routePointerDown(input: PointerDownInput): PointerRoute;
  export function exceedsDragThreshold(
    down: { x: number; y: number },
    now: { x: number; y: number },
    threshold?: number,
  ): boolean;
  ```
  - 優先順位: Space+左 → pan、中 → pan、Shift+右 → pan、右 → rotate、Alt+左 → rotate、左で `overInteractive` → app、左 → rotate、それ以外 → none
- `src/core/layout/bounds.ts`
  ```ts
  export interface Aabb { min: Vec3; max: Vec3 }
  // ids を省略すると全部品。歯車は円柱（ピッチ円でなく歯先円の半径 × 歯幅）で近似する
  export function boundsOf(scene: Scene, layout: Layout, ids?: readonly string[]): Aabb | null;
  ```
- `src/input/camera-fit.ts`（純粋関数）
  ```ts
  // 半径 radius の球が、縦の視野角 fovY・縦横比 aspect の透視カメラに余白 margin 込みで収まる距離
  export function fitDistance(radius: number, fovY: number, aspect: number, margin?: number): number;
  ```
- `src/input/camera.ts`（camera-controls を包む。Three.js と DOM に依存してよい）
  - `hitTest` の差し替え口、`onContextRequest(listener: (e: { x: number; y: number }) => void): () => void`
  - `fitAll()`、`fitTo(ids)`、`dollyToPoint(world: Vec3)`、`getPose()`、`setPose(pose, animate?)`
  - camera-controls の標準のボタン割り当てをそのまま使うか、自前の入力から `rotate` / `truck` / `dolly` を呼ぶかは実装に任せる。ただし上の割り当て表と右クリックの区別を満たすこと
- `src/input/keyboard.ts`
  ```ts
  export function isTypingTarget(target: EventTarget | null): boolean;
  ```
  - キーの登録をまとめる小さな仕組み（後続の Delete、Ctrl+Z、R、Space、M などがここに足す）。キーの判定は `event.code` ではなく、文字キーは `event.key`、テンキーは `event.code`（S1-14）を使う
- `__gearSim` に追加（design.md §10 の表のとおり）
  ```ts
  interface CameraPose { position: Vec3; target: Vec3; projection: 'perspective' | 'orthographic' }
  getCamera(): CameraPose;
  setCamera(pose: Pick<CameraPose, 'position' | 'target'>): void; // transition なしで即座に
  getLastContextRequest(): { x: number; y: number } | null;
  ```

## 受け入れ条件
- [x] 上の割り当て表どおりにカメラが動く
- [x] 右クリックでブラウザ標準のメニューが出ない。右ドラッグではコンテキストメニューの要求が出ない
- [x] ホイールでカーソルの下の点に向かってズームする
- [x] F・Home で全部品が画面に収まる
- [x] テキスト入力中は F・Home が効かない

## テストケース
### Vitest
- [x] `routePointerDown`: 割り当て表の各行（左／中／右 × Alt／Shift／Space × `overInteractive` の真偽）→ 期待する経路。特に「左＋部品の上 → app」「Alt+左＋部品の上 → camera-rotate」「Space+左＋部品の上 → camera-pan」「Shift+右 → camera-pan」
- [x] `exceedsDragThreshold`: 3px の移動 → false、4px → true、斜め (3, 3) → true
- [x] `boundsOf`: 空のシーン → null。原点の縦軸の起点に中・20 歯の歯車 1 つ（`offset 0`。中心 `[0, 4, 0]`）→ x と z の範囲が ±歯先円半径（22）、y の範囲が 0〜8（歯幅 8）。`offset −4` にすると y の範囲が −4〜4。`ids` で 1 つを指定すると、その部品だけの範囲になる
- [x] `fitDistance`: 半径 0 → 0 以上の有限の値。半径を 2 倍にすると距離もほぼ 2 倍。aspect < 1（縦長）では横の視野で決まり、aspect = 1 のときより遠い
- [x] `isTypingTarget`: `input` 要素 → true、`button` 要素 → false、null → false（jsdom が要らないように、要素の判定を `tagName` と `isContentEditable` だけで行う形にしてもよい）
### Playwright（`e2e/camera-basic.spec.ts`）
準備: `e2e/fixtures/two-gears.json`（縦軸の起点のシャフトに中・20 歯、その外周に中・20 歯をかみ合わせたもの。まだ無ければこのタスクで作る）を `loadScene` し、`setCamera` で決まった視点にする。「何もない所」は、`projectToScreen` で部品から十分離れた床の点（例: `[300, 0, 300]`）を選ぶ。
- [x] 何もない所で左ドラッグ（100px 右へ）→ `getCamera().position` が変わり、`target` は変わらない
- [x] 右ドラッグ → 回転する。`getLastContextRequest()` は null のまま
- [x] Alt+左ドラッグ → 回転する
- [x] 中ドラッグ → `target` と `position` が同じだけ動く（平行移動）
- [x] Shift+右ドラッグ、Space を押しながら左ドラッグ → 平行移動になる
- [x] 右クリック（動かさない）→ `getLastContextRequest()` がクリック位置を返し、カメラは変わらない
- [x] 画面の中心から右上にずれた位置でホイール（`deltaY: -300`）→ 注視点からカメラまでの距離が縮み、`target` がカーソル側へ動く
- [x] 歯車の中心を `projectToScreen` した位置でダブルクリック → 移り終わった後（`expect.poll`）、`target` が歯車の中心から歯先円半径以内にあり、距離が元の約半分
- [x] 歯車から外して遠くへ動かした視点で Home → すべての歯車の中心の `projectToScreen` が画面内に入る
- [x] 選択なしで F → Home と同じ結果
- [x] フォーカスを `input` に置いた状態（テスト用に `page.evaluate` で一時的な input を足す）で Home → カメラが動かない

## 人が手で確かめる項目
- 回転・平行移動・ズームの速さが自然で、引っかかりがない
- ダブルクリック・F・Home の移り方がなめらか
- Mac で Ctrl+クリック（右クリック扱い）の挙動に違和感がない

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（`__gearSim` の API が design.md §10 と合っているか確かめる）
- [x] `status: done` にしてコミットした
