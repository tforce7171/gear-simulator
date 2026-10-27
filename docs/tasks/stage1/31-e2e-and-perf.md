---
id: S1-31
title: 通しテストと見た目の確認をそろえる、性能の計測
status: todo
depends: [S1-01, S1-02, S1-03, S1-04, S1-05, S1-06, S1-07, S1-08, S1-09, S1-10, S1-11, S1-12, S1-13, S1-14, S1-15, S1-16, S1-17, S1-18, S1-19, S1-20, S1-21, S1-22, S1-23, S1-24, S1-25, S1-26, S1-27, S1-28, S1-29, S1-30]
---

# S1-31 通しテストと見た目の確認をそろえる、性能の計測

## 目的
段階 1 の締めくくりとして、主要な操作の流れを通しで確かめるテストと、見た目の確認の場面をそろえる（要件 §12）。歯車 200 個で 60fps の目標（要件 §2）を手元で測るスクリプトを用意し、段階 2 に進む前の基準値を残す。

## 範囲
- 各タスクで書いた Playwright のテストを見直し、重複をまとめ、下の「通しのテスト」を `e2e/flows/` に足す。個々の機能のテストは各タスクの場所に残す。
- `e2e/fixtures/<名前>.json` の重複（同じ中身で名前が違うもの）をまとめ、参照しているテストを直す（design.md §10）。
- 見た目の確認の場面を下の一覧にそろえる。各タスクで撮ったものは名前を合わせて残し、足りないものを足す。
- 性能の計測スクリプトを `scripts/` に置く。自動テスト（`pnpm verify`）には入れない。
- 計測した結果を、このタスク資料の末尾の「計測の記録」に書く。60fps に届かなかったら、原因の見当（描画・運動の計算・音・情報表示のどれか）と一緒に記録し、直すタスクを README に足す（このタスクでは直さない）。

### 通しのテスト（`e2e/flows/*.spec.ts`）
操作は画面から行う（パレット、候補、プロパティパネル、ツールバー、キー）。状態の確認は `__gearSim` で行う。`loadScene` は準備にだけ使い、流れの中の操作の代わりにしない。

1. **組み立てて回す**（`build-and-run.spec.ts`）
   空のシーン → パレットから起点のシャフトを床にドラッグして置き、最初の歯車を付ける（S1-17 の手順）→ その歯車を選んで外周の候補をクリック（S1-18）→ 歯車 2 枚、`getLayout().meshes` が 1 件 → プロパティパネルで 1 枚目のシャフトにモーターを付ける（60 rpm、+1、ON）→ 0.5 秒後、1 枚目のシャフトの ω ≈ 2π、2 枚目 ≈ −2π × z₁/z₂（`toBeCloseTo`、小数 3 桁）→ 情報表示 ON で 2 枚目のラベルの rpm が `60 × z₁/z₂` を小数 1 桁にしたもの。
2. **保存して読み込む**（`save-and-load.spec.ts`）
   1 の後 → 「保存」で `通しテスト` という名前で保存 → 再読み込み → 自動保存から同じシーン → `loadScene` で空にする → 作品一覧から `通しテスト` を開く → 同じシーン → エクスポート → 空にする → インポート → 同じシーン → モーターが回っている（ω ≠ 0）。
3. **編集の連鎖と Undo/Redo**（`edit-undo.spec.ts`）
   歯車 3 枚の列（シーン A、S1-23）を読む → g1 の歯数を 12 → 20 に変える（プロパティパネル）→ g2 の中心が g1 の中心から 28 mm（`1 × (20 + 36) / 2`）の距離に動き、g2 と g3 の中心距離は 30 mm のまま → g2 を Delete → g3 がその場に残り、`meshes` が 0 件 → g1 を選び、外周の候補で歯車を 1 枚足す → Ctrl+Z を 3 回 → シーン A と等しい → Ctrl+Shift+Z を 3 回 → 3 回の操作後のシーンと等しい。
4. **ロックと一時停止**（`lock-and-pause.spec.ts`）
   `lock-opposed.json`（S1-21）を読む → `getMotion().locks` が 1 件（`reason: 'stalemate'`）、全 ω = 0 → プロパティパネルで片方のモーターを OFF → ロックが解け、もう片方が 60 rpm で回る → Space → 全 ω = 0、シーンは変わらない → Space → 回り出す。
5. **手で回す**（`hand-rotate.spec.ts`）
   シーン A を読み、モーターを OFF → g2 を手で 90° 分ドラッグ（S1-21）→ 各シャフトの角度が `z₁·θ₁ + z₂·θ₂ ≈ 定数` を保つ（ドラッグ前と比べて差 < 1e-6）→ 離すと全 ω = 0。ドラッグの経路は S1-21 の `e2e/hand-rotation.spec.ts` の `pathPoints`（歯車の面上の点を `projectToScreen` したもの）と同じ作り方でよい。
6. **右クリックと設定**（`menu-and-settings.spec.ts`）
   シーン A を読む → g2 を右クリック →「モーターを付ける」→ 設定でテーマを木製、言語を英語 → 再読み込み → テーマ・言語・付けたモーターが残っている。
7. **ループと付け直し**（`loop-and-reattach.spec.ts`）
   `one-root-motor.json`（S1-18）を読む → A の外周の候補で B を生やし、B の外周の候補で C を生やす（A と C はかみ合わない位置）→ C を選び、円弧ハンドル（S1-19）で A とちょうどかみ合う角度まで動かす（吸着する）→ `getLayout().meshes` に A-C（`source: 'contact'`）、`getMotion().locks` に `reason: 'contradiction'`、`interferences` が空 → Ctrl+Z → ロックが解ける → B を Delete → C のシャフトが `detached` → C を選び、本体を A の外周の候補の位置へドラッグして離す（S1-19 の付け直し。押す点は、C のシャフトの真下の位置・高さのハンドルを避ける。S1-19 の `e2e/handles.spec.ts` の `pointOnP` のように `pick` で確かめる）→ C のシャフトが `{ kind: 'mesh', parentGearId: A }`、`locks` が空、C のシャフトの ω ≈ −π。

各テストはコンソールエラーと pageerror が 0 件であることを共通のフィクスチャで確かめる（design.md §10）。

### 見た目の確認の場面（`e2e/visual/`、`screenshots/<場面名>.png`）
| 場面名 | 内容 | 撮り方 |
|---|---|---|
| `theme-brass` | 真鍮、全体 | `showcase.json`（S1-24）、Home |
| `theme-wood` | 木製、全体 | 同上、`updateSettings({ theme: 'wood' })` |
| `theme-brass-mesh-closeup` | 真鍮、かみ合いの拡大 | `setCamera` でかみ合いの接点から 60 mm |
| `theme-wood-mesh-closeup` | 木製、かみ合いの拡大 | 同上 |
| `theme-brass-low` | 真鍮、軽量 | `updateSettings({ quality: 'low' })`、全体 |
| `lock-red` | ロック中の赤い表示 | `lock-opposed.json`、ロックした後 |
| `interference-warning` | 干渉の赤い警告 | S1-22 のフィクスチャ |
| `info-overlay-on` | 情報表示 ON | シーン A、情報表示 ON |
| `ui-ja` | 日本語の UI | S1-15 の `ui-ja` を、歯車を 1 枚選んでプロパティパネルを出した状態に撮り直す。設定画面を開いた状態の `ui-ja-settings` も撮る |
| `ui-en` | 英語の UI | 同上（`ui-en`、`ui-en-settings`） |
| `works-list` | 作品一覧 | 作品を 2 つ保存した後 |
| `context-menu` | コンテキストメニュー | 歯車の上で開いた状態 |

- 画面の大きさは 1280×800 にそろえる。
- 自動の判定は「真っ黒・真っ白でない」とコンソールエラー 0 件だけ（design.md §10）。
- 撮る前に一時停止（Space）して回転を止め、カメラの動きが終わるのを待つ（見比べやすくするため。画像の比較はしない）。

### 性能の計測（`scripts/perf.ts`）
- 実行: `pnpm perf`。`vite build --mode e2e` → `vite preview --mode e2e` を起動し、Playwright の Chromium を **画面ありで、実際の GPU で**（SwiftShader を使わず）開く。垂直同期と fps の上限を外す（`--disable-gpu-vsync`、`--disable-frame-rate-limit`）ので、60fps を超えた余裕も見える。
- 画面の大きさ 1280×800、`devicePixelRatio` は実機のまま。
- シーン: `generatePerfScene(200)` で作り、`loadScene` で読む。モーターはすべて ON。
- 手順: キャンバスをクリック（音を開始）→ Home → 眺めるモード ON → 3 秒待つ（ウォームアップ）→ 10 秒間、ページ内の `requestAnimationFrame` でフレームの間隔を記録する。
- 条件: 次の 4 つを順に測る。
  1. 高品質・真鍮・情報表示 OFF・音あり
  2. 軽量・真鍮・情報表示 OFF・音あり
  3. 高品質・真鍮・情報表示 ON・音あり
  4. 高品質・真鍮・情報表示 OFF・ミュート
- 出力: 条件ごとに平均 fps、フレーム時間の中央値・p95・p99・最大（ms）、`renderer.info.render.calls` と `triangles` を表にして標準出力へ。同じ内容を `perf-results/<YYYYMMDD-HHmmss>.json` に書く（`perf-results/` は git で無視する）。
- 目標との比較: 平均 60fps 以上かつ p95 ≤ 16.7 ms なら `OK`、そうでなければ `BELOW TARGET` を条件ごとに表示する。終了コードは常に 0（判定のためのテストではない）。
- 引数: `--count <n>`（歯車の数、初期値 200）、`--seconds <n>`（計測の秒数、初期値 10）、`--headless`（CI などで動くかだけ確かめる用。数値は参考にならない）。

## 範囲外
- 性能の改善（計測の結果を見て、別のタスクを README に足す）
- 画像の前回比較（要件で行わない）
- 段階 2・3 の通しテスト（S2-05、S3-05）
- Chromium 以外のブラウザ（要件で Chromium のみ）

## 作るもの
- `e2e/flows/*.spec.ts`（上の 7 本）
- `e2e/visual/*.spec.ts`（上の場面。既存のものは名前を合わせる）
- `src/debug/perf-scene.ts`
  ```ts
  // 歯車 count 個の、干渉もロックもない、すべて回るシーンを作る。同じ seed なら同じシーン
  export function generatePerfScene(count: number, seed?: number): Scene;
  ```
  - 形の目安: 根のシャフト 1 本から外周に生やした歯車の列（列ごとに 10 枚、外周の角度を ±30° で互い違いにした折れ線）を、列どうしが干渉しない間隔で格子状に並べる。大きさは列ごとに S・M・L を順に使い、歯数は 20〜40 を seed で決める。各列の先頭のシャフトにモーター（大きさは列の大きさと同じ、初期値の rpm、向き +1、ON）を付ける。同じシャフトに 2 枚重ねた歯車も、列の途中に混ぜる（全体の 1 割程度。`offset` は面を接した `AXIAL_SNAP` の倍数）。
  - 偶然のかみ合い（contact）は位相を問わず拘束になり、ループができるとロックするので（design.md §5）、contact が生じない配置にする（大きさの同じ歯車が、木の親子以外でちょうどの距離に来ないようにする）。
- `scripts/perf.ts` と `package.json` の `perf` スクリプト。TypeScript をそのまま動かすため `tsx` を devDependency に足す。
- `.gitignore` に `perf-results/` を足す。
- `__gearSim` の不足分（流れのテストで必要になったもの）。足したら design.md §10 を更新する。

## 受け入れ条件
- [ ] `pnpm verify` で 7 本の通しテストと、見た目の確認の全場面が通る。
- [ ] `screenshots/` に一覧の場面名の PNG がそろう。
- [ ] `pnpm perf` で 4 条件の結果が表と JSON で出る。
- [ ] 計測の結果をこの資料の「計測の記録」に書いた。

## テストケース
### Vitest
- [ ] `generatePerfScene(200)`: 歯車がちょうど 200 枚。`resolveLayout` の `interferences` が空で、`meshes` に `source: 'contact'` が無い。
- [ ] 同じシーンを力のつり合いで解くと `locks` が空、全シャフトの |ω| > 0（モーターから届かない歯車がない）。
- [ ] `getLayout().meshes` の件数が 180 以上（同じシャフトに重ねた分だけ 199 より少ない）。
- [ ] `generatePerfScene(200, 1)` を 2 回 → `toEqual`。`seed` が違うと歯数の並びが違う。
- [ ] `generatePerfScene(20)` → 20 枚（count を変えられる）。
- [ ] シーンが `parseSaveFileObject(toSaveFile(scene))`（S1-28）を通る。

### Playwright
- [ ] 上の通しのテスト 7 本。
- [ ] 上の見た目の確認の全場面。
- [ ] `generatePerfScene(200)` を `loadScene` して 3 秒回してもコンソールエラー 0 件（SwiftShader なので fps は見ない）。

## 人が手で確かめる項目
- `screenshots/` の全場面を目で見て、明らかな崩れ（真っ黒な部品、テクスチャの抜け、UI の文字のはみ出し、英語のままの日本語 UI など）がないか。
- `pnpm perf` を普通のノート PC で実行し、結果を下の「計測の記録」に書く（PC の型番、CPU、GPU、ブラウザの版、画面の倍率）。
- 計測中に音が途切れたり、ブツブツ鳴ったりしないか。

## 計測の記録
（実施したら、日付・環境・4 条件の結果をここに書く）

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`__gearSim` の追加分、`scripts/perf.ts` の使い方を design.md §10 に書く。60fps に届かなければ改善のタスクを README に足す）
- [ ] `status: done` にしてコミットした
