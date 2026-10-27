import { expect, test } from './fixtures/test';

async function open(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
}

test.describe('ブラウザの言語が ja-JP', () => {
  test.use({ locale: 'ja-JP' });

  test('日本語で起動する', async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle('歯車シミュレーター');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    expect(await page.evaluate(() => window.__gearSim?.getLanguage())).toBe('ja');
  });

  test('setLanguage で題名と lang が切り替わり、戻せる', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__gearSim?.setLanguage('en'));
    await expect(page).toHaveTitle('Gear Simulator');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => window.__gearSim?.getLanguage())).toBe('en');

    await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
    await expect(page).toHaveTitle('歯車シミュレーター');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });
});

test.describe('ブラウザの言語が en-US', () => {
  test.use({ locale: 'en-US' });

  test('英語で起動する', async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle('Gear Simulator');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => window.__gearSim?.getLanguage())).toBe('en');
  });
});

test.describe('ブラウザの言語が fr', () => {
  test.use({ locale: 'fr-FR' });

  test('英語で起動する', async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle('Gear Simulator');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
