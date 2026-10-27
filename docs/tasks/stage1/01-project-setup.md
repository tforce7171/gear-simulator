---
id: S1-01
title: プロジェクトの土台
status: done
depends: []
---

# S1-01 プロジェクトの土台

## 目的
以降のすべてのタスクが「テストを書く → 実装する → `pnpm verify` → コミット」の流れで進められるように、ビルド・リント・型検査・単体テスト・通しテスト・見た目の確認の仕組みを先にそろえる。完了すると、空の three シーン（床のグリッドだけ）がブラウザに出て、`pnpm verify` が通る。

## 範囲
- pnpm のプロジェクト（`package.json` の `packageManager` を固定。Node は 22 LTS 以上を `engines` に書く）
- Vite + TypeScript（素の TS。フレームワークなし）
  - `tsconfig.json` は `strict: true`、`noUncheckedIndexedAccess: true`、`noEmit` 前提。`src/`・`e2e/`・設定ファイルを型検査の対象にする
  - `vite --mode e2e` で起動できる（`import.meta.env.MODE === 'e2e'`）
- Biome（リントとフォーマット）
  - `src/core/**` から次の import を禁止する（`noRestrictedImports`）: `three`、`three/*`、`camera-controls`。あわせて `src/core` の外の層（`render/`・`input/`・`ui/`・`audio/`・`storage/`・`app/`・`debug/`）への相対 import も禁止する
  - Biome の設定で表しきれない規則は、下の「import 規則のテスト」で補う
- Vitest
  - `src/**/*.test.ts` を対象にする。環境は node（`src/core` は必ず node で動くこと）
- Playwright
  - Chromium のみ。起動引数に `--use-angle=swiftshader` と `--enable-unsafe-swiftshader` を付け、GPU が無い環境でも WebGL が動くようにする
  - `webServer` で `pnpm vite --mode e2e --port 5174 --strictPort` を起動する（`reuseExistingServer: !process.env.CI`）
  - `testDir` は `e2e/`。`e2e/*.spec.ts`（通し）と `e2e/visual/*.spec.ts`（見た目）の両方を拾う
  - 共通フィクスチャ `e2e/fixtures/test.ts`: `test` を拡張し、`console` の `error` と `pageerror` を集めて、テストの終わりに 0 件であることを確かめる（自動で効く fixture にする。すべての spec はこの `test` を import する）
  - 真っ黒・真っ白の判定ヘルパ `e2e/fixtures/blank.ts`
  - 見た目のヘルパ: スクリーンショットを `screenshots/<場面名>.png` に保存し、真っ黒・真っ白でないことを確かめる関数
- `pnpm` スクリプト
  - `dev`（`vite`）、`build`（`tsc --noEmit && vite build`）、`preview`
  - `lint`（`biome check .`）、`format`（`biome format --write .`）、`typecheck`（`tsc --noEmit`）
  - `test`（`vitest run`）、`e2e`（`playwright test`）
  - `verify`: `biome check . && tsc --noEmit && vitest run && playwright test`（design.md §10）
- 最小のアプリ
  - `index.html` に全画面のキャンバスを 1 枚。`src/main.ts` で three の `WebGLRenderer`・`PerspectiveCamera`・`Scene` を作り、背景色と床のグリッド（`GridHelper`、y = 0 の XZ 平面）を描く。ウィンドウの大きさの変更に追従する
  - これは仮の画面で、S1-04 で描画の層（`src/render/`）に移す
- `src/core/constants.ts` を design.md §3 の内容そのままで作る
- `window.__gearSim` の枠（`src/debug/`）
  - `import.meta.env.MODE !== 'production'` のときだけ `window.__gearSim` を置く
  - このタスクでは `isReady(): boolean`（最初のフレームを描いたら `true`）だけを持つ。Playwright はこれを待ってから操作する
  - `Window` の型に `__gearSim?: GearSimDebug` を宣言する（`GearSimDebug` は後のタスクで広げていく）
- `.gitignore`: `node_modules/`、`dist/`、`screenshots/`、`test-results/`、`playwright-report/`、`blob-report/`、`coverage/`、`*.local`
- design.md §1 のディレクトリを、必要なものだけ作る（空のディレクトリは作らない）

## 範囲外
- 描画の層の分け方、シーンの同期（S1-04）
- カメラ操作（S1-13）
- 画面 UI の骨組み（S1-15）
- `__gearSim` の `getScene` などの API（S1-04 以降。足したタスクが design.md §10 を更新する）
- CI の設定（作らない）
- 性能計測のスクリプト（S1-31）

## 作るもの
- `package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`（`vite.config.ts` にまとめてもよい）、`biome.json`、`playwright.config.ts`、`.gitignore`、`index.html`
- `src/main.ts`
- `src/core/constants.ts`（design.md §3）
- `src/debug/gear-sim.ts`
  ```ts
  export interface GearSimDebug {
    isReady(): boolean;
  }
  export function installGearSim(api: GearSimDebug): void; // production では何もしない
  ```
- `e2e/fixtures/test.ts`
  ```ts
  export const test: TestType<...>; // console error / pageerror を集めて最後に 0 件を確かめる
  export { expect } from '@playwright/test';
  ```
- `e2e/fixtures/blank.ts`
  ```ts
  // RGBA の画素列から、輝度の分散がしきい値未満なら「真っ黒・真っ白（一色）」とみなす
  export const BLANK_VARIANCE_THRESHOLD: number; // 例: 4（輝度 0〜255 の分散）
  export function luminanceVariance(rgba: Uint8Array | Uint8ClampedArray): number;
  export function isBlankImage(rgba: Uint8Array | Uint8ClampedArray): boolean;
  ```
- `e2e/fixtures/visual.ts`
  ```ts
  // screenshots/<name>.png に保存し、isBlankImage でないことを expect する
  export async function captureScene(page: Page, name: string): Promise<void>;
  ```
  - PNG の復号には `pngjs` などの開発用依存を使ってよい
- `src/core/import-rules.test.ts`（import 規則のテスト。下を参照）

## 受け入れ条件
- [ ] `pnpm install` のあと `pnpm dev` でブラウザに床のグリッドが出る
- [ ] `pnpm verify` が通る
- [ ] `src/core` の中で `import * as THREE from 'three'` を書くと `biome check` が失敗する（確かめたら消す）
- [ ] `pnpm build` の成果物（production）では `window.__gearSim` が `undefined`
- [ ] コンソールにエラーを出す spec を一時的に書くと、フィクスチャによってその spec が失敗する（確かめたら消す）

## テストケース
### Vitest
- [ ] `src/core/constants.test.ts`: `GEAR_SIZES.S` が `{ module: 1, faceWidth: 4, minTeeth: 12, maxTeeth: 80 }`、`GEAR_SIZES.L.maxTeeth === 40`、`MOTOR_SIZES.M.stallTorque === 3`、`MOTOR_RPM_RANGE` が `{ min: 1, max: 120 }`、`PRESSURE_ANGLE` が `20 * Math.PI / 180` に近い
- [ ] `src/core/import-rules.test.ts`: `src/core/**/*.ts` を読み、次を含むファイルが 0 件
  - `from 'three'`、`from 'three/`、`from 'camera-controls'`
  - `src/core` の外の層への相対 import（`../render/` など、解決した先が `src/core` の外になるもの）
  - グローバルの `window.`、`document.`、`indexedDB`、`localStorage`、`AudioContext`（コメントと文字列は除外しなくてよい。誤検知したら表現を変える）
### Playwright
- [ ] `e2e/blank.spec.ts`（ページを開かない純粋なテスト）: 全画素 `(0,0,0,255)` の 64×64 → `isBlankImage` が `true`。全画素 `(255,255,255,255)` → `true`。8×8 の白黒の市松模様 → `false`
- [ ] `e2e/smoke.spec.ts`: `/` を開く → キャンバスが 1 枚ある → `__gearSim.isReady()` が `true` になるのを待てる → コンソールエラー 0 件（フィクスチャで確認）
### Playwright（見た目）
- [ ] `e2e/visual/empty-scene.spec.ts`: `/` を開いて準備完了を待ち、`captureScene(page, 'empty-scene')` → `screenshots/empty-scene.png` ができ、真っ黒・真っ白でない（グリッドが描かれていれば分散がしきい値を超える）

## 人が手で確かめる項目
- `pnpm exec playwright install chromium` の手順で、ブラウザの入っていない環境でも Playwright が動くか（必要なら README か `package.json` の `postinstall` に書く）
- `screenshots/empty-scene.png` に床のグリッドが見えること

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（`__gearSim.isReady()` を design.md §10 に足す。SwiftShader の起動引数、`noUncheckedIndexedAccess` を採ったことを design.md §10 に書く）
- [x] `status: done` にしてコミットした
