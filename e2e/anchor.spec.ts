import type { Page } from '@playwright/test';
import type { Vec3 } from '../src/core/math/vec3';
import {
  blur,
  clickGear,
  deselect,
  fixtureScene,
  gearPoint,
  getMotion,
  getScene,
  openApp,
  waitAutosaved,
  waitReady,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S3-01: 固定具（アンカー）。anchor-pair は縦軸の起点 shaft_a（原点 [0, 35, 0]）に中・20 歯 A とモーター 中
// （30 rpm = π rad/s、正の向き、ON）、A の外周（角度 0）に中・40 歯 B（shaft_b）。固定具はなし
const anchorPair = fixtureScene('anchor-pair');

// 2 枚を斜め上から見る
const VIEW = { position: [30, 220, 160] as Vec3, target: [30, 35, 0] as Vec3 };

const menu = (page: Page) => page.getByTestId('context-menu');
const menuItem = (page: Page, action: string) => menu(page).locator(`[data-action="${action}"]`);

async function rightClickGear(page: Page, gearId: string): Promise<void> {
  const p = await gearPoint(page, gearId);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
}

test('B を右クリック →「固定する」→ 固定具 1 件、ロック anchor、全 ω が 0。「固定を外す」→ 回り出す', async ({
  page,
}) => {
  await openApp(page, { scene: anchorPair, camera: VIEW });
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  expect((await getMotion(page)).locks).toEqual([]);

  await rightClickGear(page, 'gear_b');
  await expect(menuItem(page, 'anchor')).toHaveText('固定する');
  await menuItem(page, 'anchor').click();
  await expect(menu(page)).toHaveCount(0);
  const anchors = Object.values((await getScene(page)).anchors);
  expect(anchors.map((a) => a.target)).toEqual([{ kind: 'shaft', id: 'shaft_b' }]);
  const locked = await getMotion(page);
  expect(locked.locks.map((l) => l.reason)).toEqual(['anchor']);
  expect(Object.values(locked.omegas).every((w) => w === 0)).toBe(true);
  expect(Object.keys(locked.omegas).sort()).toEqual(['shaft_a', 'shaft_b']);

  // 同じ B を右クリック →「固定を外す」（選んだ B のハンドル・候補の陰にならないよう、選択を外してから）
  await deselect(page);
  await rightClickGear(page, 'gear_b');
  await expect(menuItem(page, 'anchor')).toHaveCount(0);
  await expect(menuItem(page, 'unanchor')).toHaveText('固定を外す');
  await menuItem(page, 'unanchor').click();
  await expect(menu(page)).toHaveCount(0);
  expect((await getScene(page)).anchors).toEqual({});
  const freed = await getMotion(page);
  expect(freed.locks).toEqual([]);
  expect(freed.omegas.shaft_a).toBeCloseTo(Math.PI, 6);
});

test('A を選んでプロパティパネルの「固定する」をチェック → A のシャフトが固定される。Ctrl+Z で外れる', async ({
  page,
}) => {
  await openApp(page, { scene: anchorPair, camera: VIEW });
  await clickGear(page, 'gear_a');
  const check = page.getByTestId('prop-anchor-check');
  await expect(check).not.toBeChecked();
  // 歯車を選んでいるときは、そのシャフトを固定する旨を出す
  await expect(page.getByTestId('prop-anchor-note')).toBeVisible();
  await check.check();
  await expect(page.getByTestId('prop-anchor-check')).toBeChecked();
  const anchors = Object.values((await getScene(page)).anchors);
  expect(anchors.map((a) => a.target)).toEqual([{ kind: 'shaft', id: 'shaft_a' }]);
  expect((await getMotion(page)).locks.map((l) => l.reason)).toEqual(['anchor']);

  await blur(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await getScene(page)).anchors).toEqual({});
  await expect(page.getByTestId('prop-anchor-check')).not.toBeChecked();
  expect((await getMotion(page)).locks).toEqual([]);
});

test('チェックを外すと固定も外れる。英語では「Anchor」', async ({ page }) => {
  await openApp(page, { scene: anchorPair, camera: VIEW });
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await clickGear(page, 'gear_b');
  await page.getByTestId('prop-anchor-check').check();
  await expect(page.getByTestId('prop-anchor')).toContainText('Anchor');
  expect(Object.keys((await getScene(page)).anchors)).toHaveLength(1);
  await page.getByTestId('prop-anchor-check').uncheck();
  await expect.poll(async () => (await getScene(page)).anchors).toEqual({});
});

test('固定具の付いたシーンは自動保存から復元される（anchors を読む）', async ({ page }) => {
  const scene = {
    ...anchorPair,
    anchors: { anchor_1: { id: 'anchor_1', target: { kind: 'shaft' as const, id: 'shaft_b' } } },
  };
  await openApp(page, { scene });
  await waitAutosaved(page);
  await page.reload();
  await waitReady(page);
  expect((await getScene(page)).anchors).toEqual(scene.anchors);
  expect((await getMotion(page)).locks.map((l) => l.reason)).toEqual(['anchor']);
});
