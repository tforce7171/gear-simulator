import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { MotionState } from '../src/core/kinematics/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import type { CameraPose } from '../src/input/camera';
import { expect, test } from './fixtures/test';

// S1-22: ロックの表示、干渉の警告、一時停止

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

// 中・20 歯の 2 枚がかみ合い、両方のシャフトに小のモーター（60 rpm、direction 1）。stalemate のロック
const lockOpposed = fixture('lock-opposed');
// 3 枚が三角形にかみ合う（モーター 1 つ）。contradiction のロック
const lockTriangle = fixture('lock-triangle');
// 縦軸の起点のシャフト 2 本に歯車を 1 枚ずつ、重なる距離で置いたもの
const overlap = fixture('overlap');
// 縦軸の起点 A（shaft_a・gear_a、中・20 歯）に中のモーター（30 rpm、direction 1）→ ω = π
const oneRootMotor = fixture('one-root-motor');

// 斜め上から見る視点。部品は原点のあたり
const VIEW = { position: [0, 250, 250] as Vec3, target: [0, 0, 0] as Vec3 };
// 部品から十分離れた床の点（「何もない所」）
const EMPTY_FLOOR: Vec3 = [-70, 0, 30];

async function open(page: Page, scene: Scene): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), VIEW);
}

async function getMotion(page: Page): Promise<MotionState> {
  const motion = await page.evaluate(() => window.__gearSim?.getMotion());
  if (motion === undefined) throw new Error('__gearSim が無い');
  return motion;
}

async function getScene(page: Page): Promise<Scene> {
  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  if (scene === undefined) throw new Error('__gearSim が無い');
  return scene;
}

async function getWarningParts(page: Page): Promise<{ locked: string[]; interfering: string[] }> {
  const parts = await page.evaluate(() => window.__gearSim?.getWarningParts());
  if (parts === undefined) throw new Error('__gearSim が無い');
  return parts;
}

async function isPaused(page: Page): Promise<boolean> {
  const paused = await page.evaluate(() => window.__gearSim?.isPaused());
  if (paused === undefined) throw new Error('__gearSim が無い');
  return paused;
}

async function getCamera(page: Page): Promise<CameraPose> {
  const pose = await page.evaluate(() => window.__gearSim?.getCamera());
  if (pose === undefined) throw new Error('__gearSim が無い');
  return pose;
}

async function omegaA(page: Page): Promise<number> {
  return (await getMotion(page)).omegas.shaft_a ?? Number.NaN;
}

test('lock-opposed: stalemate のロック。歯車・シャフト・モーターが locked に入り、角度は変わらない', async ({
  page,
}) => {
  await open(page, lockOpposed);
  const motion = await getMotion(page);
  expect(motion.locks.map((l) => l.reason)).toEqual(['stalemate']);
  const { locked, interfering } = await getWarningParts(page);
  expect(locked).toEqual(['gear_1', 'gear_2', 'motor_1', 'motor_2', 'shaft_1', 'shaft_2']);
  expect(interfering).toEqual([]);
  const before = (await getMotion(page)).angles;
  await page.waitForTimeout(500);
  expect((await getMotion(page)).angles).toEqual(before);
});

test('lock-triangle: contradiction のロック。3 枚の歯車が locked に入り、interfering は空', async ({
  page,
}) => {
  await open(page, lockTriangle);
  const motion = await getMotion(page);
  expect(motion.locks.map((l) => l.reason)).toEqual(['contradiction']);
  const { locked, interfering } = await getWarningParts(page);
  for (const id of ['gear_1', 'gear_2', 'gear_3']) expect(locked).toContain(id);
  expect(interfering).toEqual([]);
});

test('overlap: 干渉の組の 2 枚が interfering に入る', async ({ page }) => {
  await open(page, overlap);
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  expect(layout?.interferences).toEqual([['gear_1', 'gear_2']]);
  const { locked, interfering } = await getWarningParts(page);
  expect(locked).toEqual([]);
  expect(interfering).toEqual(['gear_1', 'gear_2']);
});

test('Space で一時停止し、もう一度で動き出す。シーンのモーターは ON のまま', async ({ page }) => {
  await open(page, oneRootMotor);
  expect(await omegaA(page)).toBeCloseTo(Math.PI, 6);
  await expect(page.getByTestId('pause-indicator')).toBeHidden();

  await page.keyboard.press('Space');
  expect(await isPaused(page)).toBe(true);
  expect(await omegaA(page)).toBe(0);
  const before = (await getMotion(page)).angles;
  await page.waitForTimeout(300);
  expect((await getMotion(page)).angles).toEqual(before);
  await expect(page.getByTestId('pause-indicator')).toBeVisible();
  expect((await getScene(page)).motors.motor_a?.on).toBe(true);

  await page.keyboard.press('Space');
  expect(await isPaused(page)).toBe(false);
  expect(await omegaA(page)).toBeCloseTo(Math.PI, 6);
  await expect(page.getByTestId('pause-indicator')).toBeHidden();
});

test('一時停止にしてから Ctrl+Z → 一時停止のまま、シーンも変わらない', async ({ page }) => {
  await open(page, oneRootMotor);
  await page.keyboard.press('Space');
  expect(await isPaused(page)).toBe(true);
  const scene = await getScene(page);
  await page.keyboard.press('Control+z');
  expect(await isPaused(page)).toBe(true);
  expect(await getScene(page)).toEqual(scene);
});

test('Space を押したまま何もない所を左ドラッグ → 平行移動し、一時停止は切り替わらない', async ({
  page,
}) => {
  await open(page, oneRootMotor);
  const before = await getCamera(page);
  const from = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), EMPTY_FLOOR);
  if (from === undefined) throw new Error('__gearSim が無い');
  await page.keyboard.down('Space');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'left' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + 10 * i, from.y);
  await page.mouse.up({ button: 'left' });
  await page.keyboard.up('Space');
  const after = await getCamera(page);
  expect(after.target).not.toEqual(before.target);
  expect(await isPaused(page)).toBe(false);
});

test('Space を 800ms 押して離す → 一時停止は切り替わらない', async ({ page }) => {
  await open(page, oneRootMotor);
  await page.keyboard.down('Space');
  await page.waitForTimeout(800);
  await page.keyboard.up('Space');
  expect(await isPaused(page)).toBe(false);
});

test('プロパティパネルの入力欄にフォーカスして Space → 一時停止は切り替わらない', async ({
  page,
}) => {
  await open(page, oneRootMotor);
  await page.evaluate(() => window.__gearSim?.select('gear_a'));
  await page.getByTestId('prop-teeth').focus();
  await page.keyboard.press('Space');
  expect(await isPaused(page)).toBe(false);
});

test('ボタンにフォーカスがあるとき Space → 一時停止が切り替わり、ボタンは押されない', async ({
  page,
}) => {
  await open(page, oneRootMotor);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'count';
    button.dataset.testid = 'test-counter';
    button.dataset.count = '0';
    button.addEventListener('click', () => {
      button.dataset.count = String(Number(button.dataset.count) + 1);
    });
    document.body.append(button);
  });
  const button = page.getByTestId('test-counter');
  await button.focus();
  await page.keyboard.press('Space');
  expect(await isPaused(page)).toBe(true);
  await expect(button).toHaveAttribute('data-count', '0');
});
