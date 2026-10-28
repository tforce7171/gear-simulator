import type { Page } from '@playwright/test';
import { fixtureScene, loadScene, openApp } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S1-31: 作品を 2 つ保存した後の作品一覧（サムネイル・名前・日時の並びを人が画像で確かめる）

test.use({ viewport: VISUAL_VIEWPORT, locale: 'ja-JP' });

async function save(page: Page, name: string, asNew: boolean): Promise<void> {
  await page.getByTestId('toolbar-save').click();
  const dialog = page.getByTestId('save-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('save-name').fill(name);
  await dialog.getByTestId(asNew ? 'save-as-new' : 'save-submit').click();
  await expect(dialog).toHaveCount(0);
}

test('works-list: 作品一覧', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, { scene: fixtureScene('scene-a') });
  await page.keyboard.press('Home');
  await prepareCapture(page);
  await save(page, '三枚の列', false);
  await expect
    .poll(() => page.evaluate(() => window.__gearSim?.getStorageStatus().currentWorkId))
    .not.toBeNull();

  await loadScene(page, fixtureScene('showcase'));
  await page.keyboard.press('Home');
  await prepareCapture(page);
  await save(page, '見本', true);

  await page.getByTestId('toolbar-works').click();
  const dialog = page.getByTestId('works-dialog');
  await expect(dialog.getByTestId('work-card')).toHaveCount(2);
  // サムネイルを読み終えるまで待つ
  await expect
    .poll(() =>
      dialog
        .getByTestId('work-thumbnail')
        .evaluateAll((els) => els.every((el) => (el as HTMLImageElement).complete)),
    )
    .toBe(true);
  await captureScene(page, 'works-list');
});
