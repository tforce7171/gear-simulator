import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/test';

// S1-24: テーマと質感

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

async function renderInfo(page: Page): Promise<RenderInfo> {
  const info = await page.evaluate(() => window.__gearSim?.getRenderInfo());
  if (info === undefined) throw new Error('__gearSim が無い');
  return info;
}

test('起動直後は真鍮・高品質で影が ON', async ({ page }) => {
  await open(page);
  expect(await renderInfo(page)).toMatchObject({
    theme: 'brass',
    quality: 'high',
    shadowMapEnabled: true,
  });
});

test('ツールバーのテーマボタンで木製になり、もう一度押すと真鍮に戻る', async ({ page }) => {
  await open(page);
  const button = page.getByTestId('toolbar-theme');
  await expect(button).toBeEnabled();
  await button.click();
  expect((await renderInfo(page)).theme).toBe('wood');
  await button.click();
  expect((await renderInfo(page)).theme).toBe('brass');
});

test('軽量にすると影が消えて解像度が 1、高品質に戻すと影が戻る', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__gearSim?.updateSettings({ quality: 'low' }));
  const low = await renderInfo(page);
  expect(low.quality).toBe('low');
  expect(low.shadowMapEnabled).toBe(false);
  expect(low.pixelRatio).toBe(1);
  await page.evaluate(() => window.__gearSim?.updateSettings({ quality: 'high' }));
  const high = await renderInfo(page);
  expect(high.quality).toBe('high');
  expect(high.shadowMapEnabled).toBe(true);
});
