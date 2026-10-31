import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { Lang } from '../../src/core/i18n';
import { isBlankImage } from '../fixtures/blank';
import { fixtureScene, openApp, selectPaletteKind } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S4-08: アイコン入りのパレット（種類 9 つ・大きさ S/M/L・起点のシャフト）を日本語と英語で撮る
// （どの歯車の絵か、文字のはみ出し、選んでいる状態の色を人が画像で確かめる）。
// パレットの部分だけを切り出した画像（palette-icons-<lang>）と、画面全体（palette-icons-<lang>-full）

test.use({ viewport: VISUAL_VIEWPORT, deviceScaleFactor: 2 });

async function saveImage(name: string, buffer: Buffer): Promise<void> {
  await mkdir('screenshots', { recursive: true });
  await writeFile(join('screenshots', `${name}.png`), buffer);
  const png = PNG.sync.read(buffer);
  expect(isBlankImage(png.data), `${name}: 真っ黒・真っ白でないこと`).toBe(false);
}

async function shoot(page: Page, lang: Lang): Promise<void> {
  await openApp(page, { scene: fixtureScene('one-root') });
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.__gearSim?.getLanguage())).toBe(lang);
  await selectPaletteKind(page, 'helical');
  await prepareCapture(page);
  await captureScene(page, `palette-icons-${lang}-full`);
  // パレットの部分を 2 倍の解像度で撮る（アイコンを見分けやすくする）
  const buffer = await page.getByTestId('palette').screenshot({ scale: 'device' });
  await saveImage(`palette-icons-${lang}`, buffer);
}

test.describe('日本語', () => {
  test.use({ locale: 'ja-JP' });

  test('palette-icons-ja: アイコン入りのパレット（日本語）', async ({ page }) => {
    await shoot(page, 'ja');
  });
});

test.describe('英語', () => {
  test.use({ locale: 'en-US' });

  test('palette-icons-en: アイコン入りのパレット（英語）', async ({ page }) => {
    await shoot(page, 'en');
  });
});
