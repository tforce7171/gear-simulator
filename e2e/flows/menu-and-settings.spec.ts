import type { Vec3 } from '../../src/core/math/vec3';
import {
  fixtureScene,
  gearPoint,
  getScene,
  openApp,
  waitAutosaved,
  waitReady,
} from '../fixtures/sim';
import { expect, test } from '../fixtures/test';

// 通しテスト 6（S1-31）: 右クリックのメニューでモーターを付け、設定を変えて、再読み込みの後も残る

const sceneA = fixtureScene('scene-a');
const TOP_VIEW = { position: [0, 260, 30.001] as Vec3, target: [0, 0, 30] as Vec3 };

test('右クリックと設定: メニューで付けたモーター・テーマ・言語が再読み込みの後も残る', async ({
  page,
}) => {
  await openApp(page, { scene: sceneA, camera: TOP_VIEW });

  // g2 を右クリック → 「モーターを付ける」
  const p = await gearPoint(page, 'gear_g2');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.locator('[data-action="attachMotor"]').click();
  await expect(menu).toHaveCount(0);
  const attached = Object.values((await getScene(page)).motors).find(
    (m) => m.shaftId === 'shaft_s2',
  );
  expect(attached).toBeDefined();

  // 設定でテーマを木製、言語を英語に
  await page.getByTestId('toolbar-settings').click();
  const dialog = page.getByTestId('settings-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-setting="theme"] [data-value="wood"]').click();
  await dialog.locator('[data-setting="language"] [data-value="en"]').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const scene = await getScene(page);

  await waitAutosaved(page);
  await page.reload();
  await waitReady(page);
  const state = await page.evaluate(() => ({
    settings: window.__gearSim?.getSettings(),
    theme: window.__gearSim?.getRenderInfo().theme,
    lang: window.__gearSim?.getLanguage(),
  }));
  expect(state.settings).toMatchObject({ theme: 'wood', language: 'en' });
  expect(state.theme).toBe('wood');
  expect(state.lang).toBe('en');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(await getScene(page)).toEqual(scene);
  expect((await getScene(page)).motors[attached?.id ?? '']).toEqual(attached);
});
