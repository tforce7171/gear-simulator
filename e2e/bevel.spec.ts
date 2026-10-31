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

// S2-02: かさ歯車。bevel-pair は縦の A（中・20 歯、apex 1、モーター 60 rpm）と、その bevel の子 B（軸 'x'、side −1）
const bevelPair = fixtureScene('bevel-pair');

test('bevel-pair を読む → B のシャフトの ω が −2π', async ({ page }) => {
  await openApp(page, { scene: bevelPair });
  const layout = await getLayout(page);
  expect(layout.meshes).toEqual([{ a: 'gear_a', b: 'gear_b', source: 'tree', kind: 'bevel' }]);
  expect(layout.interferences).toEqual([]);
  const motion = await getMotion(page);
  expect(motion.omegas.shaft_a).toBeCloseTo(2 * Math.PI, 6);
  expect(motion.omegas.shaft_b).toBeCloseTo(-2 * Math.PI, 6);
});

test('A を選ぶ → かさ歯車の候補が 1〜4 つ。1 つをクリック → bevel のシャフトが生え、干渉なし。Ctrl+Z で消える', async ({
  page,
}) => {
  await openApp(page, { scene: bevelPair });
  await selectPaletteKind(page, 'bevel');
  await page.keyboard.press('Home');
  await clickGear(page, 'gear_a');
  const bevels = (await getCandidates(page)).filter((c) => c.kind === 'bevel');
  expect(bevels.length).toBeGreaterThanOrEqual(1);
  expect(bevels.length).toBeLessThanOrEqual(4);

  // 押した点で pick がその候補に当たるものを選ぶ（A・B の陰になっていないもの）
  let target: { x: number; y: number } | null = null;
  for (const candidate of bevels) {
    const p = await project(page, candidate.center);
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind === 'candidate' && hit.id === String(candidate.index)) {
      target = p;
      break;
    }
  }
  if (target === null) throw new Error('押せるかさ歯車の候補が無い');

  const before = await getScene(page);
  await page.mouse.click(target.x, target.y);
  const after = await getScene(page);
  const added = Object.keys(after.shafts).filter((id) => before.shafts[id] === undefined);
  expect(added).toHaveLength(1);
  const shaft = after.shafts[added[0] ?? ''];
  expect(shaft?.placement.kind).toBe('bevel');
  expect((await getLayout(page)).interferences).toEqual([]);

  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => Object.keys((await getScene(page)).shafts).sort())
    .toEqual(['shaft_a', 'shaft_b']);
});
