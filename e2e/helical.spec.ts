import {
  centerOf,
  clickGear,
  clickPerimeterCandidate,
  distance,
  fixtureScene,
  getCandidates,
  getLayout,
  getMotion,
  getScene,
  openApp,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S2-01: ハスバ歯車。helical-pair は A（中・20 歯 'right'、モーター 60 rpm）の外周（angle 0）に B（中・40 歯 'left'）
const helicalPair = fixtureScene('helical-pair');

test('helical-pair を読む → かみ合いの種類は helical、B は −π rad/s', async ({ page }) => {
  await openApp(page, { scene: helicalPair });
  const layout = await getLayout(page);
  expect(layout.meshes[0]?.kind).toBe('helical');
  expect(layout.meshes).toHaveLength(1);
  expect(layout.interferences).toEqual([]);
  const motion = await getMotion(page);
  expect(motion.omegas.shaft_a).toBeCloseTo(2 * Math.PI, 6);
  expect(motion.omegas.shaft_b).toBeCloseTo(-Math.PI, 6);
});

test("A を選び外周の候補をクリック → 'left' のハスバ歯車が生え、Ctrl+Z で消える", async ({
  page,
}) => {
  await openApp(page, { scene: helicalPair });
  await page.keyboard.press('Home');
  await clickGear(page, 'gear_a');
  const a = centerOf(await getLayout(page), 'gear_a');
  // A の +x 側（angle π/2）の外周の候補。B（+z）の陰にならず、軸方向のハンドル（B から最も遠い −z）とも重ならない
  const side: [number, number, number] = [a[0] + 40, a[1], a[2]];
  const perimeter = (await getCandidates(page)).filter((c) => c.kind === 'perimeter');
  expect(perimeter.some((c) => distance(c.center, side) < 1e-6)).toBe(true);

  const added = await clickPerimeterCandidate(page, side);
  const scene = await getScene(page);
  expect(scene.gears[added]).toMatchObject({ kind: 'helical', hand: 'left', size: 'M' });
  const after = await getLayout(page);
  expect(after.meshes.filter((m) => m.a === added || m.b === added)).toEqual([
    expect.objectContaining({ source: 'tree', kind: 'helical' }),
  ]);
  expect(after.interferences).toEqual([]);

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => Object.keys((await getScene(page)).gears).sort())
    .toEqual(['gear_a', 'gear_b']);
});

test('平歯車とハスバ歯車はかみ合わない: ちょうどの距離に置くと干渉として赤く表示する', async ({
  page,
}) => {
  // B を平歯車にしたシーン（木の親子だが検証で弾かれるので、A から 60 の起点のシャフトに置く）
  const scene = {
    shafts: {
      shaft_a: helicalPair.shafts.shaft_a,
      shaft_c: {
        id: 'shaft_c',
        placement: {
          kind: 'root' as const,
          origin: [0, 35, 60] as [number, number, number],
          axis: 'y' as const,
        },
      },
    },
    gears: {
      gear_a: helicalPair.gears.gear_a,
      gear_c: {
        id: 'gear_c',
        kind: 'spur' as const,
        shaftId: 'shaft_c',
        size: 'M' as const,
        teeth: 40,
        offset: 0,
      },
    },
    motors: {},
    anchors: {},
  };
  await openApp(page, { scene: scene as typeof helicalPair });
  const layout = await getLayout(page);
  expect(layout.meshes).toEqual([]);
  expect(layout.interferences).toContainEqual(['gear_a', 'gear_c']);
  await expect
    .poll(async () => page.evaluate(() => window.__gearSim?.getWarningParts().interfering ?? []))
    .toEqual(expect.arrayContaining(['gear_a', 'gear_c']));
});
