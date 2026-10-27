import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-23: 情報表示

// シーン A: shaft_s1（モーター 小、60 rpm、+1、ON）に gear_g1（小、12 枚）。g1 の外周に gear_g2（小、36 枚）、
// g2 の外周に gear_g3（小、24 枚）。どれも縦軸で、+Z の向きに一直線に並ぶ
const sceneA = JSON.parse(
  readFileSync(new URL('./fixtures/scene-a.json', import.meta.url), 'utf8'),
) as Scene;

// 上から少し斜めに 3 枚を見る視点
const VIEW = { position: [70, 110, 40] as Vec3, target: [0, 20, 28] as Vec3 };

type InfoOverlayState = {
  enabled: boolean;
  arrows: Array<{ gearId: string; direction: 1 | -1 }>;
};

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), sceneA);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), VIEW);
}

async function getInfoOverlay(page: Page): Promise<InfoOverlayState> {
  const state = await page.evaluate(() => window.__gearSim?.getInfoOverlay());
  if (state === undefined) throw new Error('__gearSim が無い');
  return state;
}

async function getLayout(page: Page): Promise<Layout> {
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  if (layout === undefined) throw new Error('__gearSim が無い');
  return layout;
}

async function clickGear(page: Page, gearId: string): Promise<void> {
  const center = (await getLayout(page)).gears[gearId]?.center;
  if (center === undefined) throw new Error(`${gearId} の配置が無い`);
  const p = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), center);
  if (p === undefined) throw new Error('__gearSim が無い');
  await page.mouse.click(p.x, p.y);
}

const labels = (page: Page) => page.getByTestId('info-label');

test('起動直後は OFF でラベル 0 個。g2 をクリックすると g2 だけに 20.0 rpm・3.00 : 1 と矢印 −1', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId('toolbar-info')).toHaveAttribute('aria-pressed', 'false');
  expect((await getInfoOverlay(page)).enabled).toBe(false);
  await expect(labels(page)).toHaveCount(0);

  await clickGear(page, 'gear_g2');
  await expect
    .poll(() => page.evaluate(() => window.__gearSim?.getSelection()))
    .toEqual(['gear_g2']);
  await expect(labels(page)).toHaveCount(1);
  const label = labels(page).first();
  await expect(label).toHaveAttribute('data-gear-id', 'gear_g2');
  await expect(label).toBeVisible();
  await expect(label).toContainText('20.0 rpm');
  await expect(label).toContainText('3.00 : 1');
  await expect
    .poll(async () => (await getInfoOverlay(page)).arrows)
    .toEqual([{ gearId: 'gear_g2', direction: -1 }]);
});

test('ボタンで ON にすると全歯車（3 個）、もう一度押すと選択中の g2 だけに戻る', async ({
  page,
}) => {
  await open(page);
  await clickGear(page, 'gear_g2');
  await expect(labels(page)).toHaveCount(1);

  const button = page.getByTestId('toolbar-info');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect((await getInfoOverlay(page)).enabled).toBe(true);
  await expect(labels(page)).toHaveCount(3);
  await expect
    .poll(async () => (await getInfoOverlay(page)).arrows)
    .toEqual([
      { gearId: 'gear_g1', direction: 1 },
      { gearId: 'gear_g2', direction: -1 },
      { gearId: 'gear_g3', direction: 1 },
    ]);
  await expect(page.locator('[data-testid="info-label"][data-gear-id="gear_g1"]')).toContainText(
    '60.0 rpm',
  );
  await expect(page.locator('[data-testid="info-label"][data-gear-id="gear_g3"]')).toContainText(
    '2.00 : 1',
  );

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect((await getInfoOverlay(page)).enabled).toBe(false);
  await expect(labels(page)).toHaveCount(1);
  await expect(labels(page).first()).toHaveAttribute('data-gear-id', 'gear_g2');
});

test('モーターを OFF にすると 0.0 rpm・矢印なし、ギア比は変わらない', async ({ page }) => {
  await open(page);
  await clickGear(page, 'gear_g2');
  await expect(labels(page).first()).toContainText('20.0 rpm');
  await page.evaluate(() =>
    window.__gearSim?.dispatch({
      type: 'updateMotor',
      motorId: 'motor_m1',
      patch: { on: false },
    }),
  );
  await expect(labels(page).first()).toContainText('0.0 rpm');
  await expect(labels(page).first()).toContainText('3.00 : 1');
  await expect.poll(async () => (await getInfoOverlay(page)).arrows).toEqual([]);
});

test('言語を英語にするとラベルが Ratio を含み、日本語に戻すとギア比を含む', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await clickGear(page, 'gear_g2');
  await expect(labels(page).first()).toContainText('ギア比');
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await expect(labels(page).first()).toContainText('Ratio');
  await expect(labels(page).first()).toContainText('3.00 : 1');
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await expect(labels(page).first()).toContainText('ギア比');
});

test('カメラの後ろに回った歯車のラベルは隠れる', async ({ page }) => {
  await open(page);
  await page.getByTestId('toolbar-info').click();
  await expect(labels(page)).toHaveCount(3);
  // g1（原点のあたり）と g2 の間からカメラを +Z に向ける。g1 はカメラの後ろになる
  await page.evaluate(() =>
    window.__gearSim?.setCamera({ position: [0, 40, 20], target: [0, 22, 60] }),
  );
  await expect(page.locator('[data-testid="info-label"][data-gear-id="gear_g1"]')).toBeHidden();
  await expect(page.locator('[data-testid="info-label"][data-gear-id="gear_g3"]')).toBeVisible();
});
