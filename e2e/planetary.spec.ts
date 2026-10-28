import type { Page } from '@playwright/test';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import {
  type Candidate,
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

// S3-03: 遊星歯車とキャリア。planetary-ring-fixed は縦軸の起点 shaft_s（原点 [0, 60, 0]）に中・24 歯の太陽 gear_s と
// モーター 中（60 rpm、正の向き、ON）、キャリア carrier_k（shaft_k）、遊星 gear_p0〜p2（中・12 歯、shaft_p0〜p2）、
// リング gear_r（中・48 歯、shaft_r）。リングのシャフトに固定具。太陽の中心は [0, 64, 0]、公転半径 36
const ringFixed = fixtureScene('planetary-ring-fixed');
const SUN_CENTER: Vec3 = [0, 64, 0];

// 斜め上から見下ろす
const VIEW = { position: [90, 200, 150] as Vec3, target: [0, 64, 0] as Vec3 };

async function shaftWorldOrigin(page: Page, shaftId: string): Promise<Vec3> {
  const p = await page.evaluate((id) => window.__gearSim?.getShaftWorldOrigin(id), shaftId);
  if (p === undefined) throw new Error('__gearSim が無い');
  return p;
}

function radial(p: Vec3, center: Vec3): number {
  return Math.hypot(p[0] - center[0], p[2] - center[2]);
}

test('planetary-ring-fixed → キャリアの ω が 2π/3、遊星の ω が −2π、ロックなし', async ({
  page,
}) => {
  await openApp(page, { scene: ringFixed, camera: VIEW });
  const motion = await getMotion(page);
  expect(motion.omegas.shaft_k).toBeCloseTo((2 * Math.PI) / 3, 6);
  for (const id of ['shaft_p0', 'shaft_p1', 'shaft_p2']) {
    expect(motion.omegas[id]).toBeCloseTo(-2 * Math.PI, 6);
  }
  expect(motion.locks).toEqual([]);
  expect((await getLayout(page)).interferences).toEqual([]);
});

test('遊星 0 番のシャフトの実際の位置は、0.5 秒あけると変わり、太陽の中心からの距離は 36 のまま', async ({
  page,
}) => {
  await openApp(page, { scene: ringFixed, camera: VIEW });
  await nextFrames(page);
  const first = await shaftWorldOrigin(page, 'shaft_p0');
  await page.waitForTimeout(500);
  const second = await shaftWorldOrigin(page, 'shaft_p0');
  expect(Math.hypot(second[0] - first[0], second[2] - first[2])).toBeGreaterThan(1);
  expect(radial(first, SUN_CENTER)).toBeCloseTo(36, 6);
  expect(radial(second, SUN_CENTER)).toBeCloseTo(36, 6);
  expect(second[1]).toBeCloseTo(first[1], 6);
});

test('太陽だけのシーンで太陽を選び、遊星歯車機構の候補をクリック → キャリア 1 件、遊星のシャフト 3 本、干渉なし', async ({
  page,
}) => {
  const sunOnly: Scene = {
    shafts: { shaft_s: ringFixed.shafts.shaft_s as Scene['shafts'][string] },
    gears: { gear_s: ringFixed.gears.gear_s as Scene['gears'][string] },
    motors: {},
    anchors: {},
    carriers: {},
  };
  await openApp(page, { scene: sunOnly, camera: VIEW });
  await clickGear(page, 'gear_s');
  const planetary = (await getCandidates(page)).filter((c) => c.kind === 'planetary');
  expect(planetary).toHaveLength(1);
  await clickPlanetaryCandidate(page, planetary[0] as Candidate);

  const scene = await getScene(page);
  expect(Object.keys(scene.carriers)).toHaveLength(1);
  const planets = Object.values(scene.shafts).filter((s) => s.placement.kind === 'planet');
  expect(planets).toHaveLength(3);
  const layout = await getLayout(page);
  expect(layout.interferences).toEqual([]);
});

// 遊星歯車機構の候補の上で、pick がその候補を返す点を探してクリックする。リング（中・48 歯）の輪は外周の候補と同じ面に
// あって重なるので、輪の下（ウェブの側）へ伸びる筒の外側の壁（半径 54.5、輪の面の 4〜12 mm 下）を 16 方向に試す
async function clickPlanetaryCandidate(page: Page, candidate: Candidate): Promise<void> {
  const [cx, cy, cz] = candidate.center;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    const p = await project(page, [cx + 54.4 * Math.sin(a), cy - 9, cz + 54.4 * Math.cos(a)]);
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind !== 'candidate' || hit.id !== String(candidate.index)) continue;
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => Object.keys((await getScene(page)).carriers).length).toBe(1);
    return;
  }
  throw new Error('遊星歯車機構の候補を押せる点が無い');
}
