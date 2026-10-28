import { generatePerfScene } from '../src/debug/perf-scene';
import { getMotion, loadScene, openApp } from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S1-31: 計測用の 200 枚のシーンを読んで 3 秒回しても、コンソールエラーが出ない（SwiftShader なので fps は見ない）。
// 描画が重いので *.heavy.spec.ts（他のテストが終わってから流す）

test('generatePerfScene(200) を読み込んで 3 秒回す → エラー 0 件、ロックなし', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await loadScene(page, generatePerfScene(200));
  await page.keyboard.press('Home');
  await page.waitForTimeout(3000);
  const motion = await getMotion(page);
  expect(Object.keys(motion.omegas)).toHaveLength(
    Object.keys(generatePerfScene(200).shafts).length,
  );
  expect(motion.locks).toEqual([]);
  const stats = await page.evaluate(() => window.__gearSim?.getRenderStats());
  expect(stats?.frame).toBeGreaterThan(0);
});
