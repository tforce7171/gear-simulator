import type { Page } from '@playwright/test';
import type { Lang } from '../../src/core/i18n';
import { fixtureScene, openApp } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S1-15・S1-31: 画面の骨組みを日本語と英語で撮る。歯車を 1 枚選んでプロパティパネルを出した状態と、
// 設定画面を開いた状態（文字のはみ出し・訳し漏れを人が画像で確かめる）

test.use({ viewport: VISUAL_VIEWPORT });

const sceneA = fixtureScene('scene-a');

async function shoot(page: Page, lang: Lang): Promise<void> {
  await openApp(page, { scene: sceneA });
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.__gearSim?.getLanguage())).toBe(lang);
  await page.evaluate(() => window.__gearSim?.select('gear_g2'));
  await expect(page.getByTestId('prop-heading')).toBeVisible();
  await prepareCapture(page);
  await captureScene(page, `ui-${lang}`);

  await page.getByTestId('toolbar-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await captureScene(page, `ui-${lang}-settings`);
}

test.describe('日本語', () => {
  test.use({ locale: 'ja-JP' });

  test('ui-ja・ui-ja-settings: 日本語の UI', async ({ page }) => {
    await shoot(page, 'ja');
  });
});

test.describe('英語', () => {
  test.use({ locale: 'en-US' });

  test('ui-en・ui-en-settings: 英語の UI', async ({ page }) => {
    await shoot(page, 'en');
  });
});
