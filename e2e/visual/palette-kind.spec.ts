import type { Page } from '@playwright/test';
import type { Lang } from '../../src/core/i18n';
import { fixtureScene, openApp, selectPaletteKind } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S4-02: パレットの種類（ラック・遊星を足した 9 つ）と、かみ合えない種類を選んだときの注記を日本語と英語で撮る
// （ボタンの文字・注記のはみ出しを人が画像で確かめる）。平歯車 A を選び、パレットでウォームを選んだ状態

test.use({ viewport: VISUAL_VIEWPORT });

async function shoot(page: Page, lang: Lang): Promise<void> {
  await openApp(page, { scene: fixtureScene('one-root') });
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.__gearSim?.getLanguage())).toBe(lang);
  await page.evaluate(() => window.__gearSim?.select('gear_a'));
  await selectPaletteKind(page, 'worm');
  await expect(page.getByTestId('palette-kind-note')).toBeVisible();
  await prepareCapture(page);
  await captureScene(page, `palette-kind-note-${lang}`);
}

test.describe('日本語', () => {
  test.use({ locale: 'ja-JP' });

  test('palette-kind-note-ja: ウォームを選んだときの注記（日本語）', async ({ page }) => {
    await shoot(page, 'ja');
  });
});

test.describe('英語', () => {
  test.use({ locale: 'en-US' });

  test('palette-kind-note-en: ウォームを選んだときの注記（英語）', async ({ page }) => {
    await shoot(page, 'en');
  });
});
