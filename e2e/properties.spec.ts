import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { en } from '../src/core/i18n/en';
import { ja } from '../src/core/i18n/ja';
import type { MotionState } from '../src/core/kinematics/types';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Motor, Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// A（gear_1、起点の縦のシャフト shaft_1）と B（gear_2、A の外周に生やした shaft_2）。どちらも中・20 歯
const twoGears = JSON.parse(
  readFileSync(new URL('./fixtures/two-gears.json', import.meta.url), 'utf8'),
) as Scene;

const A = 'gear_1';
const B = 'gear_2';
const SHAFT_A = 'shaft_1';
const SHAFT_B = 'shaft_2';

// 上から見下ろす視点（真上だと up と視線が平行になるので、少しだけ +Z 側から）
const TOP_VIEW = { position: [20, 260, 70] as Vec3, target: [20, 0, 0] as Vec3 };

async function getScene(page: Page): Promise<Scene> {
  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  if (scene === undefined) throw new Error('__gearSim が無い');
  return scene;
}

async function getLayout(page: Page): Promise<Layout> {
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  if (layout === undefined) throw new Error('__gearSim が無い');
  return layout;
}

async function getMotion(page: Page): Promise<MotionState> {
  const motion = await page.evaluate(() => window.__gearSim?.getMotion());
  if (motion === undefined) throw new Error('__gearSim が無い');
  return motion;
}

async function teethOf(page: Page, id: string): Promise<number | undefined> {
  return (await getScene(page)).gears[id]?.teeth;
}

async function onlyMotor(page: Page): Promise<Motor> {
  const motors = Object.values((await getScene(page)).motors);
  expect(motors).toHaveLength(1);
  const motor = motors[0];
  if (motor === undefined) throw new Error('モーターが無い');
  return motor;
}

async function omega(page: Page, shaftId: string): Promise<number> {
  return (await getMotion(page)).omegas[shaftId] ?? Number.NaN;
}

async function centerDistance(page: Page): Promise<number> {
  const layout = await getLayout(page);
  const a = layout.gears[A]?.center;
  const b = layout.gears[B]?.center;
  if (a === undefined || b === undefined) throw new Error('A か B がレイアウトに無い');
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function project(page: Page, world: Vec3): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

// Ctrl+Z（入力欄からフォーカスを外してから押す。入力欄の中ではアプリのショートカットは効かない）
async function undo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await page.keyboard.press('Control+z');
}

async function enterTeeth(page: Page, value: string): Promise<void> {
  await page.getByTestId('prop-teeth').fill(value);
  await page.getByTestId('prop-teeth').press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await page.evaluate((scene) => window.__gearSim?.loadScene(scene), twoGears);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), TOP_VIEW);
  // A をクリックして選ぶ
  const center = (await getLayout(page)).gears[A]?.center;
  if (center === undefined) throw new Error('A がレイアウトに無い');
  const p = await project(page, center);
  await page.mouse.click(p.x, p.y);
  expect(await page.evaluate(() => window.__gearSim?.getSelection())).toEqual([A]);
});

test('歯数の欄に今の歯数が出る', async ({ page }) => {
  await expect(page.getByTestId('prop-teeth')).toHaveValue('20');
});

test('歯数を 30 にすると B がついてきて、Ctrl+Z で表示も戻る', async ({ page }) => {
  await enterTeeth(page, '30');
  expect(await teethOf(page, A)).toBe(30);
  expect(await centerDistance(page)).toBeCloseTo(50, 6);

  await undo(page);
  expect(await teethOf(page, A)).toBe(20);
  await expect(page.getByTestId('prop-teeth')).toHaveValue('20');
  expect(await centerDistance(page)).toBeCloseTo(40, 6);
});

test('歯数は範囲に丸め、数でなければ元に戻してコマンドを出さない', async ({ page }) => {
  await enterTeeth(page, '100');
  expect(await teethOf(page, A)).toBe(60);
  await expect(page.getByTestId('prop-teeth')).toHaveValue('60');

  await enterTeeth(page, '5');
  expect(await teethOf(page, A)).toBe(12);
  await expect(page.getByTestId('prop-teeth')).toHaveValue('12');

  await enterTeeth(page, 'abc');
  expect(await teethOf(page, A)).toBe(12);
  await expect(page.getByTestId('prop-teeth')).toHaveValue('12');

  // abc はコマンドを出していないので、Ctrl+Z 1 回で 12 にした変更が戻る
  await undo(page);
  expect(await teethOf(page, A)).toBe(60);
  await expect(page.getByTestId('prop-teeth')).toHaveValue('60');
});

test('＋で 1 増え、−で 1 減る', async ({ page }) => {
  await page.getByTestId('prop-teeth-inc').click();
  expect(await teethOf(page, A)).toBe(21);
  await expect(page.getByTestId('prop-teeth')).toHaveValue('21');
  await page.getByTestId('prop-teeth-dec').click();
  expect(await teethOf(page, A)).toBe(20);
});

test('モーターの付け外しと設定。Undo は 1 つずつ戻る', async ({ page }) => {
  await page.getByTestId('prop-motor-add-M').click();
  const added = await onlyMotor(page);
  expect(added).toMatchObject({ size: 'M', rpm: 30, direction: 1, on: true, shaftId: SHAFT_A });
  expect(await omega(page, SHAFT_A)).toBeCloseTo(Math.PI, 6);
  expect(await omega(page, SHAFT_B)).toBeCloseTo(-Math.PI, 6);

  // rpm の入力欄
  await page.getByTestId('prop-motor-rpm').fill('60');
  await page.getByTestId('prop-motor-rpm').press('Enter');
  expect((await onlyMotor(page)).rpm).toBe(60);
  expect(await omega(page, SHAFT_A)).toBeCloseTo(2 * Math.PI, 6);

  // rpm のスライダー（動かしている間は表示だけ、離したときに確定）
  const slider = page.getByTestId('prop-motor-rpm-slider');
  await slider.evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = '90';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByTestId('prop-motor-rpm')).toHaveValue('90');
  expect((await onlyMotor(page)).rpm).toBe(60);
  await slider.evaluate((el) => {
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect((await onlyMotor(page)).rpm).toBe(90);
  const omega90 = await omega(page, SHAFT_A);
  expect(omega90).toBeCloseTo(3 * Math.PI, 6);

  // 向き
  await page.getByTestId('prop-motor-direction').click();
  expect((await onlyMotor(page)).direction).toBe(-1);
  expect(await omega(page, SHAFT_A)).toBeCloseTo(-omega90, 6);

  // ON/OFF
  await page.getByTestId('prop-motor-on').click();
  expect((await onlyMotor(page)).on).toBe(false);
  expect(await omega(page, SHAFT_A)).toBeCloseTo(0, 9);

  // 大きさ（rpm は変わらない）
  await page.getByTestId('prop-motor-size-L').click();
  expect(await onlyMotor(page)).toMatchObject({ size: 'L', rpm: 90, direction: -1, on: false });

  // 外す
  await page.getByTestId('prop-motor-remove').click();
  expect((await getScene(page)).motors).toEqual({});
  await expect(page.getByTestId('prop-motor-add-S')).toBeVisible();

  // Undo を 1 回ずつ: 外す → 大きさ → ON/OFF → 向き → スライダー → 入力欄 → 付ける
  await undo(page);
  expect(await onlyMotor(page)).toMatchObject({ size: 'L', rpm: 90, direction: -1, on: false });
  await expect(page.getByTestId('prop-motor-rpm')).toHaveValue('90');
  await undo(page);
  expect(await onlyMotor(page)).toMatchObject({ size: 'M', rpm: 90, direction: -1, on: false });
  await expect(page.getByTestId('prop-motor-size-M')).toHaveAttribute('aria-checked', 'true');
  await undo(page);
  expect(await onlyMotor(page)).toMatchObject({ size: 'M', rpm: 90, direction: -1, on: true });
  await undo(page);
  expect(await onlyMotor(page)).toMatchObject({ size: 'M', rpm: 90, direction: 1, on: true });
  await undo(page);
  expect(await onlyMotor(page)).toMatchObject({ size: 'M', rpm: 60, direction: 1, on: true });
  await expect(page.getByTestId('prop-motor-rpm')).toHaveValue('60');
  await expect(page.getByTestId('prop-motor-rpm-slider')).toHaveValue('60');
  await undo(page);
  expect(await onlyMotor(page)).toMatchObject({ size: 'M', rpm: 30, direction: 1, on: true });
  await undo(page);
  expect((await getScene(page)).motors).toEqual({});
  await expect(page.getByTestId('prop-motor-add-M')).toBeVisible();
});

test('A のシャフトを選んでもモーターの欄が出る', async ({ page }) => {
  // 歯車を選んでいる間はシャフトの上にハンドル（高さ）が重なるので、いったん選択を外す。
  // 歯車から外れたシャフトの上の端を、A と B を結ぶ線に垂直な横から見てクリックする
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('properties-empty')).toBeVisible();
  const layout = await getLayout(page);
  const shaft = layout.shafts[SHAFT_A];
  const b = layout.gears[B]?.center;
  if (shaft === undefined || b === undefined) throw new Error('A のシャフトか B が無い');
  const top = shaft.origin[1] + shaft.span[1] - 1;
  const dx = b[0] - shaft.origin[0];
  const dz = b[2] - shaft.origin[2];
  const len = Math.hypot(dx, dz);
  const side: Vec3 = [shaft.origin[0] - (dz / len) * 200, top, shaft.origin[2] + (dx / len) * 200];
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), {
    position: side,
    target: [shaft.origin[0], top, shaft.origin[2]] as Vec3,
  });
  const p = await project(page, [shaft.origin[0], top, shaft.origin[2]]);
  await page.mouse.click(p.x, p.y);
  expect(await page.evaluate(() => window.__gearSim?.getSelection())).toEqual([SHAFT_A]);
  await expect(page.getByTestId('prop-teeth')).toHaveCount(0);
  await expect(page.getByTestId('prop-shaft-axis')).toHaveText(ja['properties.axis.y']);
  await page.getByTestId('prop-motor-add-S').click();
  expect(await onlyMotor(page)).toMatchObject({ size: 'S', rpm: 60, shaftId: SHAFT_A });
});

test('歯数の欄にフォーカスがあるとき、Delete で歯車は消えない', async ({ page }) => {
  await page.getByTestId('prop-teeth').focus();
  await page.keyboard.press('Delete');
  expect((await getScene(page)).gears[A]).toBeDefined();
});

test('言語を英語にすると、パネルの見出しが英語になる', async ({ page }) => {
  await expect(page.getByTestId('prop-heading')).toHaveText(ja['properties.gear']);
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await expect(page.getByTestId('prop-heading')).toHaveText(en['properties.gear']);
  await expect(page.getByTestId('prop-motor-heading')).toHaveText(en['properties.motor']);
});
