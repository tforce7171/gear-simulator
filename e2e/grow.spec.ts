import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-18: 候補の表示とクリックで歯車を生やす

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

// 縦軸の起点のシャフト（原点 [0, 35, 0]）に中・20 歯の歯車 A を 1 枚
const oneRoot = fixture('one-root');
// 上に加えて、A のシャフトに中のモーター（30 rpm、正の向き、ON）
const oneRootMotor = fixture('one-root-motor');
const A = 'gear_a';
const A_SHAFT = 'shaft_a';

// 斜め上から見下ろす視点
const OBLIQUE_VIEW = { position: [120, 210, 200] as Vec3, target: [0, 35, 0] as Vec3 };

type Candidate = {
  index: number;
  kind:
    | 'perimeter'
    | 'bevel'
    | 'skew'
    | 'enclose'
    | 'planetary'
    | 'rack'
    | 'rackPinion'
    | 'coaxial';
  center: Vec3;
};

async function open(page: Page, scene: Scene): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), OBLIQUE_VIEW);
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

async function getCandidates(page: Page): Promise<Candidate[]> {
  const list = await page.evaluate(() => window.__gearSim?.getCandidates());
  if (list === undefined) throw new Error('__gearSim が無い');
  return list;
}

async function getSelection(page: Page): Promise<string[] | undefined> {
  return page.evaluate(() => window.__gearSim?.getSelection());
}

async function project(page: Page, world: Vec3): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

async function clickGear(page: Page, gearId: string): Promise<void> {
  const center = (await getLayout(page)).gears[gearId]?.center;
  if (center === undefined) throw new Error(`${gearId} がレイアウトに無い`);
  const p = await project(page, center);
  await page.mouse.click(p.x, p.y);
}

// kind の候補のうち、中心を画面に写した点が描画領域の内側にあり、その点を押すとその候補に当たるもの
async function candidatePoint(
  page: Page,
  kind: Candidate['kind'],
): Promise<{ x: number; y: number; candidate: Candidate }> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  for (const candidate of await getCandidates(page)) {
    if (candidate.kind !== kind) continue;
    const p = await project(page, candidate.center);
    const inside =
      p.x > box.x + 10 &&
      p.x < box.x + box.width - 10 &&
      p.y > box.y + 10 &&
      p.y < box.y + box.height - 10;
    if (!inside) continue;
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind === 'candidate' && hit.id === String(candidate.index)) {
      return { ...p, candidate };
    }
  }
  throw new Error(`押せる ${kind} の候補が無い`);
}

async function clickCandidate(page: Page, kind: Candidate['kind']): Promise<Candidate> {
  const { x, y, candidate } = await candidatePoint(page, kind);
  await page.mouse.click(x, y);
  return candidate;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test.describe('one-root.json', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, oneRoot);
  });

  test('何も選んでいない → 候補は空', async ({ page }) => {
    expect(await getCandidates(page)).toEqual([]);
  });

  test("A をクリック → 'perimeter' と 'coaxial' の候補がそれぞれ 1 つ以上。選択を外すと消える", async ({
    page,
  }) => {
    await clickGear(page, A);
    expect(await getSelection(page)).toEqual([A]);
    const list = await getCandidates(page);
    expect(list.filter((c) => c.kind === 'perimeter').length).toBeGreaterThanOrEqual(1);
    expect(list.filter((c) => c.kind === 'coaxial').length).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Escape');
    expect(await getCandidates(page)).toEqual([]);
  });

  test('シャフトを選んでいる → 候補は空', async ({ page }) => {
    await page.evaluate((id) => window.__gearSim?.select(id), A_SHAFT);
    expect(await getCandidates(page)).toEqual([]);
  });

  test("'perimeter' の候補をクリック → 新しい mesh のシャフトと歯車が A にかみ合い、それが選ばれる。Ctrl+Z で戻る", async ({
    page,
  }) => {
    await clickGear(page, A);
    await clickCandidate(page, 'perimeter');

    const scene = await getScene(page);
    expect(Object.keys(scene.gears)).toHaveLength(2);
    expect(Object.keys(scene.shafts)).toHaveLength(2);
    const newGearId = Object.keys(scene.gears).find((id) => id !== A);
    const newShaftId = Object.keys(scene.shafts).find((id) => id !== A_SHAFT);
    if (newGearId === undefined || newShaftId === undefined) throw new Error('増えていない');
    expect(scene.shafts[newShaftId]?.placement).toMatchObject({
      kind: 'mesh',
      parentGearId: A,
      childGearId: newGearId,
    });
    expect(scene.gears[newGearId]).toMatchObject({ shaftId: newShaftId, size: 'M', teeth: 20 });

    const layout = await getLayout(page);
    const [a, b] = A < newGearId ? [A, newGearId] : [newGearId, A];
    expect(layout.meshes).toContainEqual({ a, b, source: 'tree', kind: 'spur' });
    const ca = layout.gears[A]?.center;
    const cb = layout.gears[newGearId]?.center;
    if (ca === undefined || cb === undefined) throw new Error('レイアウトに無い');
    expect(distance(ca, cb)).toBeCloseTo(40, 6);
    expect(layout.interferences).toEqual([]);

    expect(await getSelection(page)).toEqual([newGearId]);
    // 候補は新しい歯車のもの（外周の候補は新しい歯車の中心から 40 の距離）
    const next = await getCandidates(page);
    const perimeter = next.filter((c) => c.kind === 'perimeter');
    expect(perimeter.length).toBeGreaterThanOrEqual(1);
    for (const c of perimeter) expect(distance(c.center, cb)).toBeCloseTo(40, 6);

    await page.keyboard.press('Control+z');
    const undone = await getScene(page);
    expect(Object.keys(undone.gears)).toHaveLength(1);
    expect(Object.keys(undone.shafts)).toHaveLength(1);
  });

  test("パレットで「大」を選び、A の 'coaxial' の候補をクリック → A のシャフトに大・16 歯が通る", async ({
    page,
  }) => {
    await page.getByTestId('palette-size-L').click();
    await clickGear(page, A);
    await clickCandidate(page, 'coaxial');

    const scene = await getScene(page);
    expect(Object.keys(scene.shafts)).toEqual([A_SHAFT]);
    expect(Object.keys(scene.gears)).toHaveLength(2);
    const newGear = Object.values(scene.gears).find((g) => g.id !== A);
    if (newGear === undefined) throw new Error('増えていない');
    expect(newGear).toMatchObject({ shaftId: A_SHAFT, size: 'L', teeth: 16 });
    expect([-12, 8]).toContain(newGear.offset);
    expect((await getLayout(page)).interferences).toEqual([]);
    expect(await getSelection(page)).toEqual([newGear.id]);
  });

  test('外周の候補を 3 回続けてクリック → 4 枚の鎖になり、干渉が無い', async ({ page }) => {
    await clickGear(page, A);
    for (let i = 0; i < 3; i++) {
      const before = (await getSelection(page))?.[0];
      await clickCandidate(page, 'perimeter');
      const scene = await getScene(page);
      const selected = (await getSelection(page))?.[0];
      if (selected === undefined || before === undefined) throw new Error('選択が無い');
      expect(selected).not.toBe(before);
      // 新しく選ばれた歯車は、前に選んでいた歯車の外周に生えた
      const shaftId = scene.gears[selected]?.shaftId;
      if (shaftId === undefined) throw new Error('歯車が無い');
      expect(scene.shafts[shaftId]?.placement).toMatchObject({
        kind: 'mesh',
        parentGearId: before,
        childGearId: selected,
      });
    }
    const scene = await getScene(page);
    expect(Object.keys(scene.gears)).toHaveLength(4);
    expect(Object.keys(scene.shafts)).toHaveLength(4);
    const layout = await getLayout(page);
    expect(layout.meshes.filter((m) => m.source === 'tree')).toHaveLength(3);
    expect(layout.interferences).toEqual([]);
  });

  test('候補の上で左ドラッグ → 歯車は増えず、カメラが回る', async ({ page }) => {
    await clickGear(page, A);
    const { x, y } = await candidatePoint(page, 'perimeter');
    const before = await page.evaluate(() => window.__gearSim?.getCamera());
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 10, { steps: 10 });
    await page.mouse.up();
    const after = await page.evaluate(() => window.__gearSim?.getCamera());
    expect(after).not.toEqual(before);
    expect(Object.keys((await getScene(page)).gears)).toHaveLength(1);
    expect(await getSelection(page)).toEqual([A]);
  });
});

test('one-root-motor.json で外周に 1 つ生やす → 新しいシャフトの ω は A のシャフトの −1 倍', async ({
  page,
}) => {
  await open(page, oneRootMotor);
  await clickGear(page, A);
  await clickCandidate(page, 'perimeter');
  const scene = await getScene(page);
  const newShaftId = Object.keys(scene.shafts).find((id) => id !== A_SHAFT);
  if (newShaftId === undefined) throw new Error('増えていない');
  const omegas = await page.evaluate(() => window.__gearSim?.getMotion().omegas);
  if (omegas === undefined) throw new Error('__gearSim が無い');
  expect(omegas[A_SHAFT]).toBeCloseTo(Math.PI, 6);
  expect(omegas[newShaftId]).toBeCloseTo(-Math.PI, 6);
});
