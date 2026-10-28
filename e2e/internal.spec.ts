import type { Page } from '@playwright/test';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import {
  blur,
  type Candidate,
  clickGear,
  clickPerimeterCandidate,
  fixtureScene,
  getCandidates,
  getLayout,
  getMotion,
  getScene,
  openApp,
  project,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S3-02: 内歯車。internal-pair は縦軸の起点 shaft_p（原点 [0, 35, 0]）に中・20 歯 P とモーター 中
// （60 rpm = 2π rad/s、正の向き、ON）、P の mesh の子（角度 0）に中・60 歯の内歯車 G（shaft_g、webSide −1、offset 0）。
// P の中心 [0, 39, 0]、G の中心 [0, 39, 40]（中心距離 R − r = 40）。ウェブは下（y の負の側）で、上が開いている
const internalPair = fixtureScene('internal-pair');

// 上の開いている側から、少し斜めに見下ろす
const VIEW = { position: [60, 230, 120] as Vec3, target: [0, 39, 30] as Vec3 };

async function selectPaletteKind(page: Page, kind: 'internal'): Promise<void> {
  const button = page.getByTestId(`palette-kind-${kind}`);
  await button.click();
  await expect(button).toHaveAttribute('aria-checked', 'true');
  await blur(page);
}

test('internal-pair → G のシャフトの ω が 2π/3（P と同じ向き）', async ({ page }) => {
  await openApp(page, { scene: internalPair, camera: VIEW });
  const motion = await getMotion(page);
  expect(motion.omegas.shaft_p).toBeCloseTo(2 * Math.PI, 6);
  expect(motion.omegas.shaft_g).toBeCloseTo((2 * Math.PI) / 3, 6);
  expect(motion.locks).toEqual([]);
  expect((await getLayout(page)).interferences).toEqual([]);
});

test('G を選び、内側の候補を 1 つクリック → 新しい平歯車が G とかみ合う（internal が 2 組）、干渉なし', async ({
  page,
}) => {
  await openApp(page, { scene: internalPair, camera: VIEW });
  await clickGear(page, 'gear_g');
  const inner = (await getCandidates(page)).filter((c) => c.kind === 'perimeter');
  expect(inner.length).toBeGreaterThan(0);
  // P と反対の側（G の中心から +z に 40）の候補
  const added = await clickPerimeterCandidate(page, [0, 39, 80]);
  const scene = await getScene(page);
  expect(scene.gears[added]).toMatchObject({ kind: 'spur', size: 'M', teeth: 20 });
  const layout = await getLayout(page);
  expect(layout.meshes.filter((m) => m.kind === 'internal')).toHaveLength(2);
  expect(layout.meshes).toContainEqual({
    a: added < 'gear_g' ? added : 'gear_g',
    b: added < 'gear_g' ? 'gear_g' : added,
    source: 'tree',
    kind: 'internal',
  });
  expect(layout.interferences).toEqual([]);
  // 新しい平歯車は G と同じ向き・歯数比どおりに回る（P と同じ速さ）
  const motion = await getMotion(page);
  const shaft = scene.gears[added]?.shaftId ?? '';
  expect(motion.omegas[shaft]).toBeCloseTo(2 * Math.PI, 6);
});

test('P のシャフトだけのシーンで P を選び、囲む内歯車の候補をクリック → 内歯車ができて P とかみ合う。Ctrl+Z で消える', async ({
  page,
}) => {
  const onlyP: Scene = {
    shafts: { shaft_p: internalPair.shafts.shaft_p as Scene['shafts'][string] },
    gears: { gear_p: internalPair.gears.gear_p as Scene['gears'][string] },
    motors: {},
    anchors: {},
    carriers: {},
    racks: {},
  };
  await openApp(page, { scene: onlyP, camera: VIEW });
  // 囲む候補は、パレットで内歯車を選んでいるときに出る
  await selectPaletteKind(page, 'internal');
  await clickGear(page, 'gear_p');
  const enclose = (await getCandidates(page)).filter((c) => c.kind === 'enclose');
  expect(enclose).toHaveLength(1);
  const candidate = enclose[0] as Candidate;
  await clickCandidateBody(page, candidate);

  const scene = await getScene(page);
  const internals = Object.values(scene.gears).filter((g) => g.kind === 'internal');
  expect(internals).toHaveLength(1);
  expect(internals[0]).toMatchObject({ size: 'M', teeth: 40, webSide: -1, offset: 0 });
  const layout = await getLayout(page);
  expect(layout.meshes.map((m) => m.kind)).toEqual(['internal']);
  expect(layout.interferences).toEqual([]);

  await blur(page);
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => Object.keys((await getScene(page)).gears).sort())
    .toEqual(['gear_p']);
});

// 囲む候補（リング）の上で、pick がその候補を返す点を探してクリックする。親の歯車の外側のリングの上を試す
async function clickCandidateBody(page: Page, candidate: Candidate): Promise<void> {
  const [cx, cy, cz] = candidate.center;
  // 内歯車（中・40 歯）のリングは中心から 38〜46.5。歯の無いリムの上（半径 44）を 8 方向に試す
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const p = await project(page, [cx + 44 * Math.sin(a), cy + 4, cz + 44 * Math.cos(a)]);
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind !== 'candidate' || hit.id !== String(candidate.index)) continue;
    const before = Object.keys((await getScene(page)).gears).length;
    await page.mouse.click(p.x, p.y);
    await expect
      .poll(async () => Object.keys((await getScene(page)).gears).length)
      .toBe(before + 1);
    return;
  }
  throw new Error('囲む候補を押せる点が無い');
}
