import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { HandConstraint, MotionState } from '../src/core/kinematics/types';
import type { Layout } from '../src/core/layout/types';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import type { CameraPose } from '../src/input/camera';
import { expect, test } from './fixtures/test';

// S1-21: 手で回す

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

// 縦軸の起点 A（shaft_1・gear_1）と外周の B（shaft_2・gear_2）。どれも中・20 歯、モーター無し
const twoGears = fixture('two-gears');
// two-gears の両方のシャフトに小のモーター（60 rpm、direction 1）。stalemate のロック
const lockOpposed = fixture('lock-opposed');
// 縦軸の起点 A（中・20 歯、小のモーター）の外周に B（angle 0）と C（angle π/3）。contradiction のロック
const lockTriangle = fixture('lock-triangle');
// 縦軸の起点 A（shaft_a・gear_a、中・20 歯）に中のモーター（30 rpm、direction 1）
const oneRootMotor = fixture('one-root-motor');

// 上から見下ろす視点
const TOP_VIEW = { position: [0, 400, 0.001] as Vec3, target: [0, 0, 0] as Vec3 };
// 経路の半径（mm）と段数
const PATH_RADIUS = 15;
const PATH_STEPS = 10;
const ANGLE_EPS = 0.05;

type Point = { x: number; y: number };

async function open(page: Page, scene: Scene): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
  await page.evaluate((pose) => window.__gearSim?.setCamera(pose), TOP_VIEW);
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

async function getCamera(page: Page): Promise<CameraPose> {
  const pose = await page.evaluate(() => window.__gearSim?.getCamera());
  if (pose === undefined) throw new Error('__gearSim が無い');
  return pose;
}

async function getHand(page: Page): Promise<HandConstraint | null> {
  const hand = await page.evaluate(() => window.__gearSim?.getHand());
  if (hand === undefined) throw new Error('__gearSim が無い');
  return hand;
}

async function getSelection(page: Page): Promise<string[]> {
  const selection = await page.evaluate(() => window.__gearSim?.getSelection());
  if (selection === undefined) throw new Error('__gearSim が無い');
  return selection;
}

async function angleOf(page: Page, shaftId: string): Promise<number> {
  return (await getMotion(page)).angles[shaftId] ?? Number.NaN;
}

// 歯車の中心 c から半径 15 の、面上の点 c + [15cos φ, 0, 15sin φ] の画面上の位置
async function pathPoint(page: Page, gearId: string, phi: number): Promise<Point> {
  const center = (await getLayout(page)).gears[gearId]?.center;
  if (center === undefined) throw new Error(`${gearId} が無い`);
  const world: Vec3 = [
    center[0] + PATH_RADIUS * Math.cos(phi),
    center[1],
    center[2] + PATH_RADIUS * Math.sin(phi),
  ];
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

// 経路（φ = 0 → π/2 を PATH_STEPS 段）の画面上の点。押す前に求めておく（回すとカメラ以外は変わらないが、
// 押している間に page.evaluate を挟まないため）
async function pathPoints(page: Page, gearId: string): Promise<Point[]> {
  const points: Point[] = [];
  for (let i = 0; i <= PATH_STEPS; i++) {
    points.push(await pathPoint(page, gearId, (Math.PI / 2) * (i / PATH_STEPS)));
  }
  return points;
}

// 経路の φ = 0 で押し、upTo 段まで動かす（離さない）
async function pressAndTurn(page: Page, gearId: string, upTo = PATH_STEPS): Promise<void> {
  const [start, ...rest] = await pathPoints(page, gearId);
  if (start === undefined) throw new Error('経路が空');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of rest.slice(0, upTo)) await page.mouse.move(p.x, p.y);
}

async function nextFrames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

test('経路をドラッグして離す → A は −π/2、B は +π/2 回る。カメラと選択は変わらない', async ({
  page,
}) => {
  await open(page, twoGears);
  const camera = await getCamera(page);
  const a0 = await angleOf(page, 'shaft_1');
  const b0 = await angleOf(page, 'shaft_2');
  await pressAndTurn(page, 'gear_1');
  await page.mouse.up();
  await nextFrames(page);
  expect(Math.abs((await angleOf(page, 'shaft_1')) - a0 + Math.PI / 2)).toBeLessThan(ANGLE_EPS);
  expect(Math.abs((await angleOf(page, 'shaft_2')) - b0 - Math.PI / 2)).toBeLessThan(ANGLE_EPS);
  expect(await getCamera(page)).toEqual(camera);
  expect(await getSelection(page)).toEqual([]);
});

test('φ = π/4 で止める → A の角度の変化が −π/4 に追従し、getHand が A。離すと null', async ({
  page,
}) => {
  await open(page, twoGears);
  const a0 = await angleOf(page, 'shaft_1');
  await pressAndTurn(page, 'gear_1', PATH_STEPS / 2);
  await expect
    .poll(async () => Math.abs((await angleOf(page, 'shaft_1')) - a0 + Math.PI / 4))
    .toBeLessThan(ANGLE_EPS);
  expect((await getHand(page))?.shaftId).toBe('shaft_1');
  await page.mouse.up();
  expect(await getHand(page)).toBe(null);
});

test('離した後、ω は 0（モーター無し）で、角度は離したときのまま', async ({ page }) => {
  await open(page, twoGears);
  await pressAndTurn(page, 'gear_1');
  await page.mouse.up();
  await nextFrames(page);
  const released = await getMotion(page);
  await nextFrames(page, 5);
  const later = await getMotion(page);
  expect(later.omegas).toEqual({ shaft_1: 0, shaft_2: 0 });
  expect(later.angles.shaft_1).toBeCloseTo(released.angles.shaft_1 ?? Number.NaN, 9);
  expect(later.angles.shaft_2).toBeCloseTo(released.angles.shaft_2 ?? Number.NaN, 9);
});

test('動かさずにクリック → A が選ばれ、角度は変わらない', async ({ page }) => {
  await open(page, twoGears);
  const a0 = await angleOf(page, 'shaft_1');
  const p = await pathPoint(page, 'gear_1', 0);
  await page.mouse.click(p.x, p.y);
  await nextFrames(page);
  expect(await getSelection(page)).toEqual(['gear_1']);
  expect(await angleOf(page, 'shaft_1')).toBe(a0);
  expect(await getHand(page)).toBe(null);
});

test('Alt を押しながら同じ経路 → 角度は変わらず、カメラが変わる', async ({ page }) => {
  await open(page, twoGears);
  const camera = await getCamera(page);
  const a0 = await angleOf(page, 'shaft_1');
  const [start, ...rest] = await pathPoints(page, 'gear_1');
  if (start === undefined) throw new Error('経路が空');
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await nextFrames(page);
  expect(await angleOf(page, 'shaft_1')).toBe(a0);
  expect(await getCamera(page)).not.toEqual(camera);
});

test('回している最中の Esc → 回すのを終え、選択は外さない', async ({ page }) => {
  await open(page, twoGears);
  await page.evaluate(() => window.__gearSim?.select('gear_2'));
  const points = await pathPoints(page, 'gear_1');
  await pressAndTurn(page, 'gear_1', PATH_STEPS / 2);
  expect((await getHand(page))?.shaftId).toBe('shaft_1');
  await page.keyboard.press('Escape');
  expect(await getHand(page)).toBe(null);
  expect(await getSelection(page)).toEqual(['gear_2']);
  // 離すまでポインターを動かしても、もう回らない
  await nextFrames(page);
  const a = await angleOf(page, 'shaft_1');
  const end = points[PATH_STEPS];
  if (end === undefined) throw new Error('経路が短い');
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await nextFrames(page);
  expect(await angleOf(page, 'shaft_1')).toBe(a);
});

test('lock-opposed: stalemate → つかんでいる間は回ってロックが外れ、離すと戻って ω が 0', async ({
  page,
}) => {
  await open(page, lockOpposed);
  expect((await getMotion(page)).locks.map((l) => l.reason)).toEqual(['stalemate']);
  const a0 = await angleOf(page, 'shaft_1');
  await pressAndTurn(page, 'gear_1');
  await nextFrames(page);
  const held = await getMotion(page);
  expect(Math.abs((held.angles.shaft_1 ?? a0) - a0 + Math.PI / 2)).toBeLessThan(ANGLE_EPS);
  expect(held.locks).toEqual([]);
  await page.mouse.up();
  await nextFrames(page);
  const released = await getMotion(page);
  expect(released.locks.map((l) => l.reason)).toEqual(['stalemate']);
  expect(released.omegas).toEqual({ shaft_1: 0, shaft_2: 0 });
});

test('one-root-motor: モーターと逆向きに回す → 回している間 backDriven、離すと ω が π', async ({
  page,
}) => {
  await open(page, oneRootMotor);
  // 毎フレームの backDriven を集める（回している間の 1 フレームでも入ればよい）
  await page.evaluate(() => {
    const w = window as unknown as { __backDriven: string[][] };
    w.__backDriven = [];
    const tick = (): void => {
      const m = window.__gearSim?.getMotion();
      if (m !== undefined) w.__backDriven.push([...m.backDriven]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // +X から +Z へ（+Y 軸まわりの負の向き）。モーターは direction 1（正の向き）
  await pressAndTurn(page, 'gear_a');
  const samples = await page.evaluate(
    () => (window as unknown as { __backDriven: string[][] }).__backDriven,
  );
  expect(samples.some((b) => b.includes('motor_a'))).toBe(true);
  await page.mouse.up();
  await nextFrames(page);
  const released = await getMotion(page);
  expect(released.omegas.shaft_a).toBeCloseTo(Math.PI, 6);
  expect(released.backDriven).toEqual([]);
});

test('lock-triangle: contradiction → ドラッグしても角度もカメラも変わらない', async ({ page }) => {
  await open(page, lockTriangle);
  const before = await getMotion(page);
  expect(before.locks).toEqual([
    expect.objectContaining({
      reason: 'contradiction',
      shaftIds: ['shaft_1', 'shaft_2', 'shaft_3'],
    }),
  ]);
  const camera = await getCamera(page);
  await pressAndTurn(page, 'gear_1');
  await nextFrames(page);
  const held = await getMotion(page);
  expect(held.angles).toEqual(before.angles);
  expect(held.locks.map((l) => l.reason)).toEqual(['contradiction']);
  await page.mouse.up();
  await nextFrames(page);
  expect((await getMotion(page)).angles).toEqual(before.angles);
  expect(await getCamera(page)).toEqual(camera);
});
