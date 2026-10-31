import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene, ShaftPlacement } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-17: パレットから起点のシャフトを置く、R で向きを変える、位置と高さのハンドル

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

// 縦軸の起点 A（原点 [0, 20, 0]）→ B（+Z）→ C（+Z）。どれも中・20 歯（S1-16）
const chainThree = fixture('chain-three');
// 縦軸の起点を 2 本、x 方向に 100mm 離して置いたもの（どちらも中・20 歯）
const twoRoots = fixture('two-roots');

const EMPTY: Scene = { shafts: {}, gears: {}, motors: {}, anchors: {}, carriers: {}, racks: {} };
// 斜め上から見下ろす視点
const OBLIQUE_VIEW = { position: [120, 170, 200] as Vec3, target: [0, 15, 20] as Vec3 };

async function getScene(page: Page): Promise<Scene> {
  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  if (scene === undefined) throw new Error('__gearSim が無い');
  return scene;
}

async function getLayout(page: Page): Promise<Layout> {
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  if (layout === undefined) throw new Error('__gearSim が無い');
  return layout;
}

async function getSelection(page: Page): Promise<string[] | undefined> {
  return page.evaluate(() => window.__gearSim?.getSelection());
}

async function project(page: Page, world: Vec3): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

async function getHandles(
  page: Page,
): Promise<Array<{ kind: string; targetId: string; position: Vec3 }>> {
  const handles = await page.evaluate(() => window.__gearSim?.getHandles());
  if (handles === undefined) throw new Error('__gearSim が無い');
  return handles;
}

async function handlePoint(page: Page, kind: string): Promise<{ x: number; y: number }> {
  const handle = (await getHandles(page)).find((h) => h.kind === kind);
  if (handle === undefined) throw new Error(`${kind} のハンドルが無い`);
  return project(page, handle.position);
}

function placementOf(scene: Scene, shaftId: string): ShaftPlacement {
  const placement = scene.shafts[shaftId]?.placement;
  if (placement === undefined) throw new Error(`${shaftId} が無い`);
  return placement;
}

function originOf(scene: Scene, shaftId: string): Vec3 {
  const p = placementOf(scene, shaftId);
  if (p.kind !== 'root' && p.kind !== 'detached') throw new Error(`${shaftId} は ${p.kind}`);
  return p.origin;
}

function centerOf(layout: Layout, gearId: string): Vec3 {
  const center = layout.gears[gearId]?.center;
  if (center === undefined) throw new Error(`${gearId} がレイアウトに無い`);
  return center;
}

async function paletteItemCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('palette-root-shaft').boundingBox();
  if (box === null) throw new Error('起点のシャフトの項目が無い');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// パレットの起点の項目から to までドラッグする。beforeUp は離す直前に呼ぶ
async function dragFromPalette(
  page: Page,
  to: { x: number; y: number },
  beforeUp?: () => Promise<void>,
): Promise<void> {
  const from = await paletteItemCenter(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  if (beforeUp !== undefined) await beforeUp();
  await page.mouse.up();
}

// ページ座標の from から to までドラッグする
async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

async function placeAtOrigin(page: Page): Promise<void> {
  await dragFromPalette(page, await project(page, [0, 0, 0]));
}

async function open(page: Page, scene: Scene): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), OBLIQUE_VIEW);
}

test.describe('パレットから起点を置く', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, EMPTY);
  });

  // S4-04: 起点のシャフトは歯車なしで置く
  test('床へドラッグ → __gearSim のシャフトが 1 本増え、歯車は増えない。長さ 20 mm の縦の起点で、そのシャフトが選ばれる', async ({
    page,
  }) => {
    await placeAtOrigin(page);
    const scene = await getScene(page);
    const shafts = Object.values(scene.shafts);
    expect(shafts).toHaveLength(1);
    expect(Object.keys(scene.gears)).toHaveLength(0);
    const shaft = shafts[0];
    if (shaft === undefined) throw new Error('置かれていない');
    const p = shaft.placement;
    if (p.kind !== 'root') throw new Error('root でない');
    expect(p.axis).toBe('y');
    // [0, 35, 0] に近く、x・z は 5 の倍数（高さは中・20 歯を置いても床にめり込まない高さ）
    expect(Math.abs(p.origin[0] % 5)).toBe(0);
    expect(Math.abs(p.origin[2] % 5)).toBe(0);
    expect(Math.abs(p.origin[0])).toBeLessThanOrEqual(5);
    expect(p.origin[1]).toBe(35);
    expect(Math.abs(p.origin[2])).toBeLessThanOrEqual(5);
    expect(shaft.span).toEqual([-10, 10]);
    expect(await getSelection(page)).toEqual([shaft.id]);
  });

  test('続けてパレットではすば歯車を選び、そのシャフトをクリック → はすば歯車が置かれる', async ({
    page,
  }) => {
    await placeAtOrigin(page);
    const shaft = Object.values((await getScene(page)).shafts)[0];
    if (shaft === undefined) throw new Error('置かれていない');
    // 置いたシャフトが選ばれているので、そのままシャフトの上に置ける
    expect(await getSelection(page)).toEqual([shaft.id]);
    await page.getByTestId('palette-kind-helical').click();
    await expect(page.getByTestId('palette-kind-helical')).toHaveAttribute('aria-checked', 'true');
    // シャフトの原点から 4 mm の点 → 中・20 歯（歯幅 8）の中心が 4 に来る offset 0
    const origin = originOf(await getScene(page), shaft.id);
    const p = await project(page, [origin[0], origin[1] + 4, origin[2]]);
    await page.mouse.move(p.x, p.y);
    await expect
      .poll(() => page.evaluate(() => window.__gearSim?.getShaftGhost()))
      .toMatchObject({ shaftId: shaft.id, kind: 'helical', blocked: false });
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => Object.values((await getScene(page)).gears)).toHaveLength(1);
    const gear = Object.values((await getScene(page)).gears)[0];
    expect(gear).toMatchObject({
      kind: 'helical',
      shaftId: shaft.id,
      size: 'M',
      teeth: 20,
      offset: 0,
    });
  });

  test('ドラッグ中に R を 1 回押してから離す → 向きは x', async ({ page }) => {
    await dragFromPalette(page, await project(page, [0, 0, 0]), () => page.keyboard.press('r'));
    const shafts = Object.values((await getScene(page)).shafts);
    expect(shafts).toHaveLength(1);
    expect(shafts[0]?.placement).toMatchObject({ kind: 'root', axis: 'x' });
  });

  test('パレットで「小」を選んでから置く → 小・30 歯が床にめり込まない高さ 30 に置かれ、シャフトの上の仮の歯車は小', async ({
    page,
  }) => {
    await expect(page.getByTestId('palette-size-M')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('palette-size-S').click();
    await expect(page.getByTestId('palette-size-S')).toHaveAttribute('aria-checked', 'true');
    await placeAtOrigin(page);
    const scene = await getScene(page);
    expect(Object.keys(scene.gears)).toHaveLength(0);
    const shaft = Object.values(scene.shafts)[0];
    if (shaft === undefined) throw new Error('置かれていない');
    expect(originOf(scene, shaft.id)[1]).toBe(30);
    const origin = originOf(scene, shaft.id);
    const p = await project(page, [origin[0], origin[1] + 2, origin[2]]);
    await page.mouse.move(p.x, p.y);
    await expect
      .poll(() => page.evaluate(() => window.__gearSim?.getShaftGhost()))
      .toMatchObject({ shaftId: shaft.id, kind: 'spur', size: 'S', blocked: false });
  });

  test('ドラッグ中に Esc → 何も増えない', async ({ page }) => {
    await dragFromPalette(page, await project(page, [0, 0, 0]), () =>
      page.keyboard.press('Escape'),
    );
    expect(await getScene(page)).toEqual(EMPTY);
  });

  test('パレットへ戻して離す → 何も増えない', async ({ page }) => {
    const from = await paletteItemCenter(page);
    const to = await project(page, [0, 0, 0]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.move(from.x, from.y + 30, { steps: 10 });
    await page.mouse.up();
    expect(await getScene(page)).toEqual(EMPTY);
  });

  test('1 本置いた後、そのシャフトの真下へもう 1 本 → 干渉するので増えない', async ({ page }) => {
    await placeAtOrigin(page);
    const shaft = Object.values((await getScene(page)).shafts)[0];
    if (shaft === undefined) throw new Error('置かれていない');
    const origin = originOf(await getScene(page), shaft.id);
    await dragFromPalette(page, await project(page, [origin[0], 0, origin[2]]));
    expect(Object.keys((await getScene(page)).shafts)).toHaveLength(1);
  });

  test('置いた後 Ctrl+Z → シャフトが無くなる', async ({ page }) => {
    await placeAtOrigin(page);
    expect(Object.keys((await getScene(page)).shafts)).toHaveLength(1);
    await page.keyboard.press('Control+z');
    expect(await getScene(page)).toEqual(EMPTY);
  });
});

test.describe('起点のハンドルと向き（chain-three.json）', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, chainThree);
    await page.evaluate(() => window.__gearSim?.select('gear_a'));
  });

  test('A を選ぶと move と height。height を 60px 上へ → 原点の y が増え、B・C もついてくる。Ctrl+Z で戻る', async ({
    page,
  }) => {
    // 歯車を選んでいるので、シャフト上の位置の 'axial'（S1-19）も出る
    const handles = await getHandles(page);
    expect(handles.map((h) => h.kind).sort()).toEqual(['axial', 'height', 'move']);
    expect(handles.filter((h) => h.kind !== 'axial').every((h) => h.targetId === 'shaft_a')).toBe(
      true,
    );

    const before = await getLayout(page);
    const from = await handlePoint(page, 'height');
    await dragOnCanvas(page, from, { x: from.x, y: from.y - 60 });

    const origin = originOf(await getScene(page), 'shaft_a');
    expect(origin[1]).toBeGreaterThan(20);
    expect(origin[1] % 5).toBe(0);
    expect(origin[0]).toBe(0);
    expect(origin[2]).toBe(0);
    const after = await getLayout(page);
    const dy = origin[1] - 20;
    for (const id of ['gear_b', 'gear_c']) {
      expect(centerOf(after, id)[1]).toBeCloseTo(centerOf(before, id)[1] + dy, 6);
    }
    // ハンドルのクリック・ドラッグで選択は変わらない
    expect(await getSelection(page)).toEqual(['gear_a']);

    await page.keyboard.press('Control+z');
    expect(originOf(await getScene(page), 'shaft_a')).toEqual([0, 20, 0]);
  });

  test('move を右へ 80px → x か z が変わり y は変わらない。C も同じだけ動く', async ({ page }) => {
    const before = await getLayout(page);
    const camera = await page.evaluate(() => window.__gearSim?.getCamera());
    const from = await handlePoint(page, 'move');
    await dragOnCanvas(page, from, { x: from.x + 80, y: from.y });

    const origin = originOf(await getScene(page), 'shaft_a');
    expect(origin[0] !== 0 || origin[2] !== 0).toBe(true);
    expect(origin[1]).toBe(20);
    expect(Math.abs(origin[0] % 5)).toBe(0);
    expect(Math.abs(origin[2] % 5)).toBe(0);
    const after = await getLayout(page);
    const c0 = centerOf(before, 'gear_c');
    const c1 = centerOf(after, 'gear_c');
    expect(c1[0] - c0[0]).toBeCloseTo(origin[0], 6);
    expect(c1[1]).toBeCloseTo(c0[1], 6);
    expect(c1[2] - c0[2]).toBeCloseTo(origin[2], 6);
    // ハンドルの上のドラッグはカメラを回さない
    expect(await page.evaluate(() => window.__gearSim?.getCamera())).toEqual(camera);
    // Undo 1 回で戻る
    await page.keyboard.press('Control+z');
    expect(originOf(await getScene(page), 'shaft_a')).toEqual([0, 20, 0]);
  });

  test('ハンドルのドラッグ中に Esc → 元のまま、選択もそのまま', async ({ page }) => {
    const from = await handlePoint(page, 'move');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await getScene(page)).toEqual(chainThree);
    expect(await getSelection(page)).toEqual(['gear_a']);
  });

  test('ハンドルをクリック（動かさない）→ 何も変わらず、選択もそのまま', async ({ page }) => {
    const p = await handlePoint(page, 'move');
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    expect(hit).toMatchObject({ kind: 'handle' });
    await page.mouse.click(p.x, p.y);
    expect(await getScene(page)).toEqual(chainThree);
    expect(await getSelection(page)).toEqual(['gear_a']);
  });

  test('A を選んで R → A の axis が x、3 本とも x でかみ合いのまま。Ctrl+Z で y に戻る', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    expect(placementOf(await getScene(page), 'shaft_a')).toMatchObject({ axis: 'x' });
    const layout = await getLayout(page);
    for (const id of ['shaft_a', 'shaft_b', 'shaft_c']) expect(layout.shafts[id]?.axis).toBe('x');
    const pairs = layout.meshes.map((m) => [m.a, m.b]);
    expect(pairs).toContainEqual(['gear_a', 'gear_b']);
    expect(pairs).toContainEqual(['gear_b', 'gear_c']);
    await page.keyboard.press('Control+z');
    expect(placementOf(await getScene(page), 'shaft_a')).toMatchObject({ axis: 'y' });
  });

  test('B を選んで R → 何も変わらない（mesh のシャフト）', async ({ page }) => {
    await page.evaluate(() => window.__gearSim?.select('gear_b'));
    // mesh のシャフトの子なので、外周の角度の 'arc'（S1-19）だけ
    expect((await getHandles(page)).map((h) => h.kind)).toEqual(['arc']);
    await page.keyboard.press('r');
    expect(await getScene(page)).toEqual(chainThree);
  });
});

test('two-roots.json: 1 本目の move を 2 本目の位置まで引きずる → 干渉の手前で止まる', async ({
  page,
}) => {
  await open(page, twoRoots);
  await page.evaluate(() => window.__gearSim?.select('gear_1'));
  const from = await handlePoint(page, 'move');
  const to = await project(page, [100, 0, 0]);
  await dragOnCanvas(page, from, to, 30);
  const layout = await getLayout(page);
  expect(layout.interferences).toEqual([]);
  const origin = originOf(await getScene(page), 'shaft_1');
  // 中心距離 40（ちょうどかみ合う）までは干渉しない。それより近くでは止まる
  expect(origin[0]).toBeGreaterThan(0);
  expect(origin[0]).toBeLessThanOrEqual(60);
  expect(origin[1]).toBe(35);
  expect(originOf(await getScene(page), 'shaft_2')).toEqual([100, 35, 0]);
});
