import type { Page } from '@playwright/test';
import { test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  // 描いたシーンが写るまで 2 フレーム待つ
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.describe('日本語', () => {
  test.use({ locale: 'ja-JP' });

  test('日本語の UI', async ({ page }) => {
    await open(page);
    await captureScene(page, 'ui-ja');
  });
});

test.describe('英語', () => {
  test.use({ locale: 'en-US' });

  test('英語の UI', async ({ page }) => {
    await open(page);
    await captureScene(page, 'ui-en');
  });
});
