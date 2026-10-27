import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import type { CameraPose } from '../src/input/camera';
import { expect, test } from './fixtures/test';

// 縦軸の起点のシャフト（原点 [0, 20, 0]）に A、+Z の向きに B、さらに +Z に C（どれも中・20 歯）
const chainThree = JSON.parse(
  readFileSync(new URL('./fixtures/chain-three.json', import.meta.url), 'utf8'),
) as Scene;

const A = 'gear_a';
const B = 'gear_b';
const C = 'gear_c';
const SHAFT_A = 'shaft_a';
const SHAFT_B = 'shaft_b';
const SHAFT_C = 'shaft_c';
const TIP_RADIUS = 22; // 中・20 歯の歯先円半径

// 上から見下ろす視点（真上だと up と視線が平行になるので、少しだけ +Z 側から）
const TOP_VIEW = { position: [0, 260, 70] as Vec3, target: [0, 24, 40] as Vec3 };
// 部品から十分離れた床の点（「何もない所」）
const EMPTY_FLOOR: Vec3 = [60, 0, 40];

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function getLayout(page: Page): Promise<Layout> {
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  if (layout === undefined) throw new Error('__gearSim が無い');
  return layout;
}

async function getScene(page: Page): Promise<Scene> {
  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  if (scene === undefined) throw new Error('__gearSim が無い');
  return scene;
}

async function getSelection(page: Page): Promise<string[] | undefined> {
  return page.evaluate(() => window.__gearSim?.getSelection());
}

async function getCamera(page: Page): Promise<CameraPose> {
  const pose = await page.evaluate(() => window.__gearSim?.getCamera());
  if (pose === undefined) throw new Error('__gearSim が無い');
  return pose;
}

async function project(page: Page, world: Vec3): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

async function gearCenter(page: Page, id: string): Promise<Vec3> {
  const placed = (await getLayout(page)).gears[id];
  if (placed === undefined) throw new Error(`${id} がレイアウトに無い`);
  return placed.center;
}

async function clickAt(page: Page, world: Vec3): Promise<void> {
  const p = await project(page, world);
  await page.mouse.click(p.x, p.y);
}

async function drag(page: Page, from: { x: number; y: number }, dx = 100, dy = 0): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

// 移り終わる（100ms のあいだに位置も注視点も動かない）まで待って、その視点を返す
async function settledCamera(page: Page): Promise<CameraPose> {
  let last = await getCamera(page);
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(100);
        const now = await getCamera(page);
        const moved = dist(now.position, last.position) + dist(now.target, last.target);
        last = now;
        return moved;
      },
      { timeout: 5000 },
    )
    .toBeLessThan(1e-3);
  return last;
}

async function selectB(page: Page): Promise<void> {
  await clickAt(page, await gearCenter(page, B));
  expect(await getSelection(page)).toEqual([B]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((scene) => window.__gearSim?.loadScene(scene), chainThree);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), TOP_VIEW);
});

test('B の中心をクリック → B が選ばれ、pick も歯車の B', async ({ page }) => {
  const center = await gearCenter(page, B);
  const p = await project(page, center);
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
  expect(hit).toMatchObject({ kind: 'gear', id: B });
  await page.mouse.click(p.x, p.y);
  expect(await getSelection(page)).toEqual([B]);
});

test('A のシャフトの歯車から外れた所をクリック → A のシャフトが選ばれる', async ({ page }) => {
  // 真上からだとシャフトの端が歯車に隠れるので、真横（+X の側）から見る
  const shaft = (await getLayout(page)).shafts[SHAFT_A];
  if (shaft === undefined) throw new Error('A のシャフトが無い');
  const top = shaft.origin[1] + shaft.span[1] - 1; // 上の端の 1 mm 手前（歯車の面より 3 mm 上）
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), {
    position: [200, 24, 0] as Vec3,
    target: [0, 24, 0] as Vec3,
  });
  const point: Vec3 = [shaft.origin[0], top, shaft.origin[2]];
  const p = await project(page, point);
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
  expect(hit).toMatchObject({ kind: 'shaft', id: SHAFT_A });
  await page.mouse.click(p.x, p.y);
  expect(await getSelection(page)).toEqual([SHAFT_A]);
});

test('何もない所をクリック → 選択が外れる', async ({ page }) => {
  await selectB(page);
  await clickAt(page, EMPTY_FLOOR);
  expect(await getSelection(page)).toEqual([]);
});

test('B を選んで Esc → 選択が外れる', async ({ page }) => {
  await selectB(page);
  await page.keyboard.press('Escape');
  expect(await getSelection(page)).toEqual([]);
});

test('B を選んで、何もない所で左ドラッグ（カメラ回転）→ 選択はそのまま', async ({ page }) => {
  await selectB(page);
  await drag(page, await project(page, EMPTY_FLOOR));
  const pose = await settledCamera(page);
  expect(dist(pose.position, TOP_VIEW.position)).toBeGreaterThan(1);
  expect(await getSelection(page)).toEqual([B]);
});

test('B を選んで Delete → B が消え、C は浮いたまま同じ位置に残る。Ctrl+Z / Ctrl+Shift+Z', async ({
  page,
}) => {
  const cBefore = await gearCenter(page, C);
  await selectB(page);
  await page.keyboard.press('Delete');

  let scene = await getScene(page);
  expect(scene.gears[B]).toBeUndefined();
  expect(scene.shafts[SHAFT_C]?.placement.kind).toBe('detached');
  const cAfter = await gearCenter(page, C);
  for (let i = 0; i < 3; i++) expect(cAfter[i]).toBeCloseTo(cBefore[i] as number, 6);
  expect(await getSelection(page)).toEqual([]);

  await page.keyboard.press('Control+z');
  scene = await getScene(page);
  expect(scene.gears[B]).toBeDefined();
  expect(scene.shafts[SHAFT_C]?.placement.kind).toBe('mesh');

  await page.keyboard.press('Control+Shift+z');
  scene = await getScene(page);
  expect(scene.gears[B]).toBeUndefined();
  expect(scene.shafts[SHAFT_C]?.placement.kind).toBe('detached');

  // Mac の Cmd も同じ
  await page.keyboard.press('Meta+z');
  expect((await getScene(page)).gears[B]).toBeDefined();
  await page.keyboard.press('Meta+Shift+z');
  expect((await getScene(page)).gears[B]).toBeUndefined();
});

test('Backspace でも選択中の部品が消える（Mac 用）', async ({ page }) => {
  await selectB(page);
  await page.keyboard.press('Backspace');
  expect((await getScene(page)).gears[B]).toBeUndefined();
});

test('A のシャフトを選んで Delete → A とそのシャフトが消え、B のシャフトが浮く', async ({
  page,
}) => {
  await page.evaluate((id) => window.__gearSim?.select(id), SHAFT_A);
  expect(await getSelection(page)).toEqual([SHAFT_A]);
  await page.keyboard.press('Delete');
  const scene = await getScene(page);
  expect(scene.gears[A]).toBeUndefined();
  expect(scene.shafts[SHAFT_A]).toBeUndefined();
  expect(scene.shafts[SHAFT_B]?.placement.kind).toBe('detached');
  expect(await getSelection(page)).toEqual([]);
});

test('歯車 B の上で左ドラッグ → カメラは回らない。Alt+左ドラッグ → 回る', async ({ page }) => {
  const from = await project(page, await gearCenter(page, B));
  await drag(page, from);
  let pose = await settledCamera(page);
  expect(dist(pose.position, TOP_VIEW.position)).toBeLessThan(1e-3);
  expect(dist(pose.target, TOP_VIEW.target)).toBeLessThan(1e-3);
  // ドラッグはクリックではないので選ばない
  expect(await getSelection(page)).toEqual([]);

  await page.keyboard.down('Alt');
  await drag(page, from);
  await page.keyboard.up('Alt');
  pose = await settledCamera(page);
  expect(dist(pose.position, TOP_VIEW.position)).toBeGreaterThan(1);
});

test('パレットの上で左ドラッグ → カメラは変わらない', async ({ page }) => {
  const box = await page.getByTestId('palette').boundingBox();
  if (box === null) throw new Error('パレットが無い');
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 60, 40);
  const pose = await settledCamera(page);
  expect(dist(pose.position, TOP_VIEW.position)).toBeLessThan(1e-3);
  expect(dist(pose.target, TOP_VIEW.target)).toBeLessThan(1e-3);
});

test('B を選んで F → 注視点が B の中心に寄る', async ({ page }) => {
  await selectB(page);
  const center = await gearCenter(page, B);
  await page.keyboard.press('f');
  const pose = await settledCamera(page);
  expect(dist(pose.target, center)).toBeLessThan(TIP_RADIUS);
});

test('input にフォーカスがあるときは Delete で部品が消えない', async ({ page }) => {
  await selectB(page);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.dataset.testid = 'test-input';
    document.body.append(input);
  });
  await page.getByTestId('test-input').focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  expect((await getScene(page)).gears[B]).toBeDefined();
  expect(await getSelection(page)).toEqual([B]);
});

test('モーターをクリック → そのシャフトが選ばれる。select で選び、無い ID は外れる', async ({
  page,
}) => {
  await page.evaluate(() =>
    window.__gearSim?.dispatch({ type: 'addMotor', shaftId: 'shaft_c', size: 'M' }),
  );
  // モーターはシャフトの負側（下）の端の外に描かれるので、真横から見る
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), {
    position: [200, 15, 80] as Vec3,
    target: [0, 15, 80] as Vec3,
  });
  const shaft = (await getLayout(page)).shafts[SHAFT_C];
  if (shaft === undefined) throw new Error('C のシャフトが無い');
  // シャフトの下の端からモーターの箱（一辺 8、すき間 1）の中心まで 5 mm
  const motorCenter: Vec3 = [shaft.origin[0], shaft.origin[1] + shaft.span[0] - 5, shaft.origin[2]];
  const p = await project(page, motorCenter);
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
  expect(hit?.kind).toBe('motor');
  await page.mouse.click(p.x, p.y);
  expect(await getSelection(page)).toEqual([SHAFT_C]);

  await page.evaluate(() => window.__gearSim?.select('gear_nothing'));
  expect(await getSelection(page)).toEqual([]);
});
