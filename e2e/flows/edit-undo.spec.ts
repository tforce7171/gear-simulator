import type { Vec3 } from '../../src/core/math/vec3';
import {
  blur,
  centerOf,
  clickGear,
  clickPerimeterCandidate,
  deselect,
  distance,
  fixtureScene,
  getCandidates,
  getLayout,
  getScene,
  openApp,
} from '../fixtures/sim';
import { expect, test } from '../fixtures/test';

// 通しテスト 3（S1-31）: 歯数の変更が先の歯車に伝わり、削除・生やすを Undo/Redo で行き来する

// シーン A: g1（小・12 歯、起点 shaft_s1）→ g2（小・36 歯）→ g3（小・24 歯）。中心は [0, 22, 0]・[0, 22, 24]・[0, 22, 54]
const sceneA = fixtureScene('scene-a');
// 上から見下ろす視点
const TOP_VIEW = { position: [0, 260, 30.001] as Vec3, target: [0, 0, 30] as Vec3 };

test('編集の連鎖と Undo/Redo: 歯数の変更 → 削除 → 生やす を 3 回戻して 3 回やり直す', async ({
  page,
}) => {
  await openApp(page, { scene: sceneA, camera: TOP_VIEW });

  // g1 の歯数を 12 → 20（プロパティパネル）
  await clickGear(page, 'gear_g1');
  await page.getByTestId('prop-teeth').fill('20');
  await page.getByTestId('prop-teeth').press('Enter');
  expect((await getScene(page)).gears.gear_g1?.teeth).toBe(20);
  let layout = await getLayout(page);
  const g3Before = centerOf(layout, 'gear_g3');
  expect(distance(centerOf(layout, 'gear_g1'), centerOf(layout, 'gear_g2'))).toBeCloseTo(28, 6);
  expect(distance(centerOf(layout, 'gear_g2'), g3Before)).toBeCloseTo(30, 6);

  // g2 を Delete → g3 はその場に残り、かみ合いが無くなる
  await deselect(page);
  await clickGear(page, 'gear_g2');
  await blur(page);
  await page.keyboard.press('Delete');
  const deleted = await getScene(page);
  expect(deleted.gears.gear_g2).toBeUndefined();
  expect(deleted.shafts.shaft_s3?.placement.kind).toBe('detached');
  layout = await getLayout(page);
  expect(distance(centerOf(layout, 'gear_g3'), g3Before)).toBeCloseTo(0, 6);
  expect(layout.meshes).toEqual([]);

  // g1 を選び、外周の候補で 1 枚足す
  await clickGear(page, 'gear_g1');
  const perimeter = (await getCandidates(page)).find((c) => c.kind === 'perimeter');
  if (perimeter === undefined) throw new Error('外周の候補が無い');
  await clickPerimeterCandidate(page, perimeter.center);
  const afterThree = await getScene(page);
  expect(Object.keys(afterThree.gears)).toHaveLength(3);
  expect((await getLayout(page)).meshes).toHaveLength(1);

  // Ctrl+Z を 3 回 → シーン A、Ctrl+Shift+Z を 3 回 → 3 回の操作の後
  await blur(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  expect(await getScene(page)).toEqual(sceneA);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Shift+z');
  expect(await getScene(page)).toEqual(afterThree);
});
