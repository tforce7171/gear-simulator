import {
  dragShaftEnd,
  fixtureScene,
  getScene,
  getShaftGhost,
  nextFrames,
  openApp,
  placeOnShaft,
  project,
  selectPaletteKind,
  shaftPoint,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S4-03: シャフトの長さ（範囲）、端のつまみでの伸縮、シャフトの上の好きな位置への配置

// 縦軸の起点 shaft_a（原点 [0, 35, 0]）に中・20 歯の gear_a（offset 0、区画 [0, 8]）。シャフトの範囲は [−4, 12]
const oneRoot = fixtureScene('one-root');
// 真横から見る（シャフトが縦の線に見え、歯車は薄い帯に見える）
const SIDE = {
  position: [0, 70, 260] as [number, number, number],
  target: [0, 60, 0] as [number, number, number],
};

async function spanOf(
  page: Parameters<typeof getScene>[0],
): Promise<readonly [number, number] | undefined> {
  return (await getScene(page)).shafts.shaft_a?.span;
}

test('シャフトを選んで端のつまみをドラッグ → __gearSim のシャフトの範囲が 4 mm 刻みで伸び、Undo/Redo できる', async ({
  page,
}) => {
  await openApp(page, { scene: oneRoot, camera: SIDE });
  expect(await spanOf(page)).toEqual([-4, 12]);
  await dragShaftEnd(page, 'shaft_a', 'spanEnd', 30);
  const span = await spanOf(page);
  expect(span?.[0]).toBe(-4);
  expect(span?.[1]).toBeGreaterThan(30);
  expect((span?.[1] ?? 0) % 4).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => spanOf(page)).toEqual([-4, 12]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => spanOf(page)).toEqual(span);
});

test('つまみを内側へドラッグしても、歯車の範囲より短くならない', async ({ page }) => {
  await openApp(page, { scene: oneRoot, camera: SIDE });
  await dragShaftEnd(page, 'shaft_a', 'spanEnd', -20);
  expect(await spanOf(page)).toEqual([-4, 12]);
});

test('パレットで平歯車を選び、伸ばしたシャフトの途中をクリック → その位置に歯車が置かれる。重なる位置は赤く、置けない', async ({
  page,
}) => {
  await openApp(page, { scene: oneRoot, camera: SIDE });
  await selectPaletteKind(page, 'spur');
  await dragShaftEnd(page, 'shaft_a', 'spanEnd', 40);
  const span = await spanOf(page);
  expect(span?.[1]).toBeGreaterThanOrEqual(48);

  // 原点から 36 mm の点 → 中・20 歯の中心が 36 に来る offset 32
  const placed = await placeOnShaft(page, 'shaft_a', 36);
  const scene = await getScene(page);
  expect(scene.gears[placed]).toMatchObject({
    kind: 'spur',
    shaftId: 'shaft_a',
    size: 'M',
    offset: 32,
  });
  // シャフトの選択は保つ（続けて置ける）
  expect(await page.evaluate(() => window.__gearSim?.getSelection())).toEqual(['shaft_a']);

  // 置いた歯車 [32, 40] に重なる位置（原点から 31 mm → offset 28）は赤く、クリックしても置けない
  const p = await project(page, await shaftPoint(page, 'shaft_a', 31));
  await page.mouse.move(p.x, p.y);
  await expect.poll(async () => (await getShaftGhost(page))?.offset).toBe(28);
  expect((await getShaftGhost(page))?.blocked).toBe(true);
  const count = Object.keys((await getScene(page)).gears).length;
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await page.mouse.click(p.x, p.y);
  await nextFrames(page);
  expect(Object.keys((await getScene(page)).gears)).toHaveLength(count);
  // 置けない理由をトーストで知らせる
  await expect(page.getByTestId('toast-message')).toHaveText(
    'ほかの部品と重なるので、ここには置けない',
  );

  // 置いたことは Undo で戻せる
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Object.keys((await getScene(page)).gears)).toEqual(['gear_a']);
});

test('パレットがラック・遊星なら、シャフトの上には出さず、注記を出す（日・英）', async ({
  page,
}) => {
  await openApp(page, { scene: oneRoot, camera: SIDE });
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  const note = page.getByTestId('palette-kind-around-note');
  await expect(note).toBeHidden();
  await selectPaletteKind(page, 'rack');
  await expect(note).toBeVisible();
  await expect(note).toHaveText('ラック／遊星は歯車の周りの候補から置きます');
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await expect(note).toHaveText(
    'Racks and planetary sets are placed from the candidates around a gear',
  );

  await page.evaluate(() => window.__gearSim?.select('shaft_a'));
  await nextFrames(page);
  const p = await project(page, await shaftPoint(page, 'shaft_a', -2));
  await page.mouse.move(p.x, p.y);
  await nextFrames(page);
  expect(await getShaftGhost(page)).toBeNull();
  await selectPaletteKind(page, 'planetary');
  await expect(note).toBeVisible();
  await selectPaletteKind(page, 'helical');
  await expect(note).toBeHidden();
});
