import { createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HEAVY = '**/*.heavy.spec.ts';

// WebGL の描き方（design.md §10）。GPU のレンダーノードを読み書きできれば ANGLE の Vulkan で GPU に描かせ、
// できなければ SwiftShader（ソフトウェア描画）に戻す。E2E_RENDER=gpu|swiftshader で強制できる。
// GPU を使うには、ユーザーが render グループに入っていること（入れたあとはログインし直す）。
function detectRender(): 'gpu' | 'swiftshader' {
  const forced = process.env.E2E_RENDER;
  if (forced === 'gpu' || forced === 'swiftshader') return forced;
  try {
    accessSync('/dev/dri/renderD128', constants.R_OK | constants.W_OK);
    return 'gpu';
  } catch {
    return 'swiftshader';
  }
}

// webServer のポート。チェックアウトごとに変えて、ワークツリーどうしが他方の vite に相乗りしないようにする。
// メインのチェックアウトは 5174。ワークツリー（.git がファイル）は、パスのハッシュから 5200〜5999 の中で決める。
// E2E_PORT で上書きできる。
function detectPort(): number {
  const forced = Number(process.env.E2E_PORT);
  if (Number.isInteger(forced) && forced > 0) return forced;
  let isWorktree = false;
  try {
    isWorktree = statSync(`${ROOT}/.git`).isFile();
  } catch {
    // .git が無い（展開したソースなど）ときはメインと同じ扱い
  }
  if (!isWorktree) return 5174;
  const hash = createHash('sha1').update(ROOT).digest().readUInt32BE(0);
  return 5200 + (hash % 800);
}

// Playwright の worker もこのファイルを読み込むので、最初に決めた値を環境変数に書いて揃える
process.env.E2E_RENDER ??= detectRender();
process.env.E2E_PORT ??= String(detectPort());
const RENDER = process.env.E2E_RENDER as 'gpu' | 'swiftshader';
const PORT = Number(process.env.E2E_PORT);

const ARGS = {
  gpu: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
}[RENDER];

// 並列数。SwiftShader は 1 ページの描画で CPU を 3 コア分ほど使い、既定の並列数（コア数の半分）では
// ページどうしが CPU を奪い合ってフレームが止まり、時間に依るテストが不安定になる（S1-24）ので 3 に絞る。
// GPU では 6（12 コアの機械で、3 → 6 で全体が 2.8 分 → 2.1 分、9 では 1.8 分だが load が 25 まで上がる。
// 他のセッションと並べても余裕が残る 6 にした）。E2E_WORKERS で上書きできる。
const WORKERS = Number(process.env.E2E_WORKERS) || (RENDER === 'gpu' ? 6 : 3);

const CHROMIUM = {
  ...devices['Desktop Chrome'],
  launchOptions: { args: ARGS },
};

export default defineConfig({
  testDir: 'e2e',
  // e2e/*.spec.ts（通し）と e2e/visual/*.spec.ts（見た目）
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: WORKERS,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: HEAVY,
      use: CHROMIUM,
    },
    {
      // CPU を長く使い続けるテスト（*.heavy.spec.ts。S1-24 のテーマと品質の 20 回の切り替えなど）は、
      // 他のテストが終わってから流す（同時に流すと、他のテストのページのフレームが止まるため）
      name: 'chromium-heavy',
      testMatch: HEAVY,
      dependencies: ['chromium'],
      use: CHROMIUM,
    },
  ],
  webServer: {
    command: `pnpm vite --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // ポートはチェックアウトごとに違うので、相乗りしても同じコードの vite
    reuseExistingServer: !process.env.CI,
  },
});
