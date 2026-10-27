import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { MotionState } from '../src/core/kinematics/types';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene, ShaftPlacement } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-19: 外周の角度の円弧ハンドル、シャフト上の位置のドラッグ、浮いたシャフトの付け直し

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

// 縦軸の起点 A（原点 [0, 20, 0]）→ B（+Z）→ C（+Z）。どれも中・20 歯（S1-16）
const chainThree = fixture('chain-three');
// 縦軸の起点 A（[0, 35, 0]）の外周に B（angle 0）と D（angle π/2）
const arcBlocked = fixture('arc-blocked');
// 縦軸の起点 A（[0, 35, 0]、小のモーター）と T（[40, 35, 0]。A と contact）。A の外周に B（angle 0）
const arcLoop = fixture('arc-loop');
// 縦軸の起点（[0, 35, 0]）に A（中・20 歯、offset 0）と E（小・30 歯、offset 8）。E の外周に F
const stacked = fixture('stacked');
// 縦軸の起点 A（[0, 35, 0]、中のモーター）と、detached の D（[100, 35, 0]）に P。P の外周に Q
const reattach = fixture('reattach');

// 上から見下ろす視点
const TOP_VIEW = { position: [0, 400, 0.001] as Vec3, target: [0, 0, 0] as Vec3 };
// 横（+Z の側）から見る視点
const SIDE_VIEW = { position: [0, 35, 400] as Vec3, target: [0, 40, 0] as Vec3 };

const MESH_DISTANCE_EPS = 1e-3;

type Handle = { kind: string; targetId: string; position: Vec3 };
type Point = { x: number; y: number };

async function open(page: Page, scene: Scene, view = TOP_VIEW): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), view);
}

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

async function getMotion(page: Page): Promise<MotionState> {
  const motion = await page.evaluate(() => window.__gearSim?.getMotion());
  if (motion === undefined) throw new Error('__gearSim が無い');
  return motion;
}

async function getHandles(page: Page): Promise<Handle[]> {
  const handles = await page.evaluate(() => window.__gearSim?.getHandles());
  if (handles === undefined) throw new Error('__gearSim が無い');
  return handles;
}

async function project(page: Page, world: Vec3): Promise<Point> {
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

async function select(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => window.__gearSim?.select(target), id);
}

async function handleOf(page: Page, kind: string, targetId: string): Promise<Handle> {
  const handle = (await getHandles(page)).find((h) => h.kind === kind && h.targetId === targetId);
  if (handle === undefined) throw new Error(`${kind}:${targetId} のハンドルが無い`);
  return handle;
}

function placementOf(scene: Scene, shaftId: string): ShaftPlacement {
  const placement = scene.shafts[shaftId]?.placement;
  if (placement === undefined) throw new Error(`${shaftId} が無い`);
  return placement;
}

function meshAngle(scene: Scene, shaftId: string): number {
  const p = placementOf(scene, shaftId);
  if (p.kind !== 'mesh') throw new Error(`${shaftId} は mesh でない`);
  return p.angle;
}

function centerOf(layout: Layout, gearId: string): Vec3 {
  const center = layout.gears[gearId]?.center;
  if (center === undefined) throw new Error(`${gearId} がレイアウトに無い`);
  return center;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// −π〜π に巻き戻した角度の差
function angleDelta(from: number, to: number): number {
  const d = (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d;
}

function pairs(layout: Layout): string[][] {
  return layout.meshes.map((m) => [m.a, m.b, m.source]);
}

// 円弧のハンドルをつかみ、親の中心の画面上の位置のまわりに degrees だけ（10 段階で）回してから離す。
// toward を渡すと、その点の側へ近い向きに回す。beforeUp は離す直前に呼ぶ
async function dragArc(
  page: Page,
  options: {
    parentCenter: Vec3;
    handle: Handle;
    degrees: number;
    toward?: Vec3;
    afterDown?: () => Promise<void>;
    beforeUp?: () => Promise<void>;
  },
): Promise<void> {
  const c = await project(page, options.parentCenter);
  const p0 = await project(page, options.handle.position);
  const r = Math.hypot(p0.x - c.x, p0.y - c.y);
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  let sign = 1;
  if (options.toward !== undefined) {
    const t = await project(page, options.toward);
    sign = angleDelta(a0, Math.atan2(t.y - c.y, t.x - c.x)) >= 0 ? 1 : -1;
  }
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  if (options.afterDown !== undefined) await options.afterDown();
  const total = (sign * options.degrees * Math.PI) / 180;
  for (let i = 1; i <= 10; i++) {
    const a = a0 + (total * i) / 10;
    await page.mouse.move(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  }
  if (options.beforeUp !== undefined) await options.beforeUp();
  await page.mouse.up();
}

// ページ座標の from から to まで、10 段階でドラッグする
async function drag(
  page: Page,
  from: Point,
  to: Point,
  beforeUp?: () => Promise<void>,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  }
  if (beforeUp !== undefined) await beforeUp();
  await page.mouse.up();
}

test.describe('円弧のハンドル（chain-three.json）', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, chainThree);
    await select(page, 'gear_b');
  });

  test("B を選ぶ → B のシャフトの 'arc' があり、B の 'axial' は無い", async ({ page }) => {
    const handles = await getHandles(page);
    expect(handles.some((h) => h.kind === 'arc' && h.targetId === 'shaft_b')).toBe(true);
    expect(handles.some((h) => h.kind === 'axial' && h.targetId === 'gear_b')).toBe(false);
  });

  test('親 A のまわりに 45° 分ドラッグ → angle が約 π/4 変わり、C もついてくる。Ctrl+Z で戻る', async ({
    page,
  }) => {
    const before = await getLayout(page);
    const camera = await page.evaluate(() => window.__gearSim?.getCamera());
    await dragArc(page, {
      parentCenter: centerOf(before, 'gear_a'),
      handle: await handleOf(page, 'arc', 'shaft_b'),
      degrees: 45,
    });
    const scene = await getScene(page);
    const delta = angleDelta(0, meshAngle(scene, 'shaft_b'));
    expect(Math.abs(Math.abs(delta) - Math.PI / 4)).toBeLessThan(0.05);
    const after = await getLayout(page);
    expect(distance(centerOf(after, 'gear_a'), centerOf(after, 'gear_b'))).toBeCloseTo(40, 6);
    expect(distance(centerOf(after, 'gear_b'), centerOf(after, 'gear_c'))).toBeCloseTo(40, 6);
    expect(distance(centerOf(after, 'gear_c'), centerOf(before, 'gear_c'))).toBeGreaterThan(10);
    expect(pairs(after)).toContainEqual(['gear_a', 'gear_b', 'tree']);
    expect(pairs(after)).toContainEqual(['gear_b', 'gear_c', 'tree']);
    // ハンドルのドラッグはカメラを回さない。選択も変わらない
    expect(await page.evaluate(() => window.__gearSim?.getCamera())).toEqual(camera);
    expect(await page.evaluate(() => window.__gearSim?.getSelection())).toEqual(['gear_b']);

    await page.keyboard.press('Control+z');
    expect(meshAngle(await getScene(page), 'shaft_b')).toBe(0);
  });

  test('Shift を押しながら 50° 分ドラッグ → 変化量が π/12 の整数倍', async ({ page }) => {
    await dragArc(page, {
      parentCenter: centerOf(await getLayout(page), 'gear_a'),
      handle: await handleOf(page, 'arc', 'shaft_b'),
      degrees: 50,
      afterDown: () => page.keyboard.down('Shift'),
    });
    await page.keyboard.up('Shift');
    const delta = angleDelta(0, meshAngle(await getScene(page), 'shaft_b'));
    expect(Math.abs(delta)).toBeGreaterThan(0.1);
    const steps = delta / (Math.PI / 12);
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9);
  });
});

test('arc-blocked.json: B の円弧を D の側へ 90° → D とかみ合う角度（π/6）で止まる', async ({
  page,
}) => {
  await open(page, arcBlocked);
  await select(page, 'gear_b');
  const layout = await getLayout(page);
  await dragArc(page, {
    parentCenter: centerOf(layout, 'gear_a'),
    handle: await handleOf(page, 'arc', 'shaft_b'),
    degrees: 90,
    toward: centerOf(layout, 'gear_d'),
  });
  const after = await getLayout(page);
  expect(after.interferences).toEqual([]);
  expect(meshAngle(await getScene(page), 'shaft_b')).toBeCloseTo(Math.PI / 6, 6);
  expect(pairs(after)).toContainEqual(['gear_b', 'gear_d', 'contact']);
});

test('arc-loop.json: B の円弧を T の側へ 30° → T とかみ合ってループになり、ロックする。Ctrl+Z で解ける', async ({
  page,
}) => {
  await open(page, arcLoop);
  const motion = await getMotion(page);
  expect(motion.locks).toEqual([]);
  for (const id of ['shaft_a', 'shaft_t', 'shaft_b']) {
    expect(Math.abs(motion.omegas[id] ?? 0)).toBeGreaterThan(0.1);
  }

  await select(page, 'gear_b');
  const layout = await getLayout(page);
  await dragArc(page, {
    parentCenter: centerOf(layout, 'gear_a'),
    handle: await handleOf(page, 'arc', 'shaft_b'),
    degrees: 30,
    toward: centerOf(layout, 'gear_t'),
  });

  const delta = angleDelta(0, meshAngle(await getScene(page), 'shaft_b'));
  expect(Math.abs(delta)).toBeCloseTo(Math.PI / 6, 6);
  const after = await getLayout(page);
  expect(
    Math.abs(distance(centerOf(after, 'gear_b'), centerOf(after, 'gear_t')) - 40),
  ).toBeLessThanOrEqual(MESH_DISTANCE_EPS);
  expect(pairs(after)).toContainEqual(['gear_b', 'gear_t', 'contact']);
  expect(after.interferences).toEqual([]);
  const locked = await getMotion(page);
  const lock = locked.locks.find((l) => l.reason === 'contradiction');
  expect(lock?.shaftIds).toEqual(['shaft_a', 'shaft_b', 'shaft_t']);

  await page.keyboard.press('Control+z');
  expect((await getMotion(page)).locks).toEqual([]);
});

test.describe('軸方向のハンドル（stacked.json）', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, stacked, SIDE_VIEW);
    await select(page, 'gear_e');
  });

  test("E を選ぶ → 'axial' がある。上へ 40px → offset が 8 より大きい 4 の倍数、F もついてくる", async ({
    page,
  }) => {
    const handle = await handleOf(page, 'axial', 'gear_e');
    const before = await getLayout(page);
    const from = await project(page, handle.position);
    await drag(page, from, { x: from.x, y: from.y - 40 });

    const offset = (await getScene(page)).gears.gear_e?.offset ?? 0;
    expect(offset).toBeGreaterThan(8);
    expect(offset % 4).toBe(0);
    const after = await getLayout(page);
    const dy = offset - 8;
    expect(centerOf(after, 'gear_e')[1] - centerOf(before, 'gear_e')[1]).toBeCloseTo(dy, 6);
    expect(centerOf(after, 'gear_f')[1] - centerOf(before, 'gear_f')[1]).toBeCloseTo(dy, 6);
    expect(pairs(after)).toContainEqual(['gear_e', 'gear_f', 'tree']);
    expect(distance(centerOf(after, 'gear_e'), centerOf(after, 'gear_f'))).toBeCloseTo(30, 6);

    await page.keyboard.press('Control+z');
    expect((await getScene(page)).gears.gear_e?.offset).toBe(8);
  });

  test('E を下へ A に重なる所までドラッグして離す → 干渉は無く、E は A に重ならない位置', async ({
    page,
  }) => {
    const handle = await handleOf(page, 'axial', 'gear_e');
    const from = await project(page, handle.position);
    // A の中心の高さ（y = 39）まで下げる
    const to = await project(page, [handle.position[0], 39, handle.position[2]]);
    await drag(page, from, { x: from.x, y: to.y });
    expect((await getLayout(page)).interferences).toEqual([]);
    const offset = (await getScene(page)).gears.gear_e?.offset ?? Number.NaN;
    // A は offset 0〜8、E（歯幅 4）は offset〜offset + 4
    expect(offset >= 8 || offset + 4 <= 0).toBe(true);
  });

  test('ドラッグ中に Esc → シーンが変わらない', async ({ page }) => {
    const handle = await handleOf(page, 'axial', 'gear_e');
    const from = await project(page, handle.position);
    await drag(page, from, { x: from.x, y: from.y - 40 }, () => page.keyboard.press('Escape'));
    expect(await getScene(page)).toEqual(stacked);
  });
});

test.describe('浮いたシャフトの付け直し（reattach.json）', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, reattach);
  });

  // P の本体の上で、ハンドル（P の真下の位置・高さのハンドル）を避けた点
  async function pointOnP(page: Page): Promise<Point> {
    const p = centerOf(await getLayout(page), 'gear_p');
    const point = await project(page, [p[0] + 12, p[1], p[2]]);
    const body = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), point);
    expect(body?.kind === 'handle').toBe(false);
    return point;
  }

  test('P を選び、A の外周（+X 側 40 mm）へドラッグ → 付け直され、その先もついてくる。Ctrl+Z で戻る', async ({
    page,
  }) => {
    await select(page, 'gear_p');
    const before = await getLayout(page);
    const camera = await page.evaluate(() => window.__gearSim?.getCamera());
    const a = centerOf(before, 'gear_a');
    const target = await project(page, [a[0] + 40, a[1], a[2]]);
    await drag(page, await pointOnP(page), target);

    expect(placementOf(await getScene(page), 'shaft_d')).toMatchObject({
      kind: 'mesh',
      parentGearId: 'gear_a',
      childGearId: 'gear_p',
    });
    const after = await getLayout(page);
    expect(distance(centerOf(after, 'gear_a'), centerOf(after, 'gear_p'))).toBeCloseTo(40, 6);
    expect(distance(centerOf(after, 'gear_p'), centerOf(after, 'gear_q'))).toBeCloseTo(40, 6);
    expect(pairs(after)).toContainEqual(['gear_a', 'gear_p', 'tree']);
    expect(pairs(after)).toContainEqual(['gear_p', 'gear_q', 'tree']);
    const motion = await getMotion(page);
    expect(motion.omegas.shaft_d).toBeCloseTo(-Math.PI, 6);
    expect(motion.omegas.shaft_q).toBeCloseTo(Math.PI, 6);
    expect(await page.evaluate(() => window.__gearSim?.getCamera())).toEqual(camera);

    await page.keyboard.press('Control+z');
    expect(placementOf(await getScene(page), 'shaft_d')).toMatchObject({ kind: 'detached' });
    const undone = await getLayout(page);
    for (const id of ['gear_p', 'gear_q']) {
      expect(distance(centerOf(undone, id), centerOf(before, id))).toBeCloseTo(0, 6);
    }
  });

  test('P を選び、何もない所へドラッグして離す・Esc でやめる → シーンが変わらない', async ({
    page,
  }) => {
    await select(page, 'gear_p');
    const empty = await project(page, [100, 0, -100]);
    await drag(page, await pointOnP(page), empty);
    expect(await getScene(page)).toEqual(reattach);

    const a = centerOf(await getLayout(page), 'gear_a');
    const target = await project(page, [a[0] + 40, a[1], a[2]]);
    await drag(page, await pointOnP(page), target, () => page.keyboard.press('Escape'));
    expect(await getScene(page)).toEqual(reattach);
    expect(await page.evaluate(() => window.__gearSim?.getSelection())).toEqual(['gear_p']);
  });

  test('P を選び、Q の外周（+X 側 40 mm）へドラッグ → シーンが変わらない（循環になるので候補が無い）', async ({
    page,
  }) => {
    await select(page, 'gear_p');
    const q = centerOf(await getLayout(page), 'gear_q');
    await drag(page, await pointOnP(page), await project(page, [q[0] + 40, q[1], q[2]]));
    expect(await getScene(page)).toEqual(reattach);
  });

  test('P を選ばずに P の上で左ドラッグ → 付け直さない（手で回すは S1-21）', async ({ page }) => {
    const camera = await page.evaluate(() => window.__gearSim?.getCamera());
    const a = centerOf(await getLayout(page), 'gear_a');
    const p = await project(page, centerOf(await getLayout(page), 'gear_p'));
    await drag(page, p, await project(page, [a[0] + 40, a[1], a[2]]));
    expect(await getScene(page)).toEqual(reattach);
    // 部品の上の左ドラッグなので、カメラも回らない
    expect(await page.evaluate(() => window.__gearSim?.getCamera())).toEqual(camera);
  });
});

test('arc-loop.json: T の側へ 27° で離しても、5° 以内なので T とかみ合う π/6 に吸着する', async ({
  page,
}) => {
  await open(page, arcLoop);
  await select(page, 'gear_b');
  const layout = await getLayout(page);
  await dragArc(page, {
    parentCenter: centerOf(layout, 'gear_a'),
    handle: await handleOf(page, 'arc', 'shaft_b'),
    degrees: 27,
    toward: centerOf(layout, 'gear_t'),
  });
  const delta = angleDelta(0, meshAngle(await getScene(page), 'shaft_b'));
  expect(Math.abs(delta)).toBeCloseTo(Math.PI / 6, 6);
  expect(pairs(await getLayout(page))).toContainEqual(['gear_b', 'gear_t', 'contact']);
});
