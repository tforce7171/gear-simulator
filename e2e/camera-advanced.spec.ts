import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import type { CameraPose } from '../src/input/camera';
import { expect, test } from './fixtures/test';

const twoGears = JSON.parse(
  readFileSync(new URL('./fixtures/two-gears.json', import.meta.url), 'utf8'),
) as Scene;

// 決まった視点。歯車 2 枚（中心 [0, 4, 0] と [0, 4, 40]）を斜め上から見る
const VIEW = { position: [0, 250, 250] as Vec3, target: [0, 0, 20] as Vec3 };
const GEAR_CENTERS = [
  [0, 4, 0],
  [0, 4, 40],
] as const satisfies readonly Vec3[];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function dist(a: Vec3, b: Vec3): number {
  return len(sub(a, b));
}

function cameraDistance(pose: CameraPose): number {
  return dist(pose.position, pose.target);
}

// position − target を正規化したもの
function viewDir(pose: CameraPose): Vec3 {
  const d = sub(pose.position, pose.target);
  const l = len(d);
  return [d[0] / l, d[1] / l, d[2] / l];
}

// XZ 平面上の、注視点から見たカメラの方位角
function azimuth(pose: CameraPose): number {
  const d = sub(pose.position, pose.target);
  return Math.atan2(d[0], d[2]);
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

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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

interface WheelInit {
  deltaX?: number;
  deltaY?: number;
  ctrlKey?: boolean;
}

// トラックパッドの入力を、canvas の中央への WheelEvent として送る
async function sendWheel(page: Page, init: WheelInit, times = 1): Promise<void> {
  const at = await canvasCenter(page);
  await page.evaluate(
    ({ init, times, at }) => {
      const canvas = document.querySelector('canvas');
      if (canvas === null) throw new Error('canvas が無い');
      for (let i = 0; i < times; i++) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: init.deltaX ?? 0,
            deltaY: init.deltaY ?? 0,
            deltaMode: 0,
            ctrlKey: init.ctrlKey ?? false,
            clientX: at.x,
            clientY: at.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { init, times, at },
  );
}

function expectDirClose(actual: Vec3, expected: Vec3): void {
  expect(dist(actual, expected)).toBeLessThan(1e-3);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((scene) => window.__gearSim?.loadScene(scene), twoGears);
  await page.evaluate((p) => window.__gearSim?.setCamera(p), VIEW);
});

test('トラックパッドの 2 本指スクロール → trackpad と判別し、平行移動する（距離は変わらない）', async ({
  page,
}) => {
  await sendWheel(page, { deltaX: 3.5, deltaY: 7.25 }, 5);
  expect(await page.evaluate(() => window.__gearSim?.getInputDevice())).toBe('trackpad');
  const pose = await settledCamera(page);
  expect(dist(pose.target, VIEW.target)).toBeGreaterThan(1);
  expect(cameraDistance(pose)).toBeCloseTo(dist(VIEW.position, VIEW.target), 3);
  // 平行移動なので、position も target と同じだけ動く
  expect(dist(sub(pose.position, VIEW.position), sub(pose.target, VIEW.target))).toBeLessThan(1e-3);
});

test('ピンチ（ctrlKey 付き、deltaY −20）→ 距離が縮む', async ({ page }) => {
  await sendWheel(page, { ctrlKey: true, deltaY: -20 });
  const pose = await settledCamera(page);
  expect(cameraDistance(pose)).toBeLessThan(dist(VIEW.position, VIEW.target) - 1);
});

test("trackpadScroll 'orbit' → 2 本指スクロールで回転する（target は変わらず position が変わる）", async ({
  page,
}) => {
  await page.evaluate(() => window.__gearSim?.updateSettings({ trackpadScroll: 'orbit' }));
  await sendWheel(page, { deltaX: 3.5, deltaY: 7.25 }, 5);
  const pose = await settledCamera(page);
  expect(dist(pose.target, VIEW.target)).toBeLessThan(1e-3);
  expect(dist(pose.position, VIEW.position)).toBeGreaterThan(1);
  expect(cameraDistance(pose)).toBeCloseTo(dist(VIEW.position, VIEW.target), 3);
});

test("inputDevice 'mouse' に固定 → 同じスクロールでもマウスとして扱い、ズームする", async ({
  page,
}) => {
  await page.evaluate(() => window.__gearSim?.updateSettings({ inputDevice: 'mouse' }));
  await sendWheel(page, { deltaX: 3.5, deltaY: 7.25 }, 5);
  expect(await page.evaluate(() => window.__gearSim?.getInputDevice())).toBe('mouse');
  const pose = await settledCamera(page);
  expect(Math.abs(cameraDistance(pose) - dist(VIEW.position, VIEW.target))).toBeGreaterThan(1);
});

test('マウスのホイール → mouse と判別し、距離が増える', async ({ page }) => {
  const at = await canvasCenter(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => window.__gearSim?.getInputDevice())).toBe('mouse');
  const pose = await settledCamera(page);
  expect(cameraDistance(pose)).toBeGreaterThan(dist(VIEW.position, VIEW.target) + 1);
});

test('テンキー 7 → 上から見る。距離は押す前と同じ', async ({ page }) => {
  await page.keyboard.press('Numpad7');
  const pose = await settledCamera(page);
  expectDirClose(viewDir(pose), [0, 1, 0]);
  expect(cameraDistance(pose)).toBeCloseTo(dist(VIEW.position, VIEW.target), 3);
  expect(dist(pose.target, VIEW.target)).toBeLessThan(1e-3);
  // 画面の右が +X、上が −Z
  const center = await project(page, VIEW.target);
  const plusX = await project(page, [10, 0, 20]);
  const minusZ = await project(page, [0, 0, 10]);
  expect(plusX.x).toBeGreaterThan(center.x + 5);
  expect(minusZ.y).toBeLessThan(center.y - 5);
});

test('Ctrl+テンキー 7 → 下から見る（画面の上が +Z）', async ({ page }) => {
  await page.keyboard.press('Control+Numpad7');
  const pose = await settledCamera(page);
  expectDirClose(viewDir(pose), [0, -1, 0]);
  const center = await project(page, VIEW.target);
  const plusX = await project(page, [10, 0, 20]);
  const plusZ = await project(page, [0, 0, 30]);
  expect(plusX.x).toBeGreaterThan(center.x + 5);
  expect(plusZ.y).toBeLessThan(center.y - 5);
});

test('Mac の Cmd（Meta）も Ctrl と同じ: Meta+テンキー 3 → 左（−X 側）から見る', async ({
  page,
}) => {
  await page.keyboard.press('Meta+Numpad3');
  const pose = await settledCamera(page);
  expectDirClose(viewDir(pose), [-1, 0, 0]);
});

test('Ctrl+テンキー 1 → 後ろ（−Z 側）から見る', async ({ page }) => {
  await page.keyboard.press('Control+Numpad1');
  const pose = await settledCamera(page);
  expectDirClose(viewDir(pose), [0, 0, -1]);
  expect(cameraDistance(pose)).toBeCloseTo(dist(VIEW.position, VIEW.target), 3);
});

test('軸の目印の +X の球をクリック → 右（+X 側）から見る', async ({ page }) => {
  const targets = await page.evaluate(() => window.__gearSim?.getGizmoTargets());
  expect(targets).toHaveLength(6);
  const right = targets?.find((t) => t.view === 'right');
  if (right === undefined) throw new Error('right の球が無い');
  await page.mouse.click(right.x, right.y);
  const pose = await settledCamera(page);
  expectDirClose(viewDir(pose), [1, 0, 0]);
  expect(cameraDistance(pose)).toBeCloseTo(dist(VIEW.position, VIEW.target), 3);
});

test('テンキー 5 → 平行投影。歯車の中心の間隔は 10% 以内。もう一度で透視投影に戻る', async ({
  page,
}) => {
  async function spacing(): Promise<number> {
    const a = await project(page, GEAR_CENTERS[0]);
    const b = await project(page, GEAR_CENTERS[1]);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  const before = await spacing();
  expect(before).toBeGreaterThan(10);
  await page.keyboard.press('Numpad5');
  await expect.poll(async () => (await getCamera(page)).projection).toBe('orthographic');
  const ortho = await spacing();
  expect(Math.abs(ortho - before) / before).toBeLessThan(0.1);
  await page.keyboard.press('Numpad5');
  await expect.poll(async () => (await getCamera(page)).projection).toBe('perspective');
  const back = await spacing();
  expect(Math.abs(back - before) / before).toBeLessThan(0.01);
});

test('眺めるモード → 方位角だけが変わる。OFF にすると止まる', async ({ page }) => {
  const before = await getCamera(page);
  await page.evaluate(() => window.__gearSim?.setWatchMode(true));
  await page.waitForTimeout(1000);
  const watching = await getCamera(page);
  expect(Math.abs(azimuth(watching) - azimuth(before))).toBeGreaterThan(0.01);
  expect(dist(watching.target, before.target)).toBeLessThan(1e-3);
  expect(cameraDistance(watching)).toBeCloseTo(cameraDistance(before), 3);
  expect(watching.position[1]).toBeCloseTo(before.position[1], 3);

  await page.evaluate(() => window.__gearSim?.setWatchMode(false));
  const stopped = await getCamera(page);
  await page.waitForTimeout(500);
  const later = await getCamera(page);
  expect(azimuth(later)).toBeCloseTo(azimuth(stopped), 6);
});
