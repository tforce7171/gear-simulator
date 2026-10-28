import { fixtureScene, openApp } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S1-23: シーン A を情報表示 ON で撮る（ラベルの重なりと矢印の向きを人が画像で確かめる）

test.use({ viewport: VISUAL_VIEWPORT });

test('info-overlay-on: 情報表示 ON（scene-a）', async ({ page }) => {
  // 3 枚の中心は [0, 22, 0]・[0, 22, 24]・[0, 22, 54]
  await openApp(page, {
    scene: fixtureScene('scene-a'),
    camera: { position: [70, 110, 45], target: [0, 20, 28] },
  });
  await page.getByTestId('toolbar-info').click();
  await expect(page.getByTestId('info-label')).toHaveCount(3);
  // 一時停止すると rpm が 0 になり回転方向の矢印も消える（止まっている歯車には出さない）ので、
  // lock-red と同じく止めずに撮る（implementation-log の S1-31）
  await prepareCapture(page, { pause: false });
  await captureScene(page, 'info-overlay-on');
});
