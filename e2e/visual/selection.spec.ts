import { readFileSync } from 'node:fs';
import type { Vec3 } from '../../src/core/math/vec3';
import type { Scene } from '../../src/core/scene/types';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

test.use({ viewport: VISUAL_VIEWPORT });

const chainThree = JSON.parse(
  readFileSync(new URL('../fixtures/chain-three.json', import.meta.url), 'utf8'),
) as Scene;

// 選択（B）の強いハイライトと、マウスを乗せた部品（C）の弱いハイライトを人が見比べるための画面
test('選択とマウスを乗せたときのハイライト', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((scene) => window.__gearSim?.loadScene(scene), chainThree);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), {
    position: [120, 160, 140] as Vec3,
    target: [0, 24, 40] as Vec3,
  });
  await page.evaluate(() => window.__gearSim?.select('gear_b'));
  const c = await page.evaluate(() => {
    const center = window.__gearSim?.getLayout().gears.gear_c?.center;
    return center === undefined ? undefined : window.__gearSim?.projectToScreen(center);
  });
  if (c === undefined) throw new Error('C が無い');
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(200);
  await prepareCapture(page);
  await captureScene(page, 'selection-highlight');
});
