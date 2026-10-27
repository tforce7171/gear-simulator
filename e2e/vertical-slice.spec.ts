import { readFileSync } from 'node:fs';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

const twoSpur = JSON.parse(
  readFileSync(new URL('./fixtures/two-spur.json', import.meta.url), 'utf8'),
) as Scene;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
});

test('固定シーンが読み込まれ、回っている', async ({ page }) => {
  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  expect(scene).toEqual(twoSpur);

  const before = await page.evaluate(() => window.__gearSim?.getMotion().angles.shaft_1 ?? 0);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__gearSim?.getMotion().angles.shaft_1 ?? 0);
  expect(after).toBeGreaterThan(before);
});

test('ω の比は −0.5、shaft_1 は 60rpm', async ({ page }) => {
  const omegas = await page.evaluate(() => window.__gearSim?.getMotion().omegas);
  const w1 = omegas?.shaft_1 ?? Number.NaN;
  const w2 = omegas?.shaft_2 ?? Number.NaN;
  expect(w1).toBeCloseTo(2 * Math.PI, 6);
  expect(w2 / w1).toBeCloseTo(-0.5, 6);
});

test('loadScene で 24 歯を 36 歯にすると、中心と ω の比が変わる', async ({ page }) => {
  const gear2 = twoSpur.gears.gear_2;
  if (gear2 === undefined) throw new Error('two-spur.json に gear_2 が無い');
  const scene: Scene = { ...twoSpur, gears: { ...twoSpur.gears, gear_2: { ...gear2, teeth: 36 } } };
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);

  const center = await page.evaluate(() => window.__gearSim?.getLayout().gears.gear_2?.center);
  expect(center?.[0]).toBeCloseTo(24, 6);
  expect(center?.[1]).toBeCloseTo(22, 6);
  expect(center?.[2]).toBeCloseTo(0, 6);

  const omegas = await page.evaluate(() => window.__gearSim?.getMotion().omegas);
  const ratio = (omegas?.shaft_2 ?? Number.NaN) / (omegas?.shaft_1 ?? Number.NaN);
  expect(ratio).toBeCloseTo(-1 / 3, 6);
});

test('projectToScreen が gear_1 の中心をキャンバスの内側に写す', async ({ page }) => {
  const point = await page.evaluate(() => {
    const sim = window.__gearSim;
    const center = sim?.getLayout().gears.gear_1?.center;
    if (sim === undefined || center === undefined) return null;
    return sim.projectToScreen(center);
  });
  const box = await page.locator('canvas').boundingBox();
  expect(point).not.toBeNull();
  expect(box).not.toBeNull();
  if (point === null || box === null) return;
  expect(point.x).toBeGreaterThan(box.x);
  expect(point.x).toBeLessThan(box.x + box.width);
  expect(point.y).toBeGreaterThan(box.y);
  expect(point.y).toBeLessThan(box.y + box.height);
});
