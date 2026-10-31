import type { Vec3 } from '../src/core/math/vec3';
import {
  clickGear,
  fixtureScene,
  gearPoint,
  getCandidates,
  getLayout,
  getMotion,
  getScene,
  nextFrames,
  openApp,
  project,
  selectPaletteKind,
  settleCamera,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S2-03: ウォームギア。worm-basic は横 X のウォーム W（中、中心 [16, 80, 0]、モーター 60 rpm）と、
// その skew の子のホイール H（中・30 歯、軸 z、中心 [16, 40, 0]）。worm-backdrive はモーターを H のシャフトに付けたもの
const wormBasic = fixtureScene('worm-basic');
const wormBackdrive = fixtureScene('worm-backdrive');

// H の面（+z の側）を正面から見る
const FRONT = { position: [16, 60, 260] as Vec3, target: [16, 60, 0] as Vec3 };

test('worm-basic → H のシャフトの ω が 2π/30、ロックなし', async ({ page }) => {
  await openApp(page, { scene: wormBasic });
  const layout = await getLayout(page);
  expect(layout.meshes).toEqual([{ a: 'gear_h', b: 'gear_w', source: 'tree', kind: 'worm' }]);
  expect(layout.interferences).toEqual([]);
  const motion = await getMotion(page);
  expect(motion.omegas.shaft_w).toBeCloseTo(2 * Math.PI, 6);
  expect(motion.omegas.shaft_h).toBeCloseTo((2 * Math.PI) / 30, 6);
  expect(motion.locks).toEqual([]);
});

test('worm-backdrive → locks に wormBackDrive', async ({ page }) => {
  await openApp(page, { scene: wormBackdrive });
  await expect
    .poll(async () => (await getMotion(page)).locks.map((l) => l.reason))
    .toContain('wormBackDrive');
  const motion = await getMotion(page);
  expect(motion.omegas).toEqual({ shaft_h: 0, shaft_w: 0 });
});

test('worm-basic で H の上を左ドラッグ → ドラッグ中は wormBackDrive のロック。離すと元の速度に戻る', async ({
  page,
}) => {
  await openApp(page, { scene: wormBasic, camera: FRONT });
  const center = (await getLayout(page)).gears.gear_h?.center;
  if (center === undefined) throw new Error('H が無い');
  // H の面の上の、半径 15 の円弧（W と反対側の下半分）を押して回す
  const points = [];
  for (let i = 0; i <= 8; i++) {
    const phi = -Math.PI / 4 - (Math.PI / 2) * (i / 8);
    points.push(
      await project(page, [center[0] + 15 * Math.cos(phi), center[1] + 15 * Math.sin(phi), 4]),
    );
  }
  const [start, ...rest] = points;
  if (start === undefined) throw new Error('経路が空');
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), start);
  expect(hit).toMatchObject({ kind: 'gear', id: 'gear_h' });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y);
  await nextFrames(page);
  expect((await page.evaluate(() => window.__gearSim?.getHand()))?.shaftId).toBe('shaft_h');
  const during = await getMotion(page);
  expect(during.locks.map((l) => l.reason)).toEqual(['wormBackDrive']);
  expect(during.omegas).toEqual({ shaft_h: 0, shaft_w: 0 });

  await page.mouse.up();
  await expect.poll(async () => (await getMotion(page)).locks).toEqual([]);
  const after = await getMotion(page);
  expect(after.omegas.shaft_w).toBeCloseTo(2 * Math.PI, 6);
  expect(after.omegas.shaft_h).toBeCloseTo((2 * Math.PI) / 30, 6);
});

test('W を選ぶ → ホイールの候補（skew）。1 つをクリック → skew のシャフトにホイールが生え、干渉なし。Ctrl+Z で消える', async ({
  page,
}) => {
  await openApp(page, { scene: wormBasic });
  await selectPaletteKind(page, 'wormWheel');
  await page.keyboard.press('Home');
  // Home のカメラの移動が終わってから押す（動いている間に押す点を求めると外れることがある）
  await settleCamera(page);
  await clickGear(page, 'gear_w');
  const skews = (await getCandidates(page)).filter((c) => c.kind === 'skew');
  expect(skews.length).toBeGreaterThanOrEqual(1);
  expect(skews.length).toBeLessThanOrEqual(4);
  expect((await getCandidates(page)).some((c) => c.kind === 'perimeter')).toBe(false);

  let target: { x: number; y: number } | null = null;
  for (const candidate of skews) {
    const p = await project(page, candidate.center);
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind === 'candidate' && hit.id === String(candidate.index)) {
      target = p;
      break;
    }
  }
  if (target === null) throw new Error('押せるホイールの候補が無い');

  const before = await getScene(page);
  await page.mouse.click(target.x, target.y);
  const after = await getScene(page);
  const added = Object.keys(after.gears).filter((id) => before.gears[id] === undefined);
  expect(added).toHaveLength(1);
  const gear = after.gears[added[0] ?? ''];
  expect(gear?.kind).toBe('wormWheel');
  expect(after.shafts[gear?.shaftId ?? '']?.placement.kind).toBe('skew');
  expect((await getLayout(page)).interferences).toEqual([]);

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => Object.keys((await getScene(page)).shafts).sort())
    .toEqual(['shaft_h', 'shaft_w']);
});

test('H を選ぶ → ウォームの候補（skew）が出る', async ({ page }) => {
  await openApp(page, { scene: wormBasic, camera: FRONT });
  await selectPaletteKind(page, 'worm');
  const p = await gearPoint(page, 'gear_h');
  await page.mouse.click(p.x, p.y);
  const skews = (await getCandidates(page)).filter((c) => c.kind === 'skew');
  expect(skews.length).toBeGreaterThanOrEqual(1);
});
