import { expect, test } from './fixtures/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
});

test('dispatch で基本のシーンを作ると回り、undo 5 回で空に戻る', async ({ page }) => {
  await page.evaluate(() =>
    window.__gearSim?.loadScene({ shafts: {}, gears: {}, motors: {}, anchors: {} }),
  );

  // 基本のシーン（S1-11 の資料）を作る 5 コマンド。アプリの ID はランダムなので、
  // 前のコマンドで増えた部品の ID を次のコマンドに埋める。起点のシャフト（資料の shaft_1）の ID を返す
  const rootShaft = await page.evaluate(() => {
    const sim = window.__gearSim;
    if (sim === undefined) throw new Error('no __gearSim');
    const added = (before: object, after: object): string =>
      Object.keys(after).find((id) => !(id in before)) ?? '';
    const s0 = sim.getScene();
    sim.dispatch({
      type: 'addRootShaft',
      axis: 'y',
      origin: [0, 20, 0],
      gear: { size: 'S', teeth: 12 },
    });
    const s1 = sim.getScene();
    const shaft1 = added(s0.shafts, s1.shafts);
    const gear1 = added(s0.gears, s1.gears);
    sim.dispatch({
      type: 'growGear',
      mode: 'perimeter',
      parentGearId: gear1,
      angle: Math.PI / 2,
      teeth: 24,
    });
    const s2 = sim.getScene();
    const shaft2 = added(s1.shafts, s2.shafts);
    sim.dispatch({
      type: 'growGear',
      mode: 'coaxial',
      shaftId: shaft2,
      offset: 4,
      size: 'S',
      teeth: 24,
    });
    const s3 = sim.getScene();
    const gear3 = added(s2.gears, s3.gears);
    sim.dispatch({ type: 'growGear', mode: 'perimeter', parentGearId: gear3, angle: 0, teeth: 12 });
    sim.dispatch({ type: 'addMotor', shaftId: shaft1, size: 'S' });
    return shaft1;
  });

  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  expect(Object.keys(scene?.gears ?? {})).toHaveLength(4);
  expect(Object.keys(scene?.motors ?? {})).toHaveLength(1);

  const angle = () =>
    page.evaluate((id) => window.__gearSim?.getMotion().angles[id] ?? Number.NaN, rootShaft);
  const before = await angle();
  await page.waitForTimeout(500);
  expect(await angle()).toBeGreaterThan(before);

  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.__gearSim?.undo();
  });
  expect(await page.evaluate(() => window.__gearSim?.getScene())).toEqual({
    shafts: {},
    gears: {},
    motors: {},
    anchors: {}, // S3-01
  });
});
