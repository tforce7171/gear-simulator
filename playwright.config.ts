import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const HEAVY = '**/*.heavy.spec.ts';
const CHROMIUM = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    // GPU の無い環境でも WebGL を動かす（design.md §10）
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
};

export default defineConfig({
  testDir: 'e2e',
  // e2e/*.spec.ts（通し）と e2e/visual/*.spec.ts（見た目）
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  // SwiftShader（ソフトウェア描画）で PBR・環境マップ・影を描くと 1 ページの描画が重く、既定の並列数
  // （コア数の半分）ではページどうしが CPU を奪い合ってフレームが止まり、時間に依るテストが不安定になる。
  // 3 に絞っても全体の時間は変わらなかった（S1-24）
  workers: 3,
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
    reuseExistingServer: !process.env.CI,
  },
});
