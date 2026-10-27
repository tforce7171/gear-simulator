import { readFileSync } from 'node:fs';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

const opposingMotors = JSON.parse(
  readFileSync(new URL('./fixtures/opposing-motors.json', import.meta.url), 'utf8'),
) as Scene;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
});

test('逆向きのモーター: 強い M が勝ち、±30rpm になる', async ({ page }) => {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), opposingMotors);
  const omegas = await page.evaluate(() => window.__gearSim?.getMotion().omegas);
  expect(omegas?.shaft_1 ?? Number.NaN).toBeCloseTo(-Math.PI, 6);
  expect(omegas?.shaft_2 ?? Number.NaN).toBeCloseTo(Math.PI, 6);
});
