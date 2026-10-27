import { expect, test } from './fixtures/test';

test('ページを開くとキャンバスが 1 枚あり、準備完了になる', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
});
