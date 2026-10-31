import type { Vec3 } from '../src/core/math/vec3';
import {
  clickGear,
  fixtureScene,
  getCandidates,
  getLayout,
  getMotion,
  getScene,
  openApp,
  project,
  selectPaletteKind,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S2-04: ねじ歯車。crossed-pair は横 X のねじ歯車 A（中・20 歯、中心 [4, 80, 0]、モーター 60 rpm）と、
// その skew の子のねじ歯車 B（中・40 歯、軸 z、中心 [4, 140, 0]）
const crossedPair = fixtureScene('crossed-pair');

// A の面（+x の側）を斜め上から見る（B は横から見えるので A の陰にならず、A も B に隠れない）
const SIDE = { position: [220, 60, 60] as Vec3, target: [4, 90, 0] as Vec3 };

test('crossed-pair → B のシャフトの ω が −π、ロックなし', async ({ page }) => {
  await openApp(page, { scene: crossedPair });
  const layout = await getLayout(page);
  expect(layout.meshes).toEqual([
    { a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'crossedHelical' },
  ]);
  expect(layout.interferences).toEqual([]);
  const motion = await getMotion(page);
  expect(motion.omegas.shaft_a).toBeCloseTo(2 * Math.PI, 6);
  expect(motion.omegas.shaft_b).toBeCloseTo(-Math.PI, 6);
  expect(motion.locks).toEqual([]);
});

test('A を選ぶ → skew の候補だけ（平行な軸の候補なし）。1 つをクリック → skew のシャフトにねじ歯車が生え、干渉なし', async ({
  page,
}) => {
  await openApp(page, { scene: crossedPair, camera: SIDE });
  await selectPaletteKind(page, 'crossedHelical');
  await clickGear(page, 'gear_a');
  const candidates = await getCandidates(page);
  const fresh = candidates.filter((c) => c.kind !== 'coaxial');
  expect(fresh.length).toBeGreaterThanOrEqual(1);
  expect(fresh.length).toBeLessThanOrEqual(4);
  for (const c of fresh) expect(c.kind).toBe('skew');

  let target: { x: number; y: number } | null = null;
  for (const candidate of fresh) {
    const p = await project(page, candidate.center);
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind === 'candidate' && hit.id === String(candidate.index)) {
      target = p;
      break;
    }
  }
  if (target === null) throw new Error('押せるねじ歯車の候補が無い');

  const before = await getScene(page);
  await page.mouse.click(target.x, target.y);
  const after = await getScene(page);
  const added = Object.keys(after.gears).filter((id) => before.gears[id] === undefined);
  expect(added).toHaveLength(1);
  const gear = after.gears[added[0] ?? ''];
  expect(gear?.kind).toBe('crossedHelical');
  expect(after.shafts[gear?.shaftId ?? '']?.placement.kind).toBe('skew');
  const layout = await getLayout(page);
  expect(layout.interferences).toEqual([]);
  // 平行でない軸（A は x）
  expect(['y', 'z']).toContain(layout.shafts[gear?.shaftId ?? '']?.axis);
});
