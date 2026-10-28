import { fixtureScene, loadScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S3-01: B を固定してロックしている場面。台座と支柱で固定されていることが一目で分かるか、
// 歯車の鑑賞の邪魔にならないか、ロックの赤い震えが分かるかは、人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

test('anchor-locked（anchor-pair の B を固定してロック）', async ({ page }) => {
  test.setTimeout(90_000);
  const pair = fixtureScene('anchor-pair');
  await openApp(page);
  await loadScene(page, {
    ...pair,
    anchors: { anchor_1: { id: 'anchor_1', target: { kind: 'shaft', id: 'shaft_b' } } },
  });
  // A の中心 [0, 39, 0]、B の中心 [0, 39, 60]。少し低い斜め前から、B の下の台座と支柱も見える角度で
  await setCamera(page, { position: [190, 70, 150], target: [0, 25, 30] });
  // 一時停止中はロックが外れて赤い表示が消えるので、止めない
  await prepareCapture(page, { pause: false });
  await captureScene(page, 'anchor-locked');
});
