import type { Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/math/vec3';
import {
  blur,
  centerOf,
  clickGear,
  clickPerimeterCandidate,
  deselect,
  distance,
  fixtureScene,
  getHandles,
  getLayout,
  getMotion,
  getScene,
  openApp,
  type Point,
  project,
} from '../fixtures/sim';
import { expect, test } from '../fixtures/test';

// 通しテスト 7（S1-31）: 円弧のハンドルでループを作ってロックし、Undo で解き、親を消して浮いたシャフトを付け直す

// 縦軸の起点 A（shaft_a・gear_a、中・20 歯、中心 [0, 39, 0]）に中のモーター（30 rpm、+1、ON）
const oneRootMotor = fixtureScene('one-root-motor');
const A = 'gear_a';
// 中・20 歯どうしの中心距離
const D = 40;
const TOP_VIEW = { position: [0, 400, 0.001] as Vec3, target: [0, 0, 0] as Vec3 };

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// −π〜π に巻き戻した角度の差
function angleDelta(from: number, to: number): number {
  const d = (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d;
}

// 円弧のハンドルをつかみ、親の中心の画面上の位置のまわりに toward の側へ degrees だけ（10 段階で）回して離す
// （S1-19 の handles.spec.ts の dragArc と同じ）
async function dragArc(
  page: Page,
  parentCenter: Vec3,
  handlePosition: Vec3,
  toward: Vec3,
  degrees: number,
): Promise<void> {
  const c = await project(page, parentCenter);
  const p0 = await project(page, handlePosition);
  const t = await project(page, toward);
  const r = Math.hypot(p0.x - c.x, p0.y - c.y);
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  const sign = angleDelta(a0, Math.atan2(t.y - c.y, t.x - c.x)) >= 0 ? 1 : -1;
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  const total = (sign * degrees * Math.PI) / 180;
  for (let i = 1; i <= 10; i++) {
    const a = a0 + (total * i) / 10;
    await page.mouse.move(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  }
  await page.mouse.up();
}

async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  }
  await page.mouse.up();
}

function hasMesh(
  meshes: ReadonlyArray<{ a: string; b: string; source: string }>,
  x: string,
  y: string,
  source: string,
): boolean {
  return meshes.some(
    (m) => ((m.a === x && m.b === y) || (m.a === y && m.b === x)) && m.source === source,
  );
}

test('ループと付け直し: 円弧で A とかみ合わせてロック → Undo → B を消して浮いた C を A に付け直す', async ({
  page,
}) => {
  await openApp(page, { scene: oneRootMotor, camera: TOP_VIEW });
  const a = centerOf(await getLayout(page), A);

  // A の外周（+Z）に B、B の外周（+X）に C を生やす。A と C は 40√2 離れていてかみ合わない
  await clickGear(page, A);
  const B = await clickPerimeterCandidate(page, add(a, [0, 0, D]));
  const b = centerOf(await getLayout(page), B);
  const C = await clickPerimeterCandidate(page, add(b, [D, 0, 0]));
  expect(await page.evaluate(() => window.__gearSim?.getSelection())).toEqual([C]);
  let layout = await getLayout(page);
  expect(distance(centerOf(layout, C), a)).toBeCloseTo(D * Math.SQRT2, 6);
  expect(layout.meshes).toHaveLength(2);
  const shaftC = (await getScene(page)).gears[C]?.shaftId ?? '';

  // C の円弧のハンドルを A の側へ 30° 回す → A とちょうどかみ合う角度に吸着してループになり、ロックする
  const arc = (await getHandles(page)).find((h) => h.kind === 'arc' && h.targetId === shaftC);
  if (arc === undefined) throw new Error('C の円弧のハンドルが無い');
  await dragArc(page, b, arc.position, a, 30);
  layout = await getLayout(page);
  expect(Math.abs(distance(centerOf(layout, C), a) - D)).toBeLessThanOrEqual(1e-3);
  expect(hasMesh(layout.meshes, A, C, 'contact')).toBe(true);
  expect(layout.interferences).toEqual([]);
  const locked = await getMotion(page);
  expect(locked.locks.map((l) => l.reason)).toContain('contradiction');

  // Ctrl+Z → ロックが解ける
  await blur(page);
  await page.keyboard.press('Control+z');
  expect((await getMotion(page)).locks).toEqual([]);
  const cBefore = centerOf(await getLayout(page), C);

  // B を Delete → C のシャフトが浮く（その場に残る）
  await deselect(page);
  await clickGear(page, B);
  await blur(page);
  await page.keyboard.press('Delete');
  expect((await getScene(page)).shafts[shaftC]?.placement.kind).toBe('detached');
  expect(distance(centerOf(await getLayout(page), C), cBefore)).toBeCloseTo(0, 6);

  // C を選び、本体（真下の位置・高さのハンドルを避けた点）を A の外周（+X）の候補の位置へドラッグして離す
  await clickGear(page, C);
  const grab = await project(page, add(cBefore, [12, 0, 0]));
  const body = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), grab);
  // 同じ軸の候補（C の上下）の陰でも、選んだ浮いたシャフトの本体の左ボタンは付け直しになる（S1-19）。
  // ハンドルでないことだけ確かめる
  expect(body).not.toBeNull();
  expect(body?.kind).not.toBe('handle');
  // 付け直しの候補は、ポインターに最も近い「付け直した後の C の中心」で選ばれる（S1-19）
  await drag(page, grab, await project(page, add(a, [D, 0, 0])));

  expect((await getScene(page)).shafts[shaftC]?.placement).toMatchObject({
    kind: 'mesh',
    parentGearId: A,
    childGearId: C,
  });
  const motion = await getMotion(page);
  expect(motion.locks).toEqual([]);
  expect(motion.omegas[shaftC]).toBeCloseTo(-Math.PI, 6);
});
