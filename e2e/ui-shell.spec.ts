import type { Page } from '@playwright/test';
import { en } from '../src/core/i18n/en';
import { ja } from '../src/core/i18n/ja';
import { expect, test } from './fixtures/test';

// 並び順（S1-15 の資料の表のとおり）
const TOOLBAR_IDS = [
  'works',
  'save',
  'export',
  'import',
  'theme',
  'info',
  'mute',
  'settings',
] as const;
// 動作が付いて有効になっているボタン
const ENABLED_IDS: ReadonlySet<string> = new Set(['info', 'theme', 'mute']);

type Box = { x: number; y: number; width: number; height: number };
type Counts = { pointerdown: number; wheel: number };

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} の boundingBox が無い`);
  return box;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('8 つのツールバーのボタンが表の順に左から並ぶ', async ({ page }) => {
  await open(page);
  let prevX = Number.NEGATIVE_INFINITY;
  for (const id of TOOLBAR_IDS) {
    const button = page.getByTestId(`toolbar-${id}`);
    await expect(button).toBeVisible();
    // 動作を付けたボタン（S1-23 の情報表示）だけ有効。他は担当のタスクで有効にする
    if (ENABLED_IDS.has(id)) await expect(button).toBeEnabled();
    else await expect(button).toBeDisabled();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    expect(box.x, `toolbar-${id} は前のボタンより右`).toBeGreaterThan(prevX);
    prevX = box.x;
  }
});

test('パレット・プロパティパネル・canvas が重ならず、canvas が中央にある', async ({ page }) => {
  await open(page);
  const palette = await boxOf(page, '[data-testid="palette"]');
  const properties = await boxOf(page, '[data-testid="properties"]');
  const toolbar = await boxOf(page, '[data-testid="toolbar"]');
  const canvas = await boxOf(page, 'canvas');
  expect(overlaps(palette, canvas)).toBe(false);
  expect(overlaps(properties, canvas)).toBe(false);
  expect(overlaps(palette, properties)).toBe(false);
  expect(overlaps(toolbar, canvas)).toBe(false);
  // 左にパレット、右にプロパティ、上にツールバー
  expect(palette.x + palette.width).toBeLessThanOrEqual(canvas.x);
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(properties.x);
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(canvas.y);
  // 軸の目印の置き場は描画領域の右下
  const gizmo = await boxOf(page, '[data-testid="gizmo-slot"]');
  expect(gizmo.x).toBeGreaterThan(canvas.x + canvas.width / 2);
  expect(gizmo.y).toBeGreaterThan(canvas.y + canvas.height / 2);
  expect(gizmo.x + gizmo.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(gizmo.y + gizmo.height).toBeLessThanOrEqual(canvas.y + canvas.height);
});

test('幅を 1280 → 1000 に縮めると canvas が同じだけ縮み、描画バッファの縦横比が表示と一致する', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page);
  const before = await boxOf(page, 'canvas');
  await page.setViewportSize({ width: 1000, height: 720 });
  await expect
    .poll(async () => (await boxOf(page, 'canvas')).width)
    .toBeCloseTo(before.width - 280, 0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (canvas === null) throw new Error('canvas が無い');
        return Math.abs(canvas.width / canvas.height - canvas.clientWidth / canvas.clientHeight);
      }),
    )
    .toBeLessThan(0.01);
  // カメラの縦横比も表示に合う（中央の点は中央に写る）
  const box = await boxOf(page, 'canvas');
  const center = await page.evaluate(() => {
    const sim = window.__gearSim;
    if (sim === undefined) throw new Error('__gearSim が無い');
    return sim.projectToScreen(sim.getCamera().target);
  });
  expect(center.x).toBeCloseTo(box.x + box.width / 2, 0);
  expect(center.y).toBeCloseTo(box.y + box.height / 2, 0);
});

test('プロパティパネルに案内文が出ている', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('properties-empty')).toBeVisible();
});

test.describe('ブラウザの言語が ja-JP', () => {
  test.use({ locale: 'ja-JP' });

  test('ツールバーの文字と title が言語の切り替えで変わる', async ({ page }) => {
    await open(page);
    const save = page.getByTestId('toolbar-save');
    await expect(save).toHaveText(ja['toolbar.save']);
    await expect(save).toHaveAttribute('title', ja['toolbar.save.tooltip']);
    await expect(save).toHaveAttribute('aria-label', ja['toolbar.save']);
    await expect(page.getByTestId('properties-empty')).toHaveText(ja['properties.empty']);
    await expect(page.getByTestId('palette-title')).toHaveText(ja['palette.title']);

    await page.evaluate(() => window.__gearSim?.setLanguage('en'));
    await expect(save).toHaveText(en['toolbar.save']);
    await expect(save).toHaveAttribute('title', en['toolbar.save.tooltip']);
    await expect(save).toHaveAttribute('aria-label', en['toolbar.save']);
    await expect(page.getByTestId('properties-empty')).toHaveText(en['properties.empty']);
    await expect(page.getByTestId('palette-title')).toHaveText(en['palette.title']);
    for (const id of TOOLBAR_IDS) {
      await expect(page.getByTestId(`toolbar-${id}`)).toHaveText(en[`toolbar.${id}`]);
      await expect(page.getByTestId(`toolbar-${id}`)).toHaveAttribute(
        'title',
        en[`toolbar.${id}.tooltip`],
      );
    }
  });
});

test('パネルとツールバーの上の pointerdown と wheel は canvas に届かない', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) throw new Error('canvas が無い');
    const counts = { pointerdown: 0, wheel: 0 };
    canvas.addEventListener('pointerdown', () => {
      counts.pointerdown += 1;
    });
    canvas.addEventListener('wheel', () => {
      counts.wheel += 1;
    });
    (window as unknown as { __counts: Counts }).__counts = counts;
  });
  const counts = (): Promise<Counts> =>
    page.evaluate(() => ({ ...(window as unknown as { __counts: Counts }).__counts }));

  for (const selector of [
    '[data-testid="palette"]',
    '[data-testid="properties"]',
    '[data-testid="toolbar"]',
  ]) {
    const box = await boxOf(page, selector);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    for (const button of ['left', 'middle', 'right'] as const) {
      await page.mouse.down({ button });
      await page.mouse.move(x + 30, y + 10, { steps: 5 });
      await page.mouse.up({ button });
      await page.mouse.move(x, y);
    }
    await page.mouse.wheel(0, 200);
  }
  // wheel はイベントの配送が遅れることがあるので少し待つ
  await page.waitForTimeout(200);
  expect(await counts()).toEqual({ pointerdown: 0, wheel: 0 });

  // 対照: canvas の上なら届く
  const canvas = await boxOf(page, 'canvas');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await counts()).wheel).toBeGreaterThan(0);
  expect((await counts()).pointerdown).toBeGreaterThan(0);
});

test('パネルの上のホイールはパネルのスクロールになる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await open(page);
  // パネルからはみ出す中身を入れる（本当の中身は S1-17・S1-20 が差し込む）
  await page.evaluate(() => {
    const body = document.querySelector('[data-testid="palette-body"]');
    if (body === null) throw new Error('palette-body が無い');
    const tall = document.createElement('div');
    tall.style.height = '2000px';
    body.append(tall);
  });
  const box = await boxOf(page, '[data-testid="palette"]');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => page.getByTestId('palette').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
});

test('properties.setContent で中身を差し替え、null で案内文に戻る。dispose で取り除かれる', async ({
  page,
}) => {
  await open(page);
  // 別の root に 2 つ目のシェルを作って確かめる（main.ts のシェルには触れない）
  const result = await page.evaluate(() =>
    import('/src/ui/shell.ts').then((m) => {
      const root = document.createElement('div');
      document.body.append(root);
      const shell = m.createUiShell(root);
      const empty = () => root.querySelector('[data-testid="properties-empty"]') !== null;
      const initial = empty();
      const content = document.createElement('p');
      content.id = 'custom-content';
      shell.properties.setContent(content);
      const replaced = !empty() && root.querySelector('#custom-content') !== null;
      shell.properties.setContent(null);
      const restored = empty() && root.querySelector('#custom-content') === null;
      const button = shell.toolbar.button('settings').dataset.testid;
      shell.dispose();
      const disposed = root.childElementCount === 0;
      root.remove();
      return { initial, replaced, restored, button, disposed };
    }),
  );
  expect(result).toEqual({
    initial: true,
    replaced: true,
    restored: true,
    button: 'toolbar-settings',
    disposed: true,
  });
});
