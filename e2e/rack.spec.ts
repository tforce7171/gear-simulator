import type { Page } from '@playwright/test';
import { add, scale, type Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import {
  clickGear,
  fixtureScene,
  getCandidates,
  getLayout,
  getMotion,
  getScene,
  nextFrames,
  openApp,
  project,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S3-04: ラック＆ピニオン。rack-basic は横 Z の起点のシャフト shaft_p（原点 [0, 60, 0]）に中・20 歯のピニオン gear_p
// （中心 [0, 60, 4]）とモーター 中（60 rpm、正の向き、ON）。gear_p にラック rack_r（中・30 歯、direction x、normal y、
// 歯が上向きで P の下。基準位置 [0, 40, 4]）。r = 20、L = 60π、s の範囲 [−28π, 28π]
const rackBasic = fixtureScene('rack-basic');
const R = 'rack_r';

// 正面（+z の側）から見る
const VIEW = { position: [0, 55, 260] as Vec3, target: [0, 50, 4] as Vec3 };

// ラックの本体の上で、pick がラックを返す点（今の変位 s の位置の、背の側 = ピッチ線から 5 mm 下、正面の面の手前）
async function rackPoint(page: Page, along = 0): Promise<{ x: number; y: number }> {
  const layout = await getLayout(page);
  const motion = await getMotion(page);
  const placed = layout.racks[R];
  if (placed === undefined) throw new Error('ラックがレイアウトに無い');
  const s = motion.rackPositions[R] ?? 0;
  const at = add(add(placed.origin, [s + along, 0, 0]), scale([0, 1, 0], -5));
  const p = await project(page, [at[0], at[1], at[2] + 4]);
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
  expect(hit?.kind).toBe('rack');
  return p;
}

test('rack-basic → rackVelocities[R] が 40π', async ({ page }) => {
  await openApp(page, { scene: rackBasic, camera: VIEW });
  const motion = await getMotion(page);
  expect(motion.rackVelocities[R]).toBeCloseTo(40 * Math.PI, 6);
  expect(motion.omegas.shaft_p).toBeCloseTo(2 * Math.PI, 6);
  expect((await getLayout(page)).interferences).toEqual([]);
});

test('1.2 秒待つ → rackPositions[R] が 28π、locks に rackEnd', async ({ page }) => {
  await openApp(page, { scene: rackBasic, camera: VIEW });
  await page.waitForTimeout(1200);
  // 遅いフレームでは 1 フレームの dt が 0.1 秒で頭打ちになり、実時間より遅れるので、端に届くまで待つ
  await expect
    .poll(async () => (await getMotion(page)).locks.map((l) => l.reason), { timeout: 15_000 })
    .toEqual(['rackEnd']);
  const motion = await getMotion(page);
  expect(motion.rackPositions[R]).toBeCloseTo(28 * Math.PI, 3);
  expect(motion.rackVelocities[R]).toBe(0);
  expect(motion.omegas.shaft_p).toBe(0);
  // ロックの表示（赤く震える）にラックも入る
  const warnings = await page.evaluate(() => window.__gearSim?.getWarningParts());
  expect(warnings?.locked).toContain(R);
  expect(warnings?.locked).toContain('gear_p');
});

test('端で P を選び、プロパティでモーターの向きを逆に → locks が空、rackVelocities[R] が負', async ({
  page,
}) => {
  await openApp(page, { scene: rackBasic, camera: VIEW });
  await expect
    .poll(async () => (await getMotion(page)).locks.map((l) => l.reason), { timeout: 15_000 })
    .toEqual(['rackEnd']);
  await clickGear(page, 'gear_p');
  await page.getByTestId('prop-motor-direction').click();
  await expect.poll(async () => (await getScene(page)).motors.motor_p?.direction).toBe(-1);
  const motion = await getMotion(page);
  expect(motion.locks).toEqual([]);
  expect(motion.rackVelocities[R]).toBeLessThan(0);
  await nextFrames(page);
  expect((await getMotion(page)).rackPositions[R]).toBeLessThan(28 * Math.PI);
});

test('モーターを OFF にして R を direction に沿ってドラッグ → rackPositions[R] と P のシャフトの角度が変わる', async ({
  page,
}) => {
  await openApp(page, { scene: rackBasic, camera: VIEW });
  await clickGear(page, 'gear_p');
  await page.getByTestId('prop-motor-on').click();
  await expect.poll(async () => (await getScene(page)).motors.motor_p?.on).toBe(false);
  await nextFrames(page);
  const before = await getMotion(page);
  const start = await rackPoint(page);
  const end = await project(page, [(before.rackPositions[R] ?? 0) + 30, 35, 8]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * i) / steps,
      start.y + ((end.y - start.y) * i) / steps,
    );
    await nextFrames(page, 1);
  }
  await nextFrames(page);
  const during = await getMotion(page);
  await page.mouse.up();
  const ds = (during.rackPositions[R] ?? 0) - (before.rackPositions[R] ?? 0);
  expect(ds).toBeGreaterThan(20);
  expect(ds).toBeLessThan(40);
  // s = r·θ（k = 1、r = 20）
  const dθ = (during.angles.shaft_p ?? 0) - (before.angles.shaft_p ?? 0);
  expect(dθ).toBeCloseTo(ds / 20, 3);
});

test('平歯車を選ぶとラックの候補が 4 つ出て、クリックでかみ合う位置にラックが置かれる', async ({
  page,
}) => {
  const noRack = { ...rackBasic, racks: {} };
  const motorOff = {
    ...noRack,
    motors: { motor_p: { ...(rackBasic.motors.motor_p as Scene['motors'][string]), on: false } },
  };
  await openApp(page, { scene: motorOff, camera: VIEW });
  await clickGear(page, 'gear_p');
  const racks = (await getCandidates(page)).filter((c) => c.kind === 'rack');
  expect(racks).toHaveLength(4);
  // P の下（基準位置 [0, 40, 4]）の候補を、背の側（ピッチ線から 5 mm 下）で押す
  const below = racks.find(
    (c) => Math.abs(c.center[1] - 40) < 1e-6 && Math.abs(c.center[0]) < 1e-6,
  );
  if (below === undefined) throw new Error('P の下のラックの候補が無い');
  const p = await project(page, [60, 35, 8]); // 外周の候補（歯先円の半径 22）から外れた所
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
  expect(hit).toEqual(expect.objectContaining({ kind: 'candidate', id: String(below.index) }));
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => Object.keys((await getScene(page)).racks)).toHaveLength(1);
  const layout = await getLayout(page);
  expect(layout.rackMeshes).toHaveLength(1);
  expect(layout.rackMeshes[0]?.gear).toBe('gear_p');
  expect(layout.interferences).toEqual([]);
  // 置いたラックが選ばれ、2 つ目のピニオンの候補（ラックの上の 2 か所）が出る
  const selection = await page.evaluate(() => window.__gearSim?.getSelection());
  expect(selection).toEqual([layout.rackMeshes[0]?.rack]);
  const pinions = (await getCandidates(page)).filter((c) => c.kind === 'rackPinion');
  expect(pinions).toHaveLength(2);
});

test('ラックを選んでプロパティで固定する → P が回らず anchor のロック', async ({ page }) => {
  await openApp(page, { scene: rackBasic, camera: VIEW });
  const p = await rackPoint(page, 30);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => page.evaluate(() => window.__gearSim?.getSelection())).toEqual([R]);
  await expect(page.getByTestId('prop-heading')).toHaveText(/ラック|Rack/);
  await page.getByTestId('prop-anchor-check').check();
  await expect.poll(async () => Object.values((await getScene(page)).anchors).length).toBe(1);
  const motion = await getMotion(page);
  expect(motion.omegas.shaft_p).toBe(0);
  expect(motion.rackVelocities[R]).toBe(0);
  expect(motion.locks.map((l) => l.reason)).toEqual(['anchor']);
});
