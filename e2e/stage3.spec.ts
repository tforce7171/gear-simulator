import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { AudioState } from '../src/audio/engine';
import type { Vec3 } from '../src/core/math/vec3';
import type { Scene } from '../src/core/scene/types';
import {
  type Candidate,
  clickGear,
  deselect,
  EMPTY,
  fixtureScene,
  getCandidates,
  getLayout,
  getMotion,
  getScene,
  getSelection,
  openApp,
  type Point,
  project,
  setCamera,
  settleCamera,
  waitAutosaved,
  waitReady,
} from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S3-05: 段階 3 の部品（固定具・内歯車・遊星歯車・ラック）を、音・保存・画面 UI までそろえた確かめ。
// stage3-showcase: 遊星歯車機構（planetary-ring-fixed と同じ。リングを固定、太陽 60 rpm）と、横 Z の起点 shaft_d
// （原点 [300, 60, 0]、モーター 中 3 rpm）の平歯車 gear_d を囲む内歯車 gear_i、同じシャフトのピニオン gear_q のラック rack_r
const showcase = fixtureScene('stage3-showcase');

// 斜め上から見下ろす（遊星歯車機構）
const PLANETARY_VIEW = { position: [90, 200, 150] as Vec3, target: [0, 20, 0] as Vec3 };

const menu = (page: Page) => page.getByTestId('context-menu');
const menuItem = (page: Page, action: string) => menu(page).locator(`[data-action="${action}"]`);

async function pickAt(page: Page, world: Vec3): Promise<{ p: Point; kind?: string; id?: string }> {
  const p = await project(page, world);
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
  return { p, kind: hit?.kind, id: hit?.id };
}

// 候補の仮のリングの外側の壁（半径 R + 3.25m − 0.1 の、輪の面の少し下）を 32 方向に試して押す（S3-03 と同じ）
async function clickPlanetaryCandidate(
  page: Page,
  candidate: Candidate,
  rim: number,
): Promise<void> {
  const [cx, cy, cz] = candidate.center;
  for (let k = 0; k < 32; k++) {
    const a = (k * Math.PI) / 16;
    const { p, kind, id } = await pickAt(page, [
      cx + rim * Math.sin(a),
      cy - 9,
      cz + rim * Math.cos(a),
    ]);
    if (kind !== 'candidate' || id !== String(candidate.index)) continue;
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => Object.keys((await getScene(page)).carriers).length).toBe(1);
    return;
  }
  throw new Error('遊星歯車機構の候補を押せる点が無い');
}

// 縦軸の内歯車（リング）の外側の壁の上で、pick がその歯車を返す点
async function ringPoint(page: Page, gearId: string): Promise<Point> {
  const layout = await getLayout(page);
  const ring = layout.gears[gearId];
  if (ring === undefined) throw new Error(`${gearId} が無い`);
  const [cx, cy, cz] = ring.center;
  const m = 2; // 中
  const radius = ring.pitchRadius + 3.25 * m - 0.1;
  for (const dy of [0, -3, 3, -8]) {
    for (let k = 0; k < 32; k++) {
      const a = (k * Math.PI) / 16;
      const { p, kind, id } = await pickAt(page, [
        cx + radius * Math.sin(a),
        cy + dy,
        cz + radius * Math.cos(a),
      ]);
      if (kind === 'gear' && id === gearId) return p;
    }
  }
  throw new Error(`${gearId} を押せる点が無い`);
}

// キャリアのボスの上で、pick がキャリアを返す点（板の高さの真横から見ているときに使う）
async function carrierPoint(page: Page, carrierId: string): Promise<Point> {
  const layout = await getLayout(page);
  const carrier = layout.carriers[carrierId];
  if (carrier === undefined) throw new Error(`${carrierId} が無い`);
  const [cx, cy, cz] = carrier.center;
  for (const dy of [0, 1, -1]) {
    for (const dx of [0, 3, -3, 6, -6]) {
      const { p, kind, id } = await pickAt(page, [cx + dx, cy + dy, cz]);
      if (kind === 'carrier' && id === carrierId) return p;
    }
  }
  throw new Error(`${carrierId} を押せる点が無い`);
}

async function paletteRootCenter(page: Page): Promise<Point> {
  const box = await page.getByTestId('palette-root-shaft').boundingBox();
  if (box === null) throw new Error('起点のシャフトの項目が無い');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function getAudio(page: Page): Promise<AudioState> {
  const state = await page.evaluate(() => window.__gearSim?.getAudio());
  if (state === undefined) throw new Error('__gearSim が無い');
  return state;
}

async function setTeethByInput(page: Page, teeth: number): Promise<void> {
  await page.getByTestId('prop-teeth').fill(String(teeth));
  await page.getByTestId('prop-teeth').press('Enter');
}

test('通し（遊星）: 縦のシャフト → 中・24 歯 → 遊星歯車機構 → リングを固定 → 太陽に 60 rpm → 遊星 4 個 → 保存して再読み込み → Undo で空', async ({
  page,
  context,
}) => {
  // 画面の操作が多く、別のタブも開くので長めに待つ
  test.setTimeout(120_000);
  await openApp(page, { scene: EMPTY, camera: PLANETARY_VIEW });
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));

  // パレットで中を選び、起点のシャフトを床（原点）へドラッグ
  await page.getByTestId('palette-size-M').click();
  const from = await paletteRootCenter(page);
  const to = await project(page, [0, 0, 0]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  const placed = await getScene(page);
  const sun = Object.values(placed.gears)[0];
  if (sun === undefined) throw new Error('歯車が置かれていない');
  expect(placed.shafts[sun.shaftId]?.placement).toMatchObject({ kind: 'root', axis: 'y' });
  expect(sun.size).toBe('M');
  // プロパティで 24 歯にする
  expect(await getSelection(page)).toEqual([sun.id]);
  await setTeethByInput(page, 24);
  await expect.poll(async () => (await getScene(page)).gears[sun.id]?.teeth).toBe(24);

  // 選んだ太陽の、遊星歯車機構の候補をクリック（リングは 48 歯 → 外側の壁の半径 54.4）
  const planetary = (await getCandidates(page)).filter((c) => c.kind === 'planetary');
  expect(planetary).toHaveLength(1);
  await clickPlanetaryCandidate(page, planetary[0] as Candidate, 54.4);
  const built = await getScene(page);
  const carrier = Object.values(built.carriers)[0];
  if (carrier === undefined) throw new Error('キャリアが無い');
  const ring = Object.values(built.gears).find((g) => g.kind === 'internal');
  if (ring === undefined) throw new Error('リングが無い');
  expect(ring.teeth).toBe(48);
  const planetShafts = (s: Scene) =>
    Object.values(s.shafts).filter((x) => x.placement.kind === 'planet');
  expect(planetShafts(built)).toHaveLength(3);

  // リングを右クリック →「固定する」
  await deselect(page);
  const rp = await ringPoint(page, ring.id);
  await page.mouse.click(rp.x, rp.y, { button: 'right' });
  await expect(menuItem(page, 'anchor')).toHaveText('固定する');
  await menuItem(page, 'anchor').click();
  await expect(menu(page)).toHaveCount(0);
  expect(Object.values((await getScene(page)).anchors).map((a) => a.target)).toEqual([
    { kind: 'shaft', id: ring.shaftId },
  ]);

  // 太陽のシャフトにモーター（60 rpm）
  await clickGear(page, sun.id);
  await page.getByTestId('prop-motor-add-M').click();
  await page.getByTestId('prop-motor-rpm').fill('60');
  await page.getByTestId('prop-motor-rpm').press('Enter');
  await expect
    .poll(async () => Object.values((await getScene(page)).motors).map((m) => m.rpm))
    .toEqual([60]);
  await expect
    .poll(async () => (await getMotion(page)).omegas[carrier.shaftId] ?? 0)
    .toBeCloseTo((2 * Math.PI) / 3, 6);

  // キャリアを選んでプロパティで遊星の数を 4（5 は選べない）
  // 歯車はキャリアより先に選ばれる（S3-03 の優先順位）ので、板の高さの真横から、ボスの所を押す
  await deselect(page);
  const plate = (await getLayout(page)).carriers[carrier.id]?.center;
  if (plate === undefined) throw new Error('キャリアがレイアウトに無い');
  await setCamera(page, { position: [plate[0], plate[1], plate[2] + 260], target: plate });
  await settleCamera(page);
  const cp = await carrierPoint(page, carrier.id);
  await page.mouse.click(cp.x, cp.y);
  expect(await getSelection(page)).toEqual([carrier.id]);
  await expect(page.getByTestId('prop-planet-count-5')).toBeDisabled();
  await page.getByTestId('prop-planet-count-4').click();
  await expect.poll(async () => planetShafts(await getScene(page)).length).toBe(4);
  await expect(page.getByTestId('prop-planets')).toHaveText('4 個');
  const motion = await getMotion(page);
  expect(motion.omegas[carrier.shaftId]).toBeCloseTo((2 * Math.PI) / 3, 6);
  expect(motion.locks).toEqual([]);
  for (const s of planetShafts(await getScene(page))) {
    expect(motion.omegas[s.id]).toBeCloseTo(-2 * Math.PI, 6);
  }
  const final = await getScene(page);

  // 保存（自動保存）して再読み込み → 同じシーン。履歴を残したまま確かめるため、同じブラウザの別のタブで開く
  await waitAutosaved(page);
  const reloaded = await context.newPage();
  await reloaded.goto('/');
  await waitReady(reloaded);
  expect(await reloaded.evaluate(() => window.__gearSim?.getScene())).toEqual(final);
  await reloaded.close();

  // Ctrl+Z を繰り返して空に戻る
  await deselect(page);
  for (let i = 0; i < 20; i++) {
    if (Object.keys((await getScene(page)).shafts).length === 0) break;
    await page.keyboard.press('Control+z');
  }
  expect(await getScene(page)).toEqual(EMPTY);
});

test('通し（ラック）: one-root-motor の歯車にラックを置く → 動く → 端でロック → モーターを反転 → ロックが解ける', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const scene = fixtureScene('one-root-motor');
  await openApp(page, {
    scene,
    camera: { position: [0, 160, 220] as Vec3, target: [0, 39, 0] as Vec3 },
  });
  await clickGear(page, 'gear_a');
  const racks = (await getCandidates(page)).filter((c) => c.kind === 'rack');
  expect(racks).toHaveLength(4);
  // 候補のラックの背（歯の反対側。歯車の中心から離れる向き）を、ラックに沿っていくつか試して押す
  // （外周の候補（中心から 40 mm、歯先円 22 mm）の陰にならない、ラックの端に近い所）
  const gear = (await getLayout(page)).gears.gear_a;
  if (gear === undefined) throw new Error('gear_a が無い');
  let clicked = false;
  for (const c of racks) {
    const out = [c.center[0] - gear.center[0], 0, c.center[2] - gear.center[2]];
    const len = Math.hypot(out[0] ?? 0, out[2] ?? 0);
    const n: Vec3 = [(out[0] ?? 0) / len, 0, (out[2] ?? 0) / len];
    const along: Vec3 = [n[2], 0, -n[0]];
    for (const s of [70, -70, 80, -80, 60, -60]) {
      const world: Vec3 = [
        c.center[0] + 4 * n[0] + s * along[0],
        c.center[1],
        c.center[2] + 4 * n[2] + s * along[2],
      ];
      const { p, kind, id } = await pickAt(page, world);
      if (kind !== 'candidate' || id !== String(c.index)) continue;
      await page.mouse.click(p.x, p.y);
      clicked = true;
      break;
    }
    if (clicked) break;
  }
  expect(clicked).toBe(true);
  await expect.poll(async () => Object.keys((await getScene(page)).racks)).toHaveLength(1);
  const rackId = Object.keys((await getScene(page)).racks)[0] as string;
  expect((await getLayout(page)).interferences).toEqual([]);
  await expect
    .poll(async () => Math.abs((await getMotion(page)).rackVelocities[rackId] ?? 0))
    .toBeGreaterThan(0);

  // 端まで待つ → rackEnd のロック
  await expect
    .poll(async () => (await getMotion(page)).locks.map((l) => l.reason), { timeout: 15_000 })
    .toEqual(['rackEnd']);

  // プロパティでモーターの向きを反転 → ロックが解ける
  await clickGear(page, 'gear_a');
  await page.getByTestId('prop-motor-direction').click();
  await expect.poll(async () => (await getScene(page)).motors.motor_a?.direction).toBe(-1);
  await expect.poll(async () => (await getMotion(page)).locks).toEqual([]);
  expect(Math.abs((await getMotion(page)).rackVelocities[rackId] ?? 0)).toBeGreaterThan(0);
});

test('プロパティ: 遊星の数の選択肢で 5 が選べない（z_s 24・z_r 48）。リングの歯数は編集できない', async ({
  page,
}) => {
  await openApp(page, { scene: fixtureScene('planetary-ring-fixed'), camera: PLANETARY_VIEW });
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await page.evaluate(() => window.__gearSim?.select('carrier_k'));
  for (const n of [1, 2, 3, 4, 6]) {
    await expect(page.getByTestId(`prop-planet-count-${n}`)).toBeEnabled();
  }
  await expect(page.getByTestId('prop-planet-count-5')).toBeDisabled();
  await expect(page.getByTestId('prop-planet-count-3')).toHaveAttribute('aria-checked', 'true');
  // 無効のボタンを押しても変わらない
  await page.getByTestId('prop-planet-count-5').click({ force: true });
  expect(
    Object.values((await getScene(page)).shafts).filter((s) => s.placement.kind === 'planet'),
  ).toHaveLength(3);

  // リング: 歯数は表示だけ（入力欄・増減ボタン・選択肢が無い）で、太陽と遊星から決まる旨の注記
  await page.evaluate(() => window.__gearSim?.select('gear_r'));
  await expect(page.getByTestId('prop-ring-teeth')).toHaveText('48 歯');
  await expect(page.getByTestId('prop-ring-note')).toBeVisible();
  await expect(page.getByTestId('prop-teeth')).toHaveCount(0);
  await expect(page.getByTestId('prop-teeth-select')).toHaveCount(0);
  await expect(page.getByTestId('prop-teeth-inc')).toHaveCount(0);
  // 内歯車のウェブの反転は出る
  await expect(page.getByTestId('prop-web-side')).toHaveAttribute('data-web-side', '-1');

  // 太陽: 条件を満たす歯数だけの選択肢（25 は無い）。27 を選ぶとリングが 51 にそろう
  await page.evaluate(() => window.__gearSim?.select('gear_s'));
  const options = await page
    .getByTestId('prop-teeth-select')
    .locator('option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(options).toContain('24');
  expect(options).not.toContain('25');
  await page.getByTestId('prop-teeth-select').selectOption('27');
  await expect.poll(async () => (await getScene(page)).gears.gear_r?.teeth).toBe(51);
});

test('プロパティ: ラックの歯数（10〜60）と内歯車のウェブの向きを変えられる', async ({ page }) => {
  await openApp(page, { scene: showcase });
  await page.evaluate(() => window.__gearSim?.select('rack_r'));
  await page.getByTestId('prop-rack-teeth').fill('36');
  await page.getByTestId('prop-rack-teeth').press('Enter');
  await expect.poll(async () => (await getScene(page)).racks.rack_r?.teeth).toBe(36);
  await page.getByTestId('prop-rack-teeth').fill('99');
  await page.getByTestId('prop-rack-teeth').press('Enter');
  await expect.poll(async () => (await getScene(page)).racks.rack_r?.teeth).toBe(60);
  await expect(page.getByTestId('prop-rack-teeth-inc')).toBeDisabled();

  await page.evaluate(() => window.__gearSim?.select('gear_i'));
  await page.getByTestId('prop-web-flip').click();
  await expect
    .poll(async () => {
      const g = (await getScene(page)).gears.gear_i;
      return g?.kind === 'internal' ? g.webSide : null;
    })
    .toBe(1);
  // 内歯車の歯数（S3-02 の teethRange: 24〜60）
  await expect(page.getByTestId('prop-teeth')).toHaveValue('40');
});

test('stage3-showcase → locks・interferences が空。エクスポート → インポートで等しく、ファイルの version === 3', async ({
  page,
}) => {
  await openApp(page, { scene: showcase });
  expect((await getMotion(page)).locks).toEqual([]);
  expect((await getLayout(page)).interferences).toEqual([]);
  await page.waitForTimeout(500);
  expect((await getMotion(page)).locks).toEqual([]);

  const downloading = page.waitForEvent('download');
  await page.getByTestId('toolbar-export').click();
  const path = await (await downloading).path();
  const file = JSON.parse(readFileSync(path, 'utf8')) as { version: number; scene: Scene };
  expect(file.version).toBe(3);
  expect(file.scene).toEqual(showcase);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), EMPTY);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-import').click();
  await (await chooser).setFiles(path);
  await expect.poll(() => getScene(page)).toEqual(showcase);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('version 2 のファイル（stage2-showcase）をインポート → 読める', async ({ page }) => {
  await openApp(page);
  const v2Path = new URL('../src/core/io/save-file-v2.json', import.meta.url).pathname;
  const v2 = JSON.parse(readFileSync(v2Path, 'utf8')) as { version: number; scene: Scene };
  expect(v2.version).toBe(2);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-import').click();
  await (await chooser).setFiles(v2Path);
  await expect
    .poll(() => getScene(page))
    .toEqual({ ...v2.scene, anchors: {}, carriers: {}, racks: {} });
  expect(await getScene(page)).toEqual(fixtureScene('stage2-showcase'));
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('getAudio().voices に、ラックの組と遊星の組の音源がある', async ({ page }) => {
  await openApp(page, {
    scene: showcase,
    camera: { position: [150, 220, 260] as Vec3, target: [150, 50, 0] as Vec3 },
  });
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  await page.mouse.click(box.x + 10, box.y + 10);
  await expect.poll(async () => (await getAudio(page)).contextState).toBe('running');
  await expect
    .poll(async () => (await getAudio(page)).voices.map((v) => v.key))
    .toContain('gear_q|rack_r');
  const { voices } = await getAudio(page);
  const rack = voices.find((v) => v.key === 'gear_q|rack_r');
  expect(rack?.kind).toBe('rack');
  // v = 20 mm × 3 rpm → |v| / (π·2) = 1 Hz
  expect(rack?.frequency).toBeCloseTo(1, 3);
  const planet = voices.filter((v) => v.key.includes('gear_p'));
  expect(planet.length).toBeGreaterThan(0);
  // 遊星のかみ合いはキャリアに対する相対の回転: 16 Hz
  for (const v of planet) expect(v.frequency).toBeCloseTo(16, 3);
  // 公転とともに音源の位置が動く
  const before = planet[0];
  await page.waitForTimeout(400);
  const after = (await getAudio(page)).voices.find((v) => v.key === before?.key);
  expect(after).toBeDefined();
  if (before === undefined || after === undefined) return;
  expect(
    Math.hypot(after.position[0] - before.position[0], after.position[2] - before.position[2]),
  ).toBeGreaterThan(1);
});
