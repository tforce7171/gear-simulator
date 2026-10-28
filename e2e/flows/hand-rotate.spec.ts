import type { Vec3 } from '../../src/core/math/vec3';
import {
  centerOf,
  clickGear,
  deselect,
  fixtureScene,
  getLayout,
  getMotion,
  getScene,
  nextFrames,
  openApp,
  type Point,
  project,
} from '../fixtures/sim';
import { expect, test } from '../fixtures/test';

// 通しテスト 5（S1-31）: モーターを止めて、真ん中の歯車を手で 90° 回す

// シーン A: g1（12 歯、shaft_s1）→ g2（36 歯、shaft_s2）→ g3（24 歯、shaft_s3）。モーターは shaft_s1
const sceneA = fixtureScene('scene-a');
const TOP_VIEW = { position: [0, 400, 0.001] as Vec3, target: [0, 0, 0] as Vec3 };
// 経路（S1-21 の hand-rotation.spec.ts と同じ作り方）: 歯車の面上、中心から半径 15 の 0 → π/2 を 10 段
const PATH_RADIUS = 15;
const PATH_STEPS = 10;
const PAIRS = [
  ['shaft_s1', 'gear_g1', 'shaft_s2', 'gear_g2'],
  ['shaft_s2', 'gear_g2', 'shaft_s3', 'gear_g3'],
] as const;

async function pathPoints(page: Parameters<typeof project>[0], gearId: string): Promise<Point[]> {
  const c = centerOf(await getLayout(page), gearId);
  const points: Point[] = [];
  for (let i = 0; i <= PATH_STEPS; i++) {
    const phi = (Math.PI / 2) * (i / PATH_STEPS);
    points.push(
      await project(page, [
        c[0] + PATH_RADIUS * Math.cos(phi),
        c[1],
        c[2] + PATH_RADIUS * Math.sin(phi),
      ]),
    );
  }
  return points;
}

test('手で回す: g2 を 90° ドラッグしてもかみ合いの関係（z₁θ₁ + z₂θ₂）が保たれ、離すと止まる', async ({
  page,
}) => {
  await openApp(page, { scene: sceneA, camera: TOP_VIEW });

  // プロパティパネルでモーターを OFF にし、選択を外す（候補・ハンドルを消す）
  await clickGear(page, 'gear_g1');
  await page.getByTestId('prop-motor-on').click();
  expect((await getScene(page)).motors.motor_m1?.on).toBe(false);
  await deselect(page);

  const scene = await getScene(page);
  const teeth = (id: string) => scene.gears[id]?.teeth ?? Number.NaN;
  const invariants = (angles: Record<string, number>) =>
    PAIRS.map(
      ([sa, ga, sb, gb]) =>
        teeth(ga) * (angles[sa] ?? Number.NaN) + teeth(gb) * (angles[sb] ?? Number.NaN),
    );
  const before = await getMotion(page);
  const start = invariants(before.angles);

  const [first, ...rest] = await pathPoints(page, 'gear_g2');
  if (first === undefined) throw new Error('経路が空');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of rest) await page.mouse.move(p.x, p.y);
  await nextFrames(page);
  const during = await getMotion(page);
  expect(await page.evaluate(() => window.__gearSim?.getHand()?.shaftId)).toBe('shaft_s2');
  await page.mouse.up();
  await nextFrames(page);

  const after = await getMotion(page);
  // g2 は約 90° 回った
  const turned = Math.abs((after.angles.shaft_s2 ?? 0) - (before.angles.shaft_s2 ?? 0));
  expect(Math.abs(turned - Math.PI / 2)).toBeLessThan(0.05);
  for (const state of [during, after]) {
    invariants(state.angles).forEach((value, i) => {
      expect(Math.abs(value - (start[i] ?? Number.NaN))).toBeLessThan(1e-6);
    });
  }
  expect(Object.values(after.omegas).every((w) => w === 0)).toBe(true);
});
