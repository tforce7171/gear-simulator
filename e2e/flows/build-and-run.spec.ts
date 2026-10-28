import { getMotion, getScene } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { buildTwoGearsWithMotor } from './build';

// 通しテスト 1（S1-31）: 空のシーンから画面の操作で組み立てて回す

test('組み立てて回す: 起点を置き、外周に生やし、モーターを付けると、比のとおりに回る', async ({
  page,
}) => {
  const parts = await buildTwoGearsWithMotor(page);
  const scene = await getScene(page);
  const z1 = scene.gears[parts.first]?.teeth ?? Number.NaN;
  const z2 = scene.gears[parts.second]?.teeth ?? Number.NaN;

  await page.waitForTimeout(500);
  const motion = await getMotion(page);
  expect(motion.locks).toEqual([]);
  expect(motion.omegas[parts.firstShaft]).toBeCloseTo(2 * Math.PI, 3);
  expect(motion.omegas[parts.secondShaft]).toBeCloseTo((-2 * Math.PI * z1) / z2, 3);

  // 情報表示 ON で、2 枚目のラベルの rpm が 60 × z1 / z2
  await page.getByTestId('toolbar-info').click();
  const label = page.locator(`[data-testid="info-label"][data-gear-id="${parts.second}"]`);
  await expect(label).toBeVisible();
  await expect(label).toContainText(`${((60 * z1) / z2).toFixed(1)} rpm`);
});
