import type { Page } from '@playwright/test';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import { blur, clickGear, fixtureScene, getScene, openApp } from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S4-05: 歯車の厚さ（プロパティパネルの厚さの欄と［−］［＋］）

// A（gear_1、起点の縦のシャフト shaft_1、範囲 [−4, 12]）と B（gear_2、A の外周）。どちらも中・20 歯（厚さ 8 mm）
const twoGears = fixtureScene('two-gears');
// 上から見下ろす視点（真上だと up と視線が平行になるので、少しだけ +Z 側から）
const TOP_VIEW = { position: [20, 260, 70] as Vec3, target: [20, 0, 0] as Vec3 };

async function widthOf(page: Page, gearId: string): Promise<number | undefined> {
  return (await getScene(page)).gears[gearId]?.width;
}

test('平歯車を選び、厚さの［＋］を 2 回押す → __gearSim の歯車の width が 1 mm 増え、シャフトが伸びる。Undo/Redo できる', async ({
  page,
}) => {
  await openApp(page, { scene: twoGears, camera: TOP_VIEW });
  await clickGear(page, 'gear_1');
  await expect(page.getByTestId('prop-width')).toHaveValue('8');
  // S5-01 から 0.5 mm 刻み
  await page.getByTestId('prop-width-inc').click();
  await expect(page.getByTestId('prop-width')).toHaveValue('8.5');
  await page.getByTestId('prop-width-inc').click();
  await expect(page.getByTestId('prop-width')).toHaveValue('9');
  expect(await widthOf(page, 'gear_1')).toBe(9);
  // 厚くしてはみ出した分だけシャフトが伸びる（[−4, 12] → [−4, 13]）
  expect((await getScene(page)).shafts.shaft_1?.span).toEqual([-4, 13]);
  // 厚さの違う 2 枚（9 mm と 8 mm）もかみ合ったまま
  const meshes = await page.evaluate(() => window.__gearSim?.getLayout().meshes ?? []);
  expect(meshes.map((m) => [m.a, m.b])).toEqual([['gear_1', 'gear_2']]);

  await blur(page);
  await page.keyboard.press('Control+z');
  expect(await widthOf(page, 'gear_1')).toBe(8.5);
  await page.keyboard.press('Control+Shift+z');
  expect(await widthOf(page, 'gear_1')).toBe(9);
});

test('小の平歯車を選び、厚さの［−］を 7 回押す → width が 0.5 になり、［−］が無効（S5-01）', async ({
  page,
}) => {
  // two-spur: gear_1 は小・12 歯（厚さは省略 = 4 mm）
  await openApp(page, { scene: fixtureScene('two-spur') });
  await page.evaluate(() => window.__gearSim?.select('gear_1'));
  const field = page.getByTestId('prop-width');
  const dec = page.getByTestId('prop-width-dec');
  await expect(field).toHaveValue('4');
  const expected = ['3.5', '3', '2.5', '2', '1.5', '1', '0.5'];
  for (const value of expected) {
    await dec.click();
    await expect(field).toHaveValue(value);
  }
  expect(await widthOf(page, 'gear_1')).toBe(0.5);
  await expect(dec).toBeDisabled();
  // 薄くしてもかみ合ったまま
  const meshes = await page.evaluate(() => window.__gearSim?.getLayout().meshes ?? []);
  expect(meshes.map((m) => [m.a, m.b])).toEqual([['gear_1', 'gear_2']]);
  // Undo/Redo で 0.5 mm 刻みの値が保たれる
  await blur(page);
  await page.keyboard.press('Control+z');
  expect(await widthOf(page, 'gear_1')).toBe(1);
  await page.keyboard.press('Control+Shift+z');
  expect(await widthOf(page, 'gear_1')).toBe(0.5);
});

test('平歯車を選ぶ → 厚さの［−］［＋］が歯数の［−］［＋］と同じ x 座標・幅に並ぶ（S5-02）', async ({
  page,
}) => {
  await openApp(page, { scene: twoGears, camera: TOP_VIEW });
  await page.evaluate(() => window.__gearSim?.select('gear_1'));
  for (const [teeth, width] of [
    ['prop-teeth-dec', 'prop-width-dec'],
    ['prop-teeth-inc', 'prop-width-inc'],
    ['prop-teeth', 'prop-width'],
  ] as const) {
    const a = await page.getByTestId(teeth).boundingBox();
    const b = await page.getByTestId(width).boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b?.x).toBe(a?.x);
    expect(b?.width).toBe(a?.width);
  }
});

test('厚さを入力すると 0.5 mm の倍数に丸めてから範囲に収める', async ({ page }) => {
  await openApp(page, { scene: twoGears, camera: TOP_VIEW });
  await page.evaluate(() => window.__gearSim?.select('gear_1'));
  const field = page.getByTestId('prop-width');
  await field.fill('19');
  await field.press('Enter');
  expect(await widthOf(page, 'gear_1')).toBe(19);
  await field.fill('1.3');
  await field.press('Enter');
  expect(await widthOf(page, 'gear_1')).toBe(1.5);
  await field.fill('0.1');
  await field.press('Enter');
  expect(await widthOf(page, 'gear_1')).toBe(0.5);
  await expect(page.getByTestId('prop-width-dec')).toBeDisabled();
  await field.fill('100');
  await field.press('Enter');
  expect(await widthOf(page, 'gear_1')).toBe(32);
  await expect(page.getByTestId('prop-width-inc')).toBeDisabled();
});

test('かさ歯車・ウォーム・ウォームホイールでは厚さの欄が出ない', async ({ page }) => {
  await openApp(page, { scene: fixtureScene('bevel-pair') });
  await page.evaluate(() => window.__gearSim?.select('gear_a'));
  await expect(page.getByTestId('prop-kind')).toHaveAttribute('data-kind', 'bevel');
  await expect(page.getByTestId('prop-width')).toHaveCount(0);

  await page.evaluate((s) => window.__gearSim?.loadScene(s), fixtureScene('worm-basic'));
  for (const [id, kind] of [
    ['gear_w', 'worm'],
    ['gear_h', 'wormWheel'],
  ] as const) {
    await page.evaluate((g) => window.__gearSim?.select(g), id);
    await expect(page.getByTestId('prop-kind')).toHaveAttribute('data-kind', kind);
    await expect(page.getByTestId('prop-width')).toHaveCount(0);
  }
});

test('同じシャフトの歯車とぶつかるときは変わらず、理由がトーストで出る', async ({ page }) => {
  // gear_1 [0, 8] の上に、同じシャフトの gear_3（中・30 歯）を [12, 20] に置く
  const stacked: Scene = {
    ...twoGears,
    shafts: {
      ...twoGears.shafts,
      shaft_1: { ...(twoGears.shafts.shaft_1 as Scene['shafts'][string]), span: [-4, 24] },
    },
    gears: {
      ...twoGears.gears,
      gear_3: { id: 'gear_3', kind: 'spur', shaftId: 'shaft_1', size: 'M', teeth: 30, offset: 12 },
    },
  };
  await openApp(page, { scene: stacked, camera: TOP_VIEW });
  await page.evaluate(() => window.__gearSim?.select('gear_1'));
  // 接するまで（12 mm）は通り、そこから［＋］で 12.5 mm にすると gear_3 にぶつかる
  const field = page.getByTestId('prop-width');
  await field.fill('12');
  await field.press('Enter');
  await expect(page.getByTestId('prop-width')).toHaveValue('12');
  await page.getByTestId('prop-width-inc').click();
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-kind', 'error');
  expect(await widthOf(page, 'gear_1')).toBe(12);
  await expect(page.getByTestId('prop-width')).toHaveValue('12');
});

test('ラックの厚さも変えられる', async ({ page }) => {
  await openApp(page, { scene: fixtureScene('rack-basic') });
  const rackId = Object.keys((await getScene(page)).racks)[0] ?? '';
  await page.evaluate((id) => window.__gearSim?.select(id), rackId);
  await page.getByTestId('prop-rack-width-inc').click();
  expect((await getScene(page)).racks[rackId]?.width).toBe(8.5);
});

test('ラックも 0.5 mm まで薄くでき、0.5 mm で［−］が無効（S5-01）', async ({ page }) => {
  await openApp(page, { scene: fixtureScene('rack-basic') });
  const rackId = Object.keys((await getScene(page)).racks)[0] ?? '';
  await page.evaluate((id) => window.__gearSim?.select(id), rackId);
  const field = page.getByTestId('prop-rack-width');
  await field.fill('1');
  await field.press('Enter');
  await expect(field).toHaveValue('1');
  const dec = page.getByTestId('prop-rack-width-dec');
  await dec.click();
  await expect(field).toHaveValue('0.5');
  expect((await getScene(page)).racks[rackId]?.width).toBe(0.5);
  await expect(dec).toBeDisabled();
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  expect(layout?.rackMeshes.length).toBe(1);
});
