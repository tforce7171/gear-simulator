import type { Vec3 } from '../src/core/math/vec3';
import {
  fixtureScene,
  getCandidates,
  getLayout,
  getScene,
  nextFrames,
  openApp,
  project,
  setCamera,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S4-02: 生やす候補をパレットで選んだ種類だけにする

test('平歯車を選び、パレットでウォームを選ぶ → 同じ軸の候補だけが出て、かみ合える種類の注記が出る（日・英）', async ({
  page,
}) => {
  await openApp(page, { scene: fixtureScene('one-root') });
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await page.evaluate(() => window.__gearSim?.select('gear_a'));
  await nextFrames(page);
  const note = page.getByTestId('palette-kind-note');
  await expect(note).toBeHidden();
  expect((await getCandidates(page)).some((c) => c.kind === 'perimeter')).toBe(true);

  await page.getByTestId('palette-kind-worm').click();
  const kinds = (await getCandidates(page)).map((c) => c.kind);
  expect(kinds.length).toBeGreaterThan(0);
  expect(new Set(kinds)).toEqual(new Set(['coaxial']));
  await expect(note).toBeVisible();
  await expect(note).toHaveText('この歯車とかみ合えるのは平歯車・内歯車・ラック・遊星歯車です');
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await expect(note).toHaveText(
    'This gear meshes with: Spur gear, Internal gear, Rack, Planetary gears',
  );

  // 遊星を選ぶと遊星歯車機構の候補だけ。注記は消える
  await page.getByTestId('palette-kind-planetary').click();
  expect((await getCandidates(page)).map((c) => c.kind)).toEqual(['planetary']);
  await expect(note).toBeHidden();
  // 選択を外すと注記は出ない
  await page.getByTestId('palette-kind-worm').click();
  await page.evaluate(() => window.__gearSim?.select(null));
  await expect(note).toBeHidden();
});

test('ハンドルの当たり判定に重なった候補をクリックしても置け、ドラッグはハンドルを動かす（showcase の gear_g6 の円弧のハンドル）', async ({
  page,
}) => {
  const scene = fixtureScene('showcase');
  await openApp(page, { scene });
  // gear_g6 の真上から見下ろす
  const center = (await getLayout(page)).gears.gear_g6?.center;
  if (center === undefined) throw new Error('gear_g6 が無い');
  await setCamera(page, { position: [center[0], center[1] + 320, center[2] + 1], target: center });
  await page.evaluate(() => window.__gearSim?.select('gear_g6'));
  await nextFrames(page);
  // 外周の候補の上で、ピッキングがハンドルの見えない太めの当たり判定（proxyOnly）を返す点（候補の中心と、
  // 中心から 15 mm の 8 方向を試す）。S4-02 の前は、ここをクリックしても何も起きなかった
  let target: { x: number; y: number } | null = null;
  for (const c of await getCandidates(page)) {
    if (c.kind !== 'perimeter') continue;
    const [cx, cy, cz] = c.center;
    // gear_g6 は大・20 歯（ピッチ円の半径 30）。軸は y なので xz 平面で試す
    const points: Vec3[] = [c.center];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      points.push([cx + 15 * Math.cos(a), cy, cz + 15 * Math.sin(a)]);
    }
    for (const w of points) {
      const p = await project(page, w);
      const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
      const under = await page.evaluate(
        ({ x, y }) => window.__gearSim?.pick(x, y, ['candidate']),
        p,
      );
      const onCanvas = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
        p,
      );
      if (
        onCanvas &&
        hit?.kind === 'handle' &&
        hit.proxyOnly === true &&
        under?.id === String(c.index)
      ) {
        target = p;
        break;
      }
    }
    if (target !== null) break;
  }
  if (target === null) throw new Error('ハンドルに重なった候補が無い');
  const before = Object.keys((await getScene(page)).gears).length;
  await page.mouse.click(target.x, target.y);
  await expect.poll(async () => Object.keys((await getScene(page)).gears).length).toBe(before + 1);

  // 同じ点からのドラッグは、これまでどおりハンドルを動かす（円弧のハンドル: gear_g6 のシャフトの角度が変わる）
  await page.evaluate(() => window.__gearSim?.undo());
  await page.evaluate(() => window.__gearSim?.select('gear_g6'));
  await nextFrames(page);
  const angleOf = async () => {
    const placement = (await getScene(page)).shafts.shaft_s5?.placement;
    return placement?.kind === 'mesh' ? placement.angle : null;
  };
  const angle = await angleOf();
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(target.x + 6 * i, target.y + 6 * i);
  await page.mouse.up();
  await expect.poll(angleOf).not.toBe(angle);
  expect(Object.keys((await getScene(page)).gears)).toHaveLength(before);
});
