import type { Locator } from '@playwright/test';
import { openApp, selectPaletteKind } from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S4-08: パレットのボタンにアイコン（SVG）を付ける。文字のラベルは残し、アイコンの色は文字の色（currentColor）に従う

const KINDS = [
  'spur',
  'helical',
  'bevel',
  'worm',
  'wormWheel',
  'crossedHelical',
  'internal',
  'rack',
  'planetary',
] as const;
const SIZES = ['S', 'M', 'L'] as const;

// ボタンの中のアイコン（svg）。見えていて、大きさがある
async function expectIcon(button: Locator): Promise<void> {
  const svg = button.locator('svg');
  await expect(svg).toHaveCount(1);
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(16);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(16);
}

// アイコンの線の色（stroke は currentColor なので、計算後の color と同じ）
async function iconColor(button: Locator): Promise<string> {
  return button.locator('svg').evaluate((el) => {
    const style = getComputedStyle(el);
    return `${style.color}|${style.stroke}`;
  });
}

test('すべての種類・大きさ・起点のシャフトにアイコンがあり、文字のラベルも残っている', async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  for (const kind of KINDS) await expectIcon(page.getByTestId(`palette-kind-${kind}`));
  for (const size of SIZES) await expectIcon(page.getByTestId(`palette-size-${size}`));
  await expectIcon(page.getByTestId('palette-root-shaft'));

  await expect(page.getByTestId('palette-kind-spur')).toHaveText('平歯車');
  await expect(page.getByTestId('palette-kind-planetary')).toHaveText('遊星歯車');
  await expect(page.getByTestId('palette-size-L')).toHaveText('大');
  await expect(page.getByTestId('palette-root-shaft')).toHaveText('起点のシャフト');
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await expect(page.getByTestId('palette-kind-rack')).toHaveText('Rack');
  await expect(page.getByTestId('palette-size-S')).toHaveText('Small');
});

test('アイコンは 2 列の格子で、アイコンが上・文字が下', async ({ page }) => {
  await openApp(page);
  const spur = await page.getByTestId('palette-kind-spur').boundingBox();
  const helical = await page.getByTestId('palette-kind-helical').boundingBox();
  const bevel = await page.getByTestId('palette-kind-bevel').boundingBox();
  if (spur === null || helical === null || bevel === null) throw new Error('ボタンが無い');
  // 1 行目に 2 つ、3 つ目は次の行の左
  expect(Math.abs(spur.y - helical.y)).toBeLessThan(1);
  expect(helical.x).toBeGreaterThan(spur.x + spur.width - 1);
  expect(Math.abs(bevel.x - spur.x)).toBeLessThan(1);
  expect(bevel.y).toBeGreaterThan(spur.y + spur.height - 1);

  const button = page.getByTestId('palette-kind-worm');
  const icon = await button.locator('svg').boundingBox();
  const label = await button.locator('.gs-palette__button-label').boundingBox();
  if (icon === null || label === null) throw new Error('アイコンか文字が無い');
  expect(label.y).toBeGreaterThanOrEqual(icon.y + icon.height - 1);
});

test('アイコンの色は選んでいる状態に合わせて変わり、線は文字の色に従う', async ({ page }) => {
  await openApp(page);
  const spur = page.getByTestId('palette-kind-spur');
  const worm = page.getByTestId('palette-kind-worm');
  await expect(spur).toHaveAttribute('aria-checked', 'true');
  const selected = await iconColor(spur);
  const unselected = await iconColor(worm);
  // stroke は color と同じ（currentColor）
  for (const c of [selected, unselected]) {
    const [color, stroke] = c.split('|');
    expect(stroke).toBe(color);
  }
  expect(selected).not.toBe(unselected);

  await selectPaletteKind(page, 'worm');
  expect(await iconColor(worm)).toBe(selected);
  expect(await iconColor(spur)).toBe(unselected);

  // 大きさも同じ規則
  const m = page.getByTestId('palette-size-M');
  const s = page.getByTestId('palette-size-S');
  await expect(m).toHaveAttribute('aria-checked', 'true');
  expect(await iconColor(m)).not.toBe(await iconColor(s));
  await s.click();
  await expect(s).toHaveAttribute('aria-checked', 'true');
  expect(await iconColor(s)).toBe(await iconColor(page.getByTestId('palette-kind-worm')));
});
