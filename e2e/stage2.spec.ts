import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { skewSign } from '../src/core/geometry/skew';
import { withShaftSpans } from '../src/core/layout/resolve';
import { axisVector } from '../src/core/math/axis';
import type { Vec3 } from '../src/core/math/vec3';
import type { GearKind, Scene } from '../src/core/scene/types';
import {
  type Candidate,
  centerOf,
  clickGear,
  dragShaftEnd,
  EMPTY,
  fixtureScene,
  getCandidates,
  getLayout,
  getMotion,
  getScene,
  getSelection,
  openApp,
  type Point,
  placeOnShaft,
  project,
  setCamera,
  waitAutosaved,
  waitReady,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S2-05: 音・テーマ・保存形式の拡張。段階 2 の 4 種類の歯車をパレット・プロパティ・保存・音までそろえる。
// stage2-showcase は、縦の起点のシャフトにかさ歯車 A・ハスバ・平歯車、A の bevel の子 B のシャフトにウォーム、
// そのホイールのシャフトにねじ歯車を重ね、平歯車・ハスバ・ねじ歯車にそれぞれ相手を付けたもの（モーターは起点に 1 つ）

const showcase = fixtureScene('stage2-showcase');

// 点 p を斜め上の前から見る
function lookAt(p: Vec3, distance = 1): { position: Vec3; target: Vec3 } {
  return {
    position: [p[0] + 140 * distance, p[1] + 110 * distance, p[2] + 160 * distance],
    target: p,
  };
}

async function selectPaletteKind(page: Page, kind: GearKind): Promise<void> {
  const button = page.getByTestId(`palette-kind-${kind}`);
  await button.click();
  await expect(button).toHaveAttribute('aria-checked', 'true');
}

// 候補の仮の歯車の上で、pick がその候補を返す点を探してクリックする。生やした歯車の ID を返す
async function clickCandidate(page: Page, candidate: Candidate): Promise<string> {
  await setCamera(page, lookAt(candidate.center));
  const [cx, cy, cz] = candidate.center;
  const tries: Vec3[] = [candidate.center];
  for (const d of [4, 8]) {
    for (const [dx, dy, dz] of [
      [d, 0, 0],
      [-d, 0, 0],
      [0, d, 0],
      [0, -d, 0],
      [0, 0, d],
      [0, 0, -d],
    ] as const) {
      tries.push([cx + dx, cy + dy, cz + dz]);
    }
  }
  let point: Point | null = null;
  for (const world of tries) {
    const p = await project(page, world);
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind === 'candidate' && hit.id === String(candidate.index)) {
      point = p;
      break;
    }
  }
  if (point === null) throw new Error(`候補 ${candidate.index} を押せる点が無い`);
  const before = new Set(Object.keys((await getScene(page)).gears));
  await page.mouse.click(point.x, point.y);
  const added = Object.keys((await getScene(page)).gears).filter((id) => !before.has(id));
  expect(added).toHaveLength(1);
  return added[0] ?? '';
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('通し: 縦のシャフト → かさ歯車 A → B → ウォーム W → ホイール H → モーター。ω、Undo、保存と再読み込み', async ({
  page,
}) => {
  await openApp(page, { scene: EMPTY, camera: lookAt([0, 0, 0], 1.2) });

  // 縦のシャフトを置く（パレットから床の原点へドラッグ。S1-17）
  const box = await page.getByTestId('palette-root-shaft').boundingBox();
  if (box === null) throw new Error('起点のシャフトの項目が無い');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = await project(page, [0, 0, 0]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  const placed = await getScene(page);
  const root = Object.values(placed.gears)[0];
  if (root === undefined) throw new Error('起点が置かれていない');
  expect(root.kind).toBe('spur');
  expect(await getSelection(page)).toEqual([root.id]);

  // シャフトの上端のつまみを上へ伸ばし（S4-03）、パレットで「かさ」を選んで、平歯車から離れた上の方にかさ歯車 A を置く
  // （平歯車と隣り合うと、A のかさ歯車の候補はどれも平歯車と干渉する）
  await selectPaletteKind(page, 'bevel');
  await dragShaftEnd(page, root.shaftId, 'spanEnd', 48);
  expect((await getScene(page)).shafts[root.shaftId]?.span?.[1]).toBeGreaterThanOrEqual(56);
  const a = await placeOnShaft(page, root.shaftId, 52);
  expect((await getScene(page)).gears[a]).toMatchObject({
    kind: 'bevel',
    shaftId: root.shaftId,
    offset: 48,
  });
  await clickGear(page, a);
  const bevelCandidates = (await getCandidates(page)).filter((c) => c.kind === 'bevel');
  expect(bevelCandidates.length).toBeGreaterThan(0);

  // A のかさ歯車の候補から B（横の軸）
  const b = await clickCandidate(page, bevelCandidates[0] as Candidate);
  const sceneB = await getScene(page);
  const gearB = sceneB.gears[b];
  expect(gearB?.kind).toBe('bevel');
  const shaftB = gearB === undefined ? undefined : sceneB.shafts[gearB.shaftId];
  if (shaftB?.placement.kind !== 'bevel') throw new Error('B が bevel のシャフトに無い');
  expect((await getLayout(page)).gears[b]?.axis).not.toBe('y');

  // B のシャフトを A から離れる向きに伸ばし、パレットで「ウォーム」を選んで、B から離れた所にウォーム W を置く
  // （W と B が隣り合うと、ホイールの候補はどれも B と干渉する。ホイールの候補は、パレットでホイールを選んだときだけ出る。S4-02）
  await selectPaletteKind(page, 'worm');
  const layoutB = await getLayout(page);
  const shaftIdB = gearB?.shaftId as string;
  const bAxis = axisVector(layoutB.gears[b]?.axis ?? 'x');
  const awayFromA = Math.sign(dot(sub(centerOf(layoutB, b), centerOf(layoutB, a)), bAxis));
  await setCamera(page, lookAt(centerOf(layoutB, b), 1.6));
  await dragShaftEnd(page, shaftIdB, awayFromA > 0 ? 'spanEnd' : 'spanStart', awayFromA * 72);
  const spanB = (await getScene(page)).shafts[shaftIdB]?.span;
  if (spanB === undefined) throw new Error('B のシャフトに範囲が無い');
  const w = await placeOnShaft(page, shaftIdB, awayFromA > 0 ? spanB[1] - 24 : spanB[0] + 24);
  expect((await getScene(page)).gears[w]).toMatchObject({
    kind: 'worm',
    teeth: 1,
    shaftId: shaftIdB,
  });
  await clickGear(page, w);
  await selectPaletteKind(page, 'wormWheel');
  const skewCandidates = (await getCandidates(page))
    .filter((c) => c.kind === 'skew')
    .sort((p, q) => q.center[1] - p.center[1]);
  expect(skewCandidates.length).toBeGreaterThan(0);

  // W からホイール H。歯数をプロパティパネルで 30 にする
  const h = await clickCandidate(page, skewCandidates[0] as Candidate);
  expect((await getScene(page)).gears[h]?.kind).toBe('wormWheel');
  await page.getByTestId('prop-teeth').fill('30');
  await page.getByTestId('prop-teeth').press('Enter');
  await expect.poll(async () => (await getScene(page)).gears[h]?.teeth).toBe(30);

  // A のシャフトにモーター（中）を付ける
  await setCamera(page, lookAt(centerOf(await getLayout(page), a)));
  await clickGear(page, a);
  await page.getByTestId('prop-motor-add-M').click();
  const built = await getScene(page);
  expect(Object.values(built.motors)).toHaveLength(1);

  // H の ω = A の ω × (apex_A·side_B) × (−s·z_W/z_H)。s = (e_W × u)·e_H（S2-02・S2-03 の式）
  const layout = await getLayout(page);
  expect(layout.interferences).toEqual([]);
  const motion = await getMotion(page);
  expect(motion.locks).toEqual([]);
  const gearA = built.gears[a];
  const gearH = built.gears[h];
  const gearW = built.gears[w];
  if (gearA?.kind !== 'bevel' || gearH === undefined || gearW === undefined) {
    throw new Error('部品が足りない');
  }
  const omegaA = motion.omegas[gearA.shaftId] ?? 0;
  expect(Math.abs(omegaA)).toBeGreaterThan(0);
  const lw = layout.gears[w];
  const lh = layout.gears[h];
  if (lw === undefined || lh === undefined) throw new Error('W・H がレイアウトに無い');
  const s = skewSign(lw.axis, lw.center, lh.axis, lh.center);
  expect(Math.abs(s)).toBeCloseTo(1, 9);
  const expected = omegaA * gearA.apex * shaftB.placement.side * ((-s * gearW.teeth) / 30);
  const omegaH = motion.omegas[gearH.shaftId] ?? 0;
  expect(Math.abs(omegaH)).toBeCloseTo(Math.abs(omegaA) / 30, 6);
  expect(omegaH).toBeCloseTo(expected, 6);

  // Ctrl+Z: モーター → H の歯数 → H の順に戻り、3 回目で H が消える（W は残る）。
  // 再読み込みで履歴は空になる（S1-27）ので、Undo は再読み込みの前に確かめ、Redo で組み上がった形に戻す
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  expect(Object.keys((await getScene(page)).motors)).toEqual([]);
  await page.keyboard.press('Control+z');
  expect((await getScene(page)).gears[h]?.teeth).toBe(20);
  await page.keyboard.press('Control+z');
  const undone = await getScene(page);
  expect(undone.gears[h]).toBeUndefined();
  expect(undone.gears[w]).toBeDefined();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Shift+z');
  expect(await getScene(page)).toEqual(built);

  // 保存（自動保存）して再読み込み → 同じシーン
  await waitAutosaved(page);
  await page.reload();
  await waitReady(page);
  expect(await getScene(page)).toEqual(built);
});

test('stage2-showcase を読む → locks と interferences が空、すべてのシャフトの ω が 0 でない', async ({
  page,
}) => {
  await openApp(page, { scene: showcase });
  const kinds = new Set(Object.values(showcase.gears).map((g) => g.kind));
  for (const kind of ['spur', 'helical', 'bevel', 'worm', 'crossedHelical'] as const) {
    expect(kinds.has(kind)).toBe(true);
  }
  expect(Object.keys(showcase.motors)).toHaveLength(1);
  const layout = await getLayout(page);
  expect(layout.interferences).toEqual([]);
  expect([...new Set(layout.meshes.map((m) => m.kind))].sort()).toEqual([
    'bevel',
    'crossedHelical',
    'helical',
    'spur',
    'worm',
  ]);
  const motion = await getMotion(page);
  expect(motion.locks).toEqual([]);
  for (const id of Object.keys(showcase.shafts)) {
    expect(Math.abs(motion.omegas[id] ?? 0), id).toBeGreaterThan(1e-6);
  }
});

test.describe('プロパティパネルの種類ごとの表示', () => {
  test('ウォームを選ぶと、種類の名前と「1 条」が出て、歯数の入力が無い', async ({ page }) => {
    await openApp(page, { scene: fixtureScene('worm-basic'), camera: lookAt([16, 60, 0]) });
    await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
    await page.evaluate(() => window.__gearSim?.select('gear_w'));
    await expect(page.getByTestId('prop-kind')).toHaveText('ウォーム');
    await expect(page.getByTestId('prop-worm-threads')).toHaveText('1 条');
    await expect(page.getByTestId('prop-teeth')).toHaveCount(0);
    await expect(page.getByTestId('prop-teeth-inc')).toHaveCount(0);
    // ホイールは歯数を編集できる
    await page.evaluate(() => window.__gearSim?.select('gear_h'));
    await expect(page.getByTestId('prop-kind')).toHaveText('ウォームホイール');
    await expect(page.getByTestId('prop-teeth')).toHaveValue('30');
  });

  test('かさ歯車の歯数を 24 にすると、相手のかさ歯車も 24 になる。注記と反転のボタン', async ({
    page,
  }) => {
    await openApp(page, { scene: fixtureScene('bevel-pair') });
    await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
    await page.evaluate(() => window.__gearSim?.select('gear_a'));
    await expect(page.getByTestId('prop-kind')).toHaveText('かさ歯車');
    await expect(page.getByTestId('prop-bevel-note')).toBeVisible();
    await page.getByTestId('prop-teeth').fill('24');
    await page.getByTestId('prop-teeth').press('Enter');
    await expect.poll(async () => (await getScene(page)).gears.gear_b?.teeth).toBe(24);
    expect((await getScene(page)).gears.gear_a?.teeth).toBe(24);

    // A（起点）は反転できる。bevel のシャフトの子 B は反転できない（ボタンが無効）
    const flip = page.getByTestId('prop-bevel-flip');
    await expect(flip).toBeEnabled();
    await flip.click();
    await expect.poll(async () => (await getScene(page)).gears.gear_a).toMatchObject({ apex: -1 });
    await page.evaluate(() => window.__gearSim?.select('gear_b'));
    await expect(page.getByTestId('prop-bevel-flip')).toBeDisabled();
  });

  test('ハスバ歯車はねじれの向きを表示だけする。ねじ歯車は歯数を編集できる', async ({ page }) => {
    await openApp(page, { scene: fixtureScene('helical-pair') });
    await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
    await page.evaluate(() => window.__gearSim?.select('gear_a'));
    await expect(page.getByTestId('prop-kind')).toHaveText('ハスバ歯車');
    await expect(page.getByTestId('prop-hand')).toHaveText('右ねじれ');
    await page.evaluate(() => window.__gearSim?.select('gear_b'));
    await expect(page.getByTestId('prop-hand')).toHaveText('左ねじれ');

    await page.evaluate((s) => window.__gearSim?.loadScene(s), fixtureScene('crossed-pair'));
    await page.evaluate(() => window.__gearSim?.select('gear_b'));
    await expect(page.getByTestId('prop-kind')).toHaveText('ねじ歯車');
    await page.getByTestId('prop-teeth').fill('30');
    await page.getByTestId('prop-teeth').press('Enter');
    await expect.poll(async () => (await getScene(page)).gears.gear_b?.teeth).toBe(30);
  });
});

test('パレットの種類は 6 つで、選んだものだけが aria-checked。英語の名前にも切り替わる', async ({
  page,
}) => {
  await openApp(page);
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  const kinds = ['spur', 'helical', 'bevel', 'worm', 'wormWheel', 'crossedHelical'] as const;
  for (const kind of kinds) await expect(page.getByTestId(`palette-kind-${kind}`)).toBeVisible();
  await expect(page.getByTestId('palette-kind-spur')).toHaveAttribute('aria-checked', 'true');
  await selectPaletteKind(page, 'crossedHelical');
  for (const kind of kinds) {
    await expect(page.getByTestId(`palette-kind-${kind}`)).toHaveAttribute(
      'aria-checked',
      String(kind === 'crossedHelical'),
    );
  }
  await expect(page.getByTestId('palette-kind-crossedHelical')).toHaveText('ねじ歯車');
  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await expect(page.getByTestId('palette-kind-crossedHelical')).toHaveText('Crossed helical gear');
});

// 「インポート」→ ファイル選択の画面でファイルを渡す
async function importFile(page: Page, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-import').click();
  await (await chooser).setFiles(path);
}

test('エクスポート → インポートで stage2-showcase が元と等しい。ダウンロードしたファイルの version は最新（S4-03 から 4）', async ({
  page,
}) => {
  await openApp(page, { scene: showcase });
  const downloading = page.waitForEvent('download');
  await page.getByTestId('toolbar-export').click();
  const path = await (await downloading).path();
  const file = JSON.parse(readFileSync(path, 'utf8'));
  expect(file.format).toBe('gear-simulator');
  expect(file.version).toBe(4);
  expect(file.scene).toEqual(showcase);

  await page.evaluate((s) => window.__gearSim?.loadScene(s), EMPTY);
  await importFile(page, path);
  await expect.poll(() => getScene(page)).toEqual(showcase);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('段階 1 で保存した version 1 のファイルをインポート → 読み込める', async ({ page }) => {
  await openApp(page);
  const v1Path = new URL('../src/core/io/save-file-v1.json', import.meta.url).pathname;
  const v1 = JSON.parse(readFileSync(v1Path, 'utf8')) as { version: number; scene: Scene };
  expect(v1.version).toBe(1);
  await importFile(page, v1Path);
  // 固定具などの無いシーンには、version 2 → 3 の移行（S3-05）が anchors・carriers・racks を {} で足し、
  // version 3 → 4 の移行（S4-03）がシャフトに今までと同じ長さの範囲を足す
  await expect
    .poll(() => getScene(page))
    .toEqual(withShaftSpans({ ...v1.scene, anchors: {}, carriers: {}, racks: {} }));
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('version 1 の自動保存から起動できる', async ({ page }) => {
  const v1Path = new URL('../src/core/io/save-file-v1.json', import.meta.url).pathname;
  const v1 = JSON.parse(readFileSync(v1Path, 'utf8')) as { version: number; scene: Scene };
  await openApp(page);
  // IndexedDB の自動保存に version 1 の SaveFile を直接書いてから再読み込みする
  await page.evaluate(async (file) => {
    const db = await import('/src/storage/db.ts');
    await db.saveAutosave(file as never);
  }, v1);
  await page.reload();
  await waitReady(page);
  expect(await getScene(page)).toEqual(
    withShaftSpans({ ...v1.scene, anchors: {}, carriers: {}, racks: {} }),
  );
});

test('getAudio().voices にウォームの組の音源があり、kind で種類が分かる', async ({ page }) => {
  await openApp(page, { scene: showcase });
  await expect
    .poll(async () => {
      const audio = await page.evaluate(() => window.__gearSim?.getAudio());
      return (audio?.voices ?? []).map((v) => v.kind).sort();
    })
    .toEqual(['bevel', 'crossedHelical', 'helical', 'spur', 'worm']);
  const audio = await page.evaluate(() => window.__gearSim?.getAudio());
  const worm = audio?.voices.find((v) => v.kind === 'worm');
  expect(worm?.key).toBe('gear_wheel|gear_worm');
  expect(worm?.frequency).toBeGreaterThan(0);
  expect(worm?.slide).toBeGreaterThan(0);
  for (const v of audio?.voices ?? []) {
    if (v.kind === 'spur' || v.kind === 'bevel' || v.kind === 'helical') expect(v.slide).toBe(0);
  }
});
