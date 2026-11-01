import type { Page } from '@playwright/test';
import type { Scene } from '../src/core/scene/types';
import {
  blur,
  centerOf,
  clickGear,
  clickPerimeterCandidate,
  distance,
  fixtureScene,
  getCandidates,
  getLayout,
  getScene,
  openApp,
  project,
  waitAutosaved,
  waitReady,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S5-04: 歯車・ラック・キャリア・固定具の色（プロパティパネルの色の欄、setPartColor）

// two-gears: gear_1（起点の縦のシャフト）と gear_2（外周）。どちらも中・20 歯の平歯車
const twoGears = fixtureScene('two-gears');
// stage3-showcase: 遊星歯車機構（carrier_k、リング gear_r のシャフト shaft_r を固定具 anchor_r で固定）、ラック rack_r
const showcase = fixtureScene('stage3-showcase');

// render/themes.ts の GEAR_MATERIAL_LOOKS の色
const BRASS = 0xc9a24a;
const STEEL = 0xb9bec4; // シルバー
const METALLIC_BLUE = 0x3d68c4;
const LIGHT_WOOD = 0xb07a45; // 木のテーマの平歯車の自動・「木」
const DARK_OAK = 0x4a3220;

const materialColor = (page: Page, id: string): Promise<number | null> =>
  page.evaluate((partId) => window.__gearSim?.getPartMaterialColor(partId) ?? null, id);

async function colorOf(page: Page, gearId: string): Promise<string | undefined> {
  return (await getScene(page)).gears[gearId]?.color;
}

test('平歯車を選び、色の欄でメタリックブルーを押す → color が metallicBlue になり描画の色も変わる。Undo/Redo できる', async ({
  page,
}) => {
  await openApp(page, { scene: twoGears });
  await page.keyboard.press('Home');
  await clickGear(page, 'gear_1');
  const field = page.getByTestId('prop-color');
  await expect(field).toHaveAttribute('role', 'radiogroup');
  // 真鍮のテーマ: 自動・真鍮・シルバー・メタリックブルー
  await expect(field.getByRole('radio')).toHaveCount(4);
  await expect(page.getByTestId('prop-color-auto')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('prop-color-wood')).toHaveCount(0);
  expect(await materialColor(page, 'gear_1')).toBe(BRASS);

  await page.getByTestId('prop-color-metallicBlue').click();
  expect(await colorOf(page, 'gear_1')).toBe('metallicBlue');
  await expect(page.getByTestId('prop-color-metallicBlue')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('prop-color-auto')).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => materialColor(page, 'gear_1')).toBe(METALLIC_BLUE);
  // ほかの歯車は自動のまま
  expect(await colorOf(page, 'gear_2')).toBeUndefined();
  expect(await materialColor(page, 'gear_2')).toBe(BRASS);

  await page.getByTestId('prop-color-silver').click();
  expect(await colorOf(page, 'gear_1')).toBe('silver');
  await expect.poll(() => materialColor(page, 'gear_1')).toBe(STEEL);

  await blur(page);
  await page.keyboard.press('Control+z');
  expect(await colorOf(page, 'gear_1')).toBe('metallicBlue');
  await page.keyboard.press('Control+z');
  expect(await colorOf(page, 'gear_1')).toBeUndefined();
  expect((await getScene(page)).gears.gear_1).not.toHaveProperty('color');
  await expect.poll(() => materialColor(page, 'gear_1')).toBe(BRASS);
  await page.keyboard.press('Control+Shift+z');
  expect(await colorOf(page, 'gear_1')).toBe('metallicBlue');

  // 「自動」を押すと color が消える
  await page.getByTestId('prop-color-auto').click();
  expect((await getScene(page)).gears.gear_1).not.toHaveProperty('color');
});

test('シルバーの歯車は、木のテーマでは木の自動の質感（色の欄はどれも選ばれず注意書き）、真鍮に戻すとシルバー', async ({
  page,
}) => {
  await openApp(page, { scene: twoGears });
  await page.evaluate(() => window.__gearSim?.select('gear_1'));
  await page.getByTestId('prop-color-silver').click();
  await expect.poll(() => materialColor(page, 'gear_1')).toBe(STEEL);
  await expect(page.getByTestId('prop-color-note')).toHaveCount(0);

  await page.getByTestId('toolbar-theme').click();
  await expect.poll(() => materialColor(page, 'gear_1')).toBe(LIGHT_WOOD);
  // 値は消さない
  expect(await colorOf(page, 'gear_1')).toBe('silver');
  // 木のテーマ: 自動・木・ダークオーク。どれも選ばれていない
  const field = page.getByTestId('prop-color');
  await expect(field.getByRole('radio')).toHaveCount(3);
  await expect(page.getByTestId('prop-color-silver')).toHaveCount(0);
  for (const id of ['auto', 'wood', 'darkOak']) {
    await expect(page.getByTestId(`prop-color-${id}`)).toHaveAttribute('aria-checked', 'false');
  }
  await expect(page.getByTestId('prop-color-note')).toContainText('Silver');

  await page.getByTestId('toolbar-theme').click();
  await expect.poll(() => materialColor(page, 'gear_1')).toBe(STEEL);
  await expect(page.getByTestId('prop-color-silver')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('prop-color-note')).toHaveCount(0);
});

test('木のテーマでダークオークを選べる', async ({ page }) => {
  await openApp(page, { scene: twoGears });
  await page.getByTestId('toolbar-theme').click();
  await page.evaluate(() => window.__gearSim?.select('gear_2'));
  await expect.poll(() => materialColor(page, 'gear_2')).toBe(LIGHT_WOOD);
  await page.getByTestId('prop-color-darkOak').click();
  expect(await colorOf(page, 'gear_2')).toBe('darkOak');
  await expect(page.getByTestId('prop-color-darkOak')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => materialColor(page, 'gear_2')).toBe(DARK_OAK);
});

test('色を付けた歯車から候補で歯車を生やす → 新しい歯車の color が同じ', async ({ page }) => {
  await openApp(page, { scene: twoGears });
  await page.keyboard.press('Home');
  await clickGear(page, 'gear_1');
  await page.getByTestId('prop-color-metallicBlue').click();
  expect(await colorOf(page, 'gear_1')).toBe('metallicBlue');
  // gear_2 から遠い順に、押す点で pick がその候補に当たる外周の候補（ハンドルや gear_2 の陰にならないもの）
  const layout = await getLayout(page);
  const b = centerOf(layout, 'gear_2');
  const perimeter = (await getCandidates(page)).filter((c) => c.kind === 'perimeter');
  perimeter.sort((p, q) => distance(q.center, b) - distance(p.center, b));
  let target: (typeof perimeter)[number] | undefined;
  for (const c of perimeter) {
    const p = await project(page, c.center);
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind === 'candidate' && hit.id === String(c.index)) {
      target = c;
      break;
    }
  }
  if (target === undefined) throw new Error('押せる外周の候補が無い');
  const added = await clickPerimeterCandidate(page, target.center);
  expect(await colorOf(page, added)).toBe('metallicBlue');
  await expect.poll(() => materialColor(page, added)).toBe(METALLIC_BLUE);
});

test('ラック・キャリア・固定具にも色を付けられる。シャフトには色の欄が出ない', async ({ page }) => {
  await openApp(page, { scene: showcase });
  const scene = (): Promise<Scene> => getScene(page);

  await page.evaluate(() => window.__gearSim?.select('rack_r'));
  await page.getByTestId('prop-color-silver').click();
  expect((await scene()).racks.rack_r?.color).toBe('silver');
  await expect.poll(() => materialColor(page, 'rack_r')).toBe(STEEL);
  // リングのシャフトは固定されている（anchor_r）ので、リングを選ぶと固定具の欄に固定具の色の欄も出る
  await page.evaluate(() => window.__gearSim?.select('gear_r'));
  await page.getByTestId('prop-anchor-color-metallicBlue').click();
  expect((await scene()).anchors.anchor_r?.color).toBe('metallicBlue');
  await expect.poll(() => materialColor(page, 'anchor_r')).toBe(METALLIC_BLUE);

  await page.evaluate(() => window.__gearSim?.select('carrier_k'));
  await page.getByTestId('prop-color-brass').click();
  expect((await scene()).carriers.carrier_k?.color).toBe('brass');
  await expect.poll(() => materialColor(page, 'carrier_k')).toBe(BRASS);

  // シャフト（モーターはシャフトとして選ばれる）には色の欄が出ない。固定していなければ固定具の色の欄も出ない
  await page.evaluate(() => window.__gearSim?.select('shaft_d'));
  await expect(page.getByTestId('prop-content')).toBeVisible();
  await expect(page.getByTestId('prop-color')).toHaveCount(0);
  await expect(page.getByTestId('prop-anchor-color')).toHaveCount(0);
});

test('色は自動保存から開き直しても保たれる', async ({ page }) => {
  await openApp(page, { scene: twoGears });
  await page.evaluate(() => window.__gearSim?.select('gear_2'));
  await page.getByTestId('prop-color-silver').click();
  expect(await colorOf(page, 'gear_2')).toBe('silver');
  await waitAutosaved(page);
  await page.reload();
  await waitReady(page);
  expect(await colorOf(page, 'gear_2')).toBe('silver');
  await expect.poll(() => materialColor(page, 'gear_2')).toBe(STEEL);
});
