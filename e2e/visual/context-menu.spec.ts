import { fixtureScene, gearPoint, openApp } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S1-29・S1-31: 歯車の上で開いたコンテキストメニュー

test.use({ viewport: VISUAL_VIEWPORT, locale: 'ja-JP' });

test('context-menu: 歯車の上で開いたメニュー', async ({ page }) => {
  await openApp(page, {
    scene: fixtureScene('scene-a'),
    camera: { position: [70, 110, 45], target: [0, 20, 28] },
  });
  await prepareCapture(page);
  const p = await gearPoint(page, 'gear_g2');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await captureScene(page, 'context-menu');
});
