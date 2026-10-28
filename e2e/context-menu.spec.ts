import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import type { CameraPose } from '../src/input/camera';
import { expect, test } from './fixtures/test';

// S1-29: コンテキストメニュー

// シーン A: shaft_s1（モーター motor_m1）に gear_g1。g1 の外周に gear_g2（shaft_s2、モーターなし）、
// g2 の外周に gear_g3（shaft_s3）。どれも縦軸で、+Z の向きに一直線に並ぶ
const sceneA = JSON.parse(
  readFileSync(new URL('./fixtures/scene-a.json', import.meta.url), 'utf8'),
) as Scene;

// 上から少し斜めに 3 枚を見る視点（S1-23 と同じ）
const VIEW = { position: [70, 110, 40] as Vec3, target: [0, 20, 28] as Vec3 };

const menu = (page: Page) => page.getByTestId('context-menu');
const items = (page: Page) => menu(page).locator('[data-action]');
const menuItem = (page: Page, action: string) => menu(page).locator(`[data-action="${action}"]`);

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('__gearSim が無い');
  return value;
}

const getScene = async (page: Page): Promise<Scene> =>
  defined(await page.evaluate(() => window.__gearSim?.getScene()));
const getCamera = async (page: Page): Promise<CameraPose> =>
  defined(await page.evaluate(() => window.__gearSim?.getCamera()));
const getSelection = async (page: Page): Promise<string[]> =>
  defined(await page.evaluate(() => window.__gearSim?.getSelection()));
const getView = async (page: Page): Promise<{ infoOverlay: boolean; watchMode: boolean }> =>
  defined(await page.evaluate(() => window.__gearSim?.getView()));
const motorsOnS2 = async (page: Page): Promise<number> =>
  Object.values((await getScene(page)).motors).filter((m) => m.shaftId === 'shaft_s2').length;

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), sceneA);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), VIEW);
}

async function gearPoint(page: Page, gearId: string): Promise<{ x: number; y: number }> {
  const layout: Layout = defined(await page.evaluate(() => window.__gearSim?.getLayout()));
  const center = layout.gears[gearId]?.center;
  if (center === undefined) throw new Error(`${gearId} の配置が無い`);
  const p = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), center);
  if (p === undefined) throw new Error('__gearSim が無い');
  return p;
}

// 描画領域の左上の隅（パレットとツールバーを避けた、部品の無い所）
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  return { x: box.x + 20, y: box.y + 20 };
}

async function rightClick(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
}

// カメラの移動が終わるのを待つ。時間ではなく描画のフレームで数え、3 フレーム続けて
// 位置も注視点も動かなかったら止まったとみなす（負荷で rAF が止まっても途中で抜けない）
async function settledCamera(page: Page): Promise<CameraPose> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const sim = window.__gearSim;
        if (sim === undefined) {
          reject(new Error('__gearSim が無い'));
          return;
        }
        const flat = (c: CameraPose) => [...c.position, ...c.target];
        let last = flat(sim.getCamera());
        let still = 0;
        const tick = () => {
          const now = flat(sim.getCamera());
          const moved = now.reduce((sum, v, i) => sum + Math.abs(v - (last[i] ?? 0)), 0);
          last = now;
          still = moved < 1e-6 ? still + 1 : 0;
          if (still >= 3) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  return getCamera(page);
}

test('g2 で右クリック → メニューに 3 項目、2 つ目が attachMotor、g2 が選ばれる', async ({
  page,
}) => {
  await open(page);
  await rightClick(page, await gearPoint(page, 'gear_g2'));
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).nth(1)).toHaveAttribute('data-action', 'attachMotor');
  await expect(menu(page)).toHaveAttribute('role', 'menu');
  await expect(items(page).first()).toHaveAttribute('role', 'menuitem');
  await expect(items(page).first()).toBeFocused();
  expect(await getSelection(page)).toEqual(['gear_g2']);
});

test('モーターを付ける → 閉じて s2 にモーターが増える。外す → 消える。Ctrl+Z → 戻る', async ({
  page,
}) => {
  await open(page);
  const at = await gearPoint(page, 'gear_g2');
  expect(await motorsOnS2(page)).toBe(0);
  await rightClick(page, at);
  await menuItem(page, 'attachMotor').click();
  await expect(menu(page)).toHaveCount(0);
  expect(await motorsOnS2(page)).toBe(1);

  await rightClick(page, at);
  await expect(items(page).nth(1)).toHaveAttribute('data-action', 'detachMotor');
  await menuItem(page, 'detachMotor').click();
  await expect(menu(page)).toHaveCount(0);
  expect(await motorsOnS2(page)).toBe(0);

  await page.keyboard.press('Control+z');
  expect(await motorsOnS2(page)).toBe(1);
});

test('g3 で右クリック → 削除 → g3 が無い。Ctrl+Z → 戻る', async ({ page }) => {
  await open(page);
  await rightClick(page, await gearPoint(page, 'gear_g3'));
  await menuItem(page, 'delete').click();
  await expect(menu(page)).toHaveCount(0);
  const gearIds = async () => Object.keys((await getScene(page)).gears);
  expect(await gearIds()).not.toContain('gear_g3');
  await page.keyboard.press('Control+z');
  expect(await gearIds()).toContain('gear_g3');
});

test('g2 で右クリック → ここに寄る → 注視点が右クリックした位置の点（1 mm 未満）', async ({
  page,
}) => {
  await open(page);
  const at = await gearPoint(page, 'gear_g2');
  const hit = await page.evaluate((p) => window.__gearSim?.pick(p.x, p.y), at);
  if (hit === null || hit === undefined) throw new Error('g2 に当たらない');
  await rightClick(page, at);
  await menuItem(page, 'focusHere').click();
  await expect
    .poll(async () => dist((await getCamera(page)).target, hit.point), { timeout: 15000 })
    .toBeLessThan(1);
  const pose = await settledCamera(page);
  expect(dist(pose.target, hit.point)).toBeLessThan(1);
});

test('何もない所で右クリック → 3 項目。情報表示 → ON、ラベル 3 個、もう一度開くと aria-checked=true', async ({
  page,
}) => {
  await open(page);
  const at = await emptyPoint(page);
  await rightClick(page, at);
  await expect(items(page)).toHaveCount(3);
  await expect(items(page).nth(0)).toHaveAttribute('data-action', 'frameAll');
  await expect(menuItem(page, 'toggleInfo')).toHaveAttribute('role', 'menuitemcheckbox');
  await expect(menuItem(page, 'toggleInfo')).toHaveAttribute('aria-checked', 'false');
  expect(await getSelection(page)).toEqual([]);
  await menuItem(page, 'toggleInfo').click();
  await expect(menu(page)).toHaveCount(0);
  expect((await getView(page)).infoOverlay).toBe(true);
  await expect(page.getByTestId('info-label')).toHaveCount(3);
  await expect(page.getByTestId('toolbar-info')).toHaveAttribute('aria-pressed', 'true');

  await rightClick(page, at);
  await expect(menuItem(page, 'toggleInfo')).toHaveAttribute('aria-checked', 'true');
});

test('眺めるモード → ON、もう一度 → OFF', async ({ page }) => {
  await open(page);
  const at = await emptyPoint(page);
  await rightClick(page, at);
  await expect(menuItem(page, 'toggleWatch')).toHaveAttribute('aria-checked', 'false');
  await menuItem(page, 'toggleWatch').click();
  expect((await getView(page)).watchMode).toBe(true);
  await rightClick(page, at);
  await expect(menuItem(page, 'toggleWatch')).toHaveAttribute('aria-checked', 'true');
  await menuItem(page, 'toggleWatch').click();
  expect((await getView(page)).watchMode).toBe(false);
});

test('全体表示 → Home キーと同じ注視点（各成分の差 < 1 mm）', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Home');
  const home = await settledCamera(page);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), VIEW);
  await rightClick(page, await emptyPoint(page));
  await menuItem(page, 'frameAll').click();
  const maxDiff = (t: Vec3) =>
    Math.max(...[0, 1, 2].map((i) => Math.abs((t[i] ?? 0) - (home.target[i] ?? 0))));
  await expect
    .poll(async () => maxDiff((await getCamera(page)).target), { timeout: 15000 })
    .toBeLessThan(1);
  const pose = await settledCamera(page);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs((pose.target[i] ?? 0) - (home.target[i] ?? 0))).toBeLessThan(1);
  }
});

test('右ボタンで 50 px ドラッグ → メニューが出ず、カメラが回る', async ({ page }) => {
  await open(page);
  const at = await emptyPoint(page);
  const before = await getCamera(page);
  await page.mouse.move(at.x + 100, at.y + 100);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(at.x + 150, at.y + 100, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  const after = await settledCamera(page);
  await expect(menu(page)).toHaveCount(0);
  expect(dist(after.position, before.position)).toBeGreaterThan(1);
});

test('メニューを開いて Esc → 閉じて、選択は g2 のまま', async ({ page }) => {
  await open(page);
  await rightClick(page, await gearPoint(page, 'gear_g2'));
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  expect(await getSelection(page)).toEqual(['gear_g2']);
});

test('↑↓ で項目を移り（端で折り返す）、Enter で実行する', async ({ page }) => {
  await open(page);
  await rightClick(page, await emptyPoint(page));
  await expect(menuItem(page, 'frameAll')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(menuItem(page, 'toggleInfo')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItem(page, 'frameAll')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menuItem(page, 'toggleWatch')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  expect((await getView(page)).watchMode).toBe(true);
});

test('メニューの外を左クリック → 閉じる', async ({ page }) => {
  await open(page);
  const at = await emptyPoint(page);
  await rightClick(page, at);
  await page.mouse.click(at.x + 300, at.y + 200);
  await expect(menu(page)).toHaveCount(0);
});

test('右下の隅で右クリック → メニューの矩形が画面内に収まる', async ({ page }) => {
  await open(page);
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  // 軸の目印（右下）を避けて、描画領域の下の端の右寄り
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('viewport が無い');
  await rightClick(page, { x: box.x + box.width - 120, y: box.y + box.height - 3 });
  const rect = await menu(page).boundingBox();
  if (rect === null) throw new Error('メニューが無い');
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  // カーソルの上に反転している
  expect(rect.y + rect.height).toBeLessThanOrEqual(box.y + box.height);
});
