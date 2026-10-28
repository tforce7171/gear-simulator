import type { Vec3 } from '../../src/core/math/vec3';
import { clickGear, fixtureScene, getMotion, getScene, openApp, setPaused } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';

// 通しテスト 4（S1-31）: 押し合ってロックした 2 枚の片方のモーターを止めると回り出し、Space で止める

// 中・20 歯の 2 枚（shaft_1 の起点 [0, 0, 0] と、その外周の shaft_2）。両方に小のモーター（60 rpm、+1、ON）
const lockOpposed = fixtureScene('lock-opposed');
const TOP_VIEW = { position: [0, 260, 20.001] as Vec3, target: [0, 0, 20] as Vec3 };

function allZero(omegas: Record<string, number>): boolean {
  return Object.values(omegas).every((w) => w === 0);
}

test('ロックと一時停止: モーターを 1 つ OFF にするとロックが解け、Space で止めて Space で回る', async ({
  page,
}) => {
  await openApp(page, { scene: lockOpposed, camera: TOP_VIEW });
  let motion = await getMotion(page);
  expect(motion.locks).toHaveLength(1);
  expect(motion.locks[0]?.reason).toBe('stalemate');
  expect(allZero(motion.omegas)).toBe(true);

  // プロパティパネルで shaft_1 のモーターを OFF
  await clickGear(page, 'gear_1');
  await page.getByTestId('prop-motor-on').click();
  expect((await getScene(page)).motors.motor_1?.on).toBe(false);
  motion = await getMotion(page);
  expect(motion.locks).toEqual([]);
  expect(motion.omegas.shaft_2).toBeCloseTo(2 * Math.PI, 6);

  // Space → 全部止まり、シーンは変わらない
  const scene = await getScene(page);
  await setPaused(page, true);
  expect(allZero((await getMotion(page)).omegas)).toBe(true);
  expect(await getScene(page)).toEqual(scene);

  // Space → 回り出す
  await setPaused(page, false);
  expect((await getMotion(page)).omegas.shaft_2).toBeCloseTo(2 * Math.PI, 6);
});
