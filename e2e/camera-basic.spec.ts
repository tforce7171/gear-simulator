import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import type { CameraPose } from '../src/input/camera';
import { settledCamera } from './fixtures/sim';
import { expect, test } from './fixtures/test';

const twoGears = JSON.parse(
  readFileSync(new URL('./fixtures/two-gears.json', import.meta.url), 'utf8'),
) as Scene;

// 決まった視点。歯車 2 枚（中心 [0, 4, 0] と [0, 4, 40]）を斜め上から見る
const VIEW = { position: [0, 250, 250] as Vec3, target: [0, 0, 20] as Vec3 };
// 部品から十分離れた床の点（「何もない所」）
const EMPTY_FLOOR: Vec3 = [70, 0, 20];
const TIP_RADIUS = 22; // 中・20 歯の歯先円半径
const GEAR_CENTERS: readonly Vec3[] = [
  [0, 4, 0],
  [0, 4, 40],
];

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function getCamera(page: Page): Promise<CameraPose> {
  const pose = await page.evaluate(() => window.__gearSim?.getCamera());
  if (pose === undefined) throw new Error('__gearSim が無い');
  return pose;
}

async function setCamera(page: Page, pose: { position: Vec3; target: Vec3 }): Promise<void> {
  await page.evaluate((p) => window.__gearSim?.setCamera(p), pose);
}

async function project(page: Page, world: Vec3): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

// 描画領域（canvas）の範囲。S1-15 からパネルとツールバーの分だけページより小さい
async function canvasBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  return box;
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  button: 'left' | 'middle' | 'right',
  dx = 100,
  dy = 0,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up({ button });
}

function expectVecClose(actual: Vec3, expected: Vec3, eps = 1e-3): void {
  expect(dist(actual, expected)).toBeLessThan(eps);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((scene) => window.__gearSim?.loadScene(scene), twoGears);
  await setCamera(page, VIEW);
});

test('決まった視点で、何もない所の床の点が画面の内側に写る', async ({ page }) => {
  const pose = await getCamera(page);
  expectVecClose(pose.position, VIEW.position);
  expectVecClose(pose.target, VIEW.target);
  expect(pose.projection).toBe('perspective');
  const p = await project(page, EMPTY_FLOOR);
  const box = await canvasBox(page);
  expect(p.x).toBeGreaterThan(box.x);
  expect(p.x).toBeLessThan(box.x + box.width);
  expect(p.y).toBeGreaterThan(box.y);
  expect(p.y).toBeLessThan(box.y + box.height);
});

test('何もない所で左ドラッグ → 回転する（position が変わり、target は変わらない）', async ({
  page,
}) => {
  await drag(page, await project(page, EMPTY_FLOOR), 'left');
  const pose = await settledCamera(page);
  expect(dist(pose.position, VIEW.position)).toBeGreaterThan(1);
  expectVecClose(pose.target, VIEW.target);
  // 周回なので注視点からの距離は変わらない
  expect(dist(pose.position, pose.target)).toBeCloseTo(dist(VIEW.position, VIEW.target), 3);
});

test('右ドラッグ → 回転する。コンテキストメニューの要求は出ない', async ({ page }) => {
  await drag(page, await project(page, EMPTY_FLOOR), 'right');
  const pose = await settledCamera(page);
  expect(dist(pose.position, VIEW.position)).toBeGreaterThan(1);
  expectVecClose(pose.target, VIEW.target);
  expect(await page.evaluate(() => window.__gearSim?.getLastContextRequest())).toBeNull();
});

test('Alt+左ドラッグ → 回転する', async ({ page }) => {
  await page.keyboard.down('Alt');
  await drag(page, await project(page, EMPTY_FLOOR), 'left');
  await page.keyboard.up('Alt');
  const pose = await settledCamera(page);
  expect(dist(pose.position, VIEW.position)).toBeGreaterThan(1);
  expectVecClose(pose.target, VIEW.target);
});

// target と position が同じだけ動いたこと
async function expectPanned(page: Page): Promise<void> {
  const pose = await settledCamera(page);
  const moveT: Vec3 = [
    pose.target[0] - VIEW.target[0],
    pose.target[1] - VIEW.target[1],
    pose.target[2] - VIEW.target[2],
  ];
  const moveP: Vec3 = [
    pose.position[0] - VIEW.position[0],
    pose.position[1] - VIEW.position[1],
    pose.position[2] - VIEW.position[2],
  ];
  expect(Math.hypot(...moveT)).toBeGreaterThan(1);
  expectVecClose(moveP, moveT);
}

test('中ドラッグ → 平行移動する（target と position が同じだけ動く）', async ({ page }) => {
  await drag(page, await project(page, EMPTY_FLOOR), 'middle');
  await expectPanned(page);
});

test('Shift+右ドラッグ → 平行移動する', async ({ page }) => {
  await page.keyboard.down('Shift');
  await drag(page, await project(page, EMPTY_FLOOR), 'right');
  await page.keyboard.up('Shift');
  await expectPanned(page);
  expect(await page.evaluate(() => window.__gearSim?.getLastContextRequest())).toBeNull();
});

test('Space を押しながら左ドラッグ → 平行移動する', async ({ page }) => {
  await page.keyboard.down('Space');
  await drag(page, await project(page, EMPTY_FLOOR), 'left');
  await page.keyboard.up('Space');
  await expectPanned(page);
});

test('右クリック（動かさない）→ クリック位置のコンテキストメニューの要求。カメラは変わらない', async ({
  page,
}) => {
  // ブラウザ標準のメニューを出さない = contextmenu の既定の動作が止められている
  await page.evaluate(() => {
    const w = window as unknown as { __menuPrevented?: boolean[] };
    w.__menuPrevented = [];
    document.addEventListener('contextmenu', (e) => w.__menuPrevented?.push(e.defaultPrevented));
  });
  const at = await project(page, EMPTY_FLOOR);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const prevented = await page.evaluate(
    () => (window as unknown as { __menuPrevented?: boolean[] }).__menuPrevented,
  );
  expect(prevented).toEqual([true]);
  const request = await page.evaluate(() => window.__gearSim?.getLastContextRequest());
  expect(request).not.toBeNull();
  expect(request?.x).toBeCloseTo(at.x, 0);
  expect(request?.y).toBeCloseTo(at.y, 0);
  const pose = await settledCamera(page);
  expectVecClose(pose.position, VIEW.position);
  expectVecClose(pose.target, VIEW.target);
});

test('右上でホイール → 距離が縮み、target がカーソル側へ動く', async ({ page }) => {
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 200, cy - 150);
  await page.mouse.wheel(0, -300);
  const pose = await settledCamera(page);
  expect(dist(pose.position, pose.target)).toBeLessThan(dist(VIEW.position, VIEW.target) - 1);
  // 新しい注視点を元の視点で写すと、画面の中心からカーソルの側（右上）にずれている
  await setCamera(page, VIEW);
  const moved = await project(page, pose.target);
  expect(moved.x).toBeGreaterThan(cx + 10);
  expect(moved.y).toBeLessThan(cy - 10);
});

test('歯車の中心でダブルクリック → 歯車の中心へ寄り、距離が約半分になる', async ({ page }) => {
  const center = GEAR_CENTERS[0] as Vec3;
  const at = await project(page, center);
  await page.mouse.dblclick(at.x, at.y);
  const before = dist(VIEW.position, VIEW.target);
  await expect
    .poll(async () => {
      const pose = await getCamera(page);
      return dist(pose.position, pose.target) / before;
    })
    .toBeCloseTo(0.5, 2);
  const pose = await settledCamera(page);
  expect(dist(pose.target, center)).toBeLessThan(TIP_RADIUS);
  expect(dist(pose.position, pose.target) / before).toBeCloseTo(0.5, 2);
});

test('何にも当たらない所（空）でダブルクリック → 何もしない', async ({ page }) => {
  // 真横から見ると、画面の上半分は床にも当たらない
  const side = { position: [0, 4, 300] as Vec3, target: [0, 4, 20] as Vec3 };
  await setCamera(page, side);
  const box = await canvasBox(page);
  await page.mouse.dblclick(box.x + 20, box.y + 20);
  await page.waitForTimeout(300);
  const pose = await settledCamera(page);
  expectVecClose(pose.position, side.position);
  expectVecClose(pose.target, side.target);
});

// 遠くへ外した視点から fit した後、すべての歯車の中心が画面の内側に写ること
async function expectAllGearsVisible(page: Page): Promise<void> {
  const box = await canvasBox(page);
  for (const c of GEAR_CENTERS) {
    const p = await project(page, c);
    expect(p.x).toBeGreaterThan(box.x);
    expect(p.x).toBeLessThan(box.x + box.width);
    expect(p.y).toBeGreaterThan(box.y);
    expect(p.y).toBeLessThan(box.y + box.height);
  }
}

const AWAY = { position: [700, 80, -600] as Vec3, target: [600, 0, -500] as Vec3 };

test('歯車から外して遠くへ動かした視点で Home → すべての歯車が画面に入る', async ({ page }) => {
  await setCamera(page, AWAY);
  const box = await canvasBox(page);
  // 外した視点では、歯車の中心は画面の外か後ろにある
  const off = await project(page, GEAR_CENTERS[0] as Vec3);
  const visible =
    off.x > box.x && off.x < box.x + box.width && off.y > box.y && off.y < box.y + box.height;
  expect(visible).toBe(false);

  await page.keyboard.press('Home');
  await settledCamera(page);
  await expectAllGearsVisible(page);
});

test('選択なしで F → Home と同じ結果', async ({ page }) => {
  await setCamera(page, AWAY);
  await page.keyboard.press('Home');
  const home = await settledCamera(page);

  await setCamera(page, AWAY);
  await page.keyboard.press('f');
  const f = await settledCamera(page);
  expectVecClose(f.position, home.position, 0.01);
  expectVecClose(f.target, home.target, 0.01);
  await expectAllGearsVisible(page);
});

test('部品が 1 つも無いときの Home → 初期の視点に戻る', async ({ page }) => {
  // 初期の視点（起動直後）を覚えておくため、読み込み直す
  await page.reload();
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  const initial = await getCamera(page);
  await page.evaluate(() =>
    window.__gearSim?.loadScene({
      shafts: {},
      gears: {},
      motors: {},
      anchors: {},
      carriers: {},
      racks: {},
    }),
  );
  await setCamera(page, AWAY);
  await page.keyboard.press('Home');
  const pose = await settledCamera(page);
  expectVecClose(pose.position, initial.position, 0.01);
  expectVecClose(pose.target, initial.target, 0.01);
});

test('フォーカスが input にあるときの Home・F → カメラが動かない', async ({ page }) => {
  await setCamera(page, AWAY);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'typing-test';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('Home');
  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  const pose = await settledCamera(page);
  expectVecClose(pose.position, AWAY.position);
  expectVecClose(pose.target, AWAY.target);
  // 入力欄には文字がそのまま入る
  await expect(page.locator('#typing-test')).toHaveValue('f');
});
