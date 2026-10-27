import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';

// S1-24: テーマと品質を何度切り替えても、テクスチャが増え続けない（古いものを dispose する）。
// 切り替えのたびに環境マップとシェーダーを作り直して CPU を長く使うので、*.heavy.spec.ts として
// 他のテストが終わってから流す（playwright.config.ts の chromium-heavy）

type RenderInfo = {
  theme: 'brass' | 'wood';
  quality: 'high' | 'low';
  shadowMapEnabled: boolean;
  pixelRatio: number;
  textures: number;
};

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
}

// 次のフレームを描き終えるまで待つ（テクスチャは描いたときに GPU へ送られて数に入る）
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function renderInfo(page: Page): Promise<RenderInfo> {
  const info = await page.evaluate(() => window.__gearSim?.getRenderInfo());
  if (info === undefined) throw new Error('__gearSim が無い');
  return info;
}

test('テーマと品質を交互に 20 回切り替えても、テクスチャの数が増えない', async ({ page }) => {
  // 品質の切り替えのたびに環境マップを作り直し、シェーダーも作り直すので、ソフトウェア描画では時間がかかる
  test.setTimeout(180_000);
  await open(page);
  const toggleTheme = async (): Promise<void> => {
    await page.getByTestId('toolbar-theme').click();
    await nextFrames(page);
  };
  const toggleQuality = async (): Promise<void> => {
    const { quality } = await renderInfo(page);
    await page.evaluate(
      (q) => window.__gearSim?.updateSettings({ quality: q }),
      (quality === 'high' ? 'low' : 'high') as RenderInfo['quality'],
    );
    await nextFrames(page);
  };
  // 1 回目の切り替え（真鍮 → 木製）の直後を基準にする
  await toggleTheme();
  const first = await renderInfo(page);
  expect(first).toMatchObject({ theme: 'wood', quality: 'high' });
  // 品質から始めて交互に 20 回（品質 10 回・テーマ 10 回）。最後は基準と同じ木製・高品質に戻る
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) await toggleQuality();
    else await toggleTheme();
  }
  const last = await renderInfo(page);
  expect(last).toMatchObject({ theme: 'wood', quality: 'high' });
  expect(last.textures).toBe(first.textures);
});
