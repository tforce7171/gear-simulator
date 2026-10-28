import type { Page } from '@playwright/test';
import { en } from '../src/core/i18n/en';
import { ja } from '../src/core/i18n/ja';
import { expect, test } from './fixtures/test';

// S1-30: 設定画面と設定の保存

test.use({ locale: 'ja-JP' });

type Settings = {
  quality: 'high' | 'low';
  inputDevice: 'auto' | 'mouse' | 'trackpad';
  trackpadScroll: 'pan' | 'orbit';
  language: 'ja' | 'en';
  theme: 'brass' | 'wood';
  muted: boolean;
};

const DEFAULTS: Settings = {
  quality: 'high',
  inputDevice: 'auto',
  trackpadScroll: 'pan',
  language: 'ja',
  theme: 'brass',
  muted: false,
};

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
}

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await waitReady(page);
}

async function getSettings(page: Page): Promise<Settings> {
  const settings = await page.evaluate(() => window.__gearSim?.getSettings());
  if (settings === undefined) throw new Error('__gearSim が無い');
  return settings;
}

async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('toolbar-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

// 設定画面の項目 field で value を選ぶ
async function choose(page: Page, field: keyof Settings, value: string): Promise<void> {
  const button = page
    .getByTestId('settings-dialog')
    .locator(`[data-setting="${field}"] [data-value="${value}"]`);
  await button.click();
  await expect(button).toHaveAttribute('aria-checked', 'true');
}

test('テーマ「木製」で描画と音の材質が木になり、品質「軽量」で描画が軽量になる', async ({
  page,
}) => {
  await open(page);
  await openSettings(page);
  await choose(page, 'theme', 'wood');
  const afterTheme = await page.evaluate(() => ({
    render: window.__gearSim?.getRenderInfo(),
    audio: window.__gearSim?.getAudio(),
  }));
  expect(afterTheme.render?.theme).toBe('wood');
  expect(afterTheme.audio?.material).toBe('wood');
  await choose(page, 'quality', 'low');
  expect((await page.evaluate(() => window.__gearSim?.getRenderInfo()))?.quality).toBe('low');
  // 真鍮に戻すと音も金属に戻る
  await choose(page, 'theme', 'brass');
  expect((await page.evaluate(() => window.__gearSim?.getAudio()))?.material).toBe('metal');
});

test('5 項目を選べ、選んだものだけが選ばれた状態になる', async ({ page }) => {
  await open(page);
  await openSettings(page);
  const dialog = page.getByTestId('settings-dialog');
  for (const field of ['quality', 'inputDevice', 'trackpadScroll', 'language', 'theme']) {
    await expect(dialog.locator(`[data-setting="${field}"]`)).toHaveCount(1);
  }
  await expect(dialog.locator('[data-setting="muted"]')).toHaveCount(0);
  await choose(page, 'inputDevice', 'trackpad');
  await choose(page, 'trackpadScroll', 'orbit');
  await expect(
    dialog.locator('[data-setting="inputDevice"] [aria-checked="true"]'),
  ).toHaveAttribute('data-value', 'trackpad');
  await expect(dialog.locator('[data-setting="inputDevice"] [aria-checked="true"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__gearSim?.getInputDevice())).toBe('trackpad');
  expect(await getSettings(page)).toMatchObject({
    inputDevice: 'trackpad',
    trackpadScroll: 'orbit',
  });
});

test('言語「English」でツールバーとダイアログの文字が英語になる', async ({ page }) => {
  await open(page);
  await openSettings(page);
  const dialog = page.getByTestId('settings-dialog');
  await expect(dialog.locator('h2')).toHaveText(ja['settings.title']);
  // 言語の選択肢の表示名は、いまの言語に関係なくその言語で書く
  await expect(dialog.locator('[data-setting="language"] [data-value="ja"]')).toHaveText('日本語');
  await expect(dialog.locator('[data-setting="language"] [data-value="en"]')).toHaveText('English');
  await choose(page, 'language', 'en');
  await expect(dialog.locator('h2')).toHaveText('Settings');
  await expect(dialog.locator('[data-setting="theme"] [data-value="wood"]')).toHaveText(
    en['theme.wood'],
  );
  await expect(page.getByTestId('toolbar-settings')).toHaveText(en['toolbar.settings']);
  await expect(page.getByTestId('toolbar-save')).toHaveText(en['toolbar.save']);
  await expect(dialog.locator('[data-setting="language"] [data-value="ja"]')).toHaveText('日本語');
  expect(await page.evaluate(() => window.__gearSim?.getLanguage())).toBe('en');
  expect((await getSettings(page)).language).toBe('en');
});

test('__gearSim.setLanguage でも settings.language が変わる', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  expect((await getSettings(page)).language).toBe('en');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
});

test('変えた 5 項目とミュートが再読み込みの後も残る', async ({ page }) => {
  await open(page);
  await openSettings(page);
  await choose(page, 'theme', 'wood');
  await choose(page, 'quality', 'low');
  await choose(page, 'language', 'en');
  await choose(page, 'inputDevice', 'mouse');
  await choose(page, 'trackpadScroll', 'orbit');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
  await page.keyboard.press('m');
  const changed: Settings = {
    quality: 'low',
    inputDevice: 'mouse',
    trackpadScroll: 'orbit',
    language: 'en',
    theme: 'wood',
    muted: true,
  };
  expect(await getSettings(page)).toEqual(changed);

  await page.reload();
  await waitReady(page);
  expect(await getSettings(page)).toEqual(changed);
  await expect(page.getByTestId('toolbar-mute')).toHaveAttribute('aria-pressed', 'true');
  const state = await page.evaluate(() => ({
    render: window.__gearSim?.getRenderInfo(),
    audio: window.__gearSim?.getAudio(),
    lang: window.__gearSim?.getLanguage(),
    device: window.__gearSim?.getInputDevice(),
  }));
  expect(state.render?.theme).toBe('wood');
  expect(state.render?.quality).toBe('low');
  expect(state.audio?.material).toBe('wood');
  expect(state.audio?.muted).toBe(true);
  expect(state.lang).toBe('en');
  expect(state.device).toBe('mouse');
  await expect(page.getByTestId('toolbar-settings')).toHaveText(en['toolbar.settings']);
});

test('ツールバーのテーマボタンで木製にしてから開くと、テーマの選択が「木製」', async ({ page }) => {
  await open(page);
  await page.getByTestId('toolbar-theme').click();
  await openSettings(page);
  const theme = page.getByTestId('settings-dialog').locator('[data-setting="theme"]');
  await expect(theme.locator('[data-value="wood"]')).toHaveAttribute('aria-checked', 'true');
  await expect(theme.locator('[data-value="brass"]')).toHaveAttribute('aria-checked', 'false');
});

test("localStorage の設定が '{bad' なら初期値で起動する", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gear-simulator:settings', '{bad');
  });
  await open(page);
  expect(await getSettings(page)).toEqual(DEFAULTS);
});

test('項目ごとに検証し、正しい項目だけ生かす', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'gear-simulator:settings',
      JSON.stringify({ version: 1, theme: 'wood', quality: 'ultra', muted: true }),
    );
  });
  await open(page);
  expect(await getSettings(page)).toEqual({ ...DEFAULTS, theme: 'wood', muted: true });
});

test('localStorage の読み書きが投げても初期値で起動し、保存できなかったトーストは 1 回だけ', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
  });
  await open(page);
  expect(await getSettings(page)).toEqual(DEFAULTS);
  const failed = page.getByTestId('toast').filter({ hasText: ja['settings.saveFailed'] });
  await expect(failed).toHaveCount(0);

  await openSettings(page);
  await choose(page, 'theme', 'wood');
  await expect(failed).toHaveCount(1);
  await choose(page, 'quality', 'low');
  expect(await getSettings(page)).toMatchObject({ theme: 'wood', quality: 'low' });
  expect((await page.evaluate(() => window.__gearSim?.getRenderInfo()))?.quality).toBe('low');
  await expect(failed).toHaveCount(1);
  await expect(page.getByTestId('toast')).toHaveCount(1);
});

test('Esc・閉じるボタン・ダイアログの外のクリックで閉じる', async ({ page }) => {
  await open(page);
  const dialog = page.getByTestId('settings-dialog');

  await openSettings(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await openSettings(page);
  await page.getByTestId('settings-close').click();
  await expect(dialog).toHaveCount(0);

  await openSettings(page);
  // ダイアログの内側（余白）のクリックでは閉じない
  const box = await dialog.boundingBox();
  if (box === null) throw new Error('ダイアログの boundingBox が無い');
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
});
