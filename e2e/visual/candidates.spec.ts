import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

test.use({ viewport: VISUAL_VIEWPORT });

const oneRoot = fixtureScene('one-root');

// A を選んで候補（外周の 8 つと同じ軸の 2 つ）が出ている場面。1 つにマウスを乗せて濃くする
test('生やす候補', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((scene) => window.__gearSim?.loadScene(scene), oneRoot);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), {
    position: [120, 210, 200] as Vec3,
    target: [0, 35, 0] as Vec3,
  });
  await page.evaluate(() => window.__gearSim?.select('gear_a'));
  const hover = await page.evaluate(() => {
    const sim = window.__gearSim;
    const c = sim?.getCandidates().find((x) => x.kind === 'perimeter');
    return c === undefined ? undefined : sim?.projectToScreen(c.center);
  });
  if (hover === undefined) throw new Error('候補が無い');
  await page.mouse.move(hover.x, hover.y);
  await page.waitForTimeout(200);
  await prepareCapture(page);
  await captureScene(page, 'candidates');
});
