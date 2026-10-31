import type { Page } from '@playwright/test';
import { radialDirection } from '../../src/core/math/axis';
import type { Vec3 } from '../../src/core/math/vec3';
import {
  centerOf,
  clickGear,
  clickPerimeterCandidate,
  EMPTY,
  getLayout,
  getScene,
  getSelection,
  openApp,
  type Point,
  placeOnShaft,
  project,
} from '../fixtures/sim';
import { expect } from '../fixtures/test';

// 通しテスト 1・2 が共有する「組み立てて回す」の操作（S1-31）

// 斜め上から見下ろす視点
export const BUILD_VIEW = { position: [120, 170, 200] as Vec3, target: [0, 15, 20] as Vec3 };

export interface BuiltParts {
  first: string; // 1 枚目の歯車（起点のシャフト）
  second: string; // 2 枚目の歯車（1 枚目の外周に生やしたもの）
  firstShaft: string;
  secondShaft: string;
}

async function paletteItemCenter(page: Page): Promise<Point> {
  const box = await page.getByTestId('palette-root-shaft').boundingBox();
  if (box === null) throw new Error('起点のシャフトの項目が無い');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * 空のシーン → パレットから起点のシャフトを床（原点）へドラッグ（S1-17）→ その上に平歯車を置く（S4-04）
 * → 1 枚目の外周の候補をクリック
 * （S1-18）→ プロパティパネルで 1 枚目のシャフトに小のモーター（60 rpm、+1、ON）を付ける（S1-20）
 */
export async function buildTwoGearsWithMotor(page: Page): Promise<BuiltParts> {
  await openApp(page, { scene: EMPTY, camera: BUILD_VIEW });

  // パレットから起点を置く
  const from = await paletteItemCenter(page);
  const to = await project(page, [0, 0, 0]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  const placed = await getScene(page);
  const rootShaft = Object.values(placed.shafts)[0];
  if (rootShaft === undefined) throw new Error('シャフトが置かれていない');
  expect(Object.keys(placed.gears)).toHaveLength(0);
  expect(await getSelection(page)).toEqual([rootShaft.id]);

  // 起点のシャフトは歯車なし（S4-04）。その上（原点から 4 mm。中・20 歯の offset 0）に平歯車を置き、選ぶ
  const firstId = await placeOnShaft(page, rootShaft.id, 4);
  const firstGear = (await getScene(page)).gears[firstId];
  if (firstGear === undefined) throw new Error('歯車が置かれていない');
  expect(firstGear).toMatchObject({ kind: 'spur', size: 'M', teeth: 20, offset: 0 });
  await clickGear(page, firstGear.id);
  expect(await getSelection(page)).toEqual([firstGear.id]);

  // 選んだ歯車の外周（+u の向き）の候補をクリックして 2 枚目を生やす
  const layout = await getLayout(page);
  const c = centerOf(layout, firstGear.id);
  const gap = 2 * (layout.gears[firstGear.id]?.pitchRadius ?? 0);
  const dir = radialDirection('y', 0);
  const near: Vec3 = [c[0] + dir[0] * gap, c[1] + dir[1] * gap, c[2] + dir[2] * gap];
  const second = await clickPerimeterCandidate(page, near);
  const scene = await getScene(page);
  expect(Object.keys(scene.gears)).toHaveLength(2);
  expect((await getLayout(page)).meshes).toHaveLength(1);

  // 1 枚目を選び、プロパティパネルでモーターを付ける
  await clickGear(page, firstGear.id);
  await page.getByTestId('prop-motor-add-S').click();
  const motors = Object.values((await getScene(page)).motors);
  expect(motors).toHaveLength(1);
  expect(motors[0]).toMatchObject({
    shaftId: firstGear.shaftId,
    rpm: 60,
    direction: 1,
    on: true,
  });
  const secondShaft = (await getScene(page)).gears[second]?.shaftId;
  if (secondShaft === undefined) throw new Error('2 枚目のシャフトが無い');
  return { first: firstGear.id, second, firstShaft: firstGear.shaftId, secondShaft };
}
