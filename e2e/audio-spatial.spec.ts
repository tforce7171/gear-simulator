import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { AudioState } from '../src/audio/engine';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-26: 音（空間）

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

async function open(page: Page, scene: Scene): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
}

async function getAudio(page: Page): Promise<AudioState> {
  const state = await page.evaluate(() => window.__gearSim?.getAudio());
  if (state === undefined) throw new Error('__gearSim が無い');
  return state;
}

// 描画領域の何もない左上の隅をクリックして音を始める（部品を選ばない）
async function startAudio(page: Page): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  await page.mouse.click(box.x + 10, box.y + 10);
  await expect.poll(async () => (await getAudio(page)).contextState).toBe('running');
}

// chain-22 のかみ合いの接点の x（12, 36, …, 492）のうち、鳴っている組と鳴っていない組
async function splitByX(page: Page): Promise<{ selected: number[]; others: number[] }> {
  const { voices } = await getAudio(page);
  const all = await page.evaluate(() => {
    const sim = window.__gearSim;
    if (sim === undefined) return [];
    const layout = sim.getLayout();
    return layout.meshes.map((m) => {
      const a = layout.gears[m.a];
      const b = layout.gears[m.b];
      return { a: m.a, b: m.b, x: ((a?.center[0] ?? 0) + (b?.center[0] ?? 0)) / 2 };
    });
  });
  const keys = new Set(voices.map((v) => v.key));
  const selected = voices.map((v) => v.position[0]);
  const others = all
    .filter((m) => !keys.has(m.a <= m.b ? `${m.a}|${m.b}` : `${m.b}|${m.a}`))
    .map((m) => m.x);
  return { selected, others };
}

test('chain-22 では 16 組を個別に鳴らし、残りは背景のうなりになる', async ({ page }) => {
  await open(page, fixture('chain-22'));
  await startAudio(page);
  await expect.poll(async () => (await getAudio(page)).voices.length).toBe(16);
  const { background } = await getAudio(page);
  expect(background).not.toBeNull();
  expect(background?.level).toBeGreaterThan(0);
  expect(background?.level).toBeLessThanOrEqual(0.5);
  // 24 Hz の組だけなので、周波数は下限の 30 Hz
  expect(background?.frequency).toBeCloseTo(30, 6);
});

test('カメラを列の左端に寄せると左の 16 組、右端に寄せると右の 16 組が鳴る', async ({ page }) => {
  await open(page, fixture('chain-22'));
  await startAudio(page);
  await expect.poll(async () => (await getAudio(page)).voices.length).toBe(16);

  await page.evaluate(() =>
    window.__gearSim?.setCamera({ position: [0, 150, 150], target: [0, 20, 0] }),
  );
  await expect
    .poll(async () => {
      const { selected, others } = await splitByX(page);
      return (
        selected.length === 16 && others.length === 5 && Math.max(...selected) < Math.min(...others)
      );
    })
    .toBe(true);

  await page.evaluate(() =>
    window.__gearSim?.setCamera({ position: [504, 150, 150], target: [504, 20, 0] }),
  );
  await expect
    .poll(async () => {
      const { selected, others } = await splitByX(page);
      return (
        selected.length === 16 && others.length === 5 && Math.min(...selected) > Math.max(...others)
      );
    })
    .toBe(true);
  // 接点は歯車の中心と同じ高さ（列の上）
  const y = await page.evaluate(() => window.__gearSim?.getLayout().gears.gear_c01?.center[1]);
  for (const v of (await getAudio(page)).voices) expect(v.position[1]).toBeCloseTo(y ?? 0, 6);
});

test('互いに逆に回そうとする 2 つのモーターでロックすると、衝撃音が 1 回鳴り、ロック中はガタガタ鳴る', async ({
  page,
}) => {
  await open(page, fixture('lock-opposed'));
  await startAudio(page);
  await expect.poll(async () => (await getAudio(page)).lockSounds.rattling.length).toBe(1);
  expect((await getAudio(page)).lockSounds.impacts).toBe(1);
  // 続いても衝撃音は増えない
  await page.waitForTimeout(300);
  expect((await getAudio(page)).lockSounds).toEqual({
    impacts: 1,
    rattling: ['stalemate:shaft_1,shaft_2'],
    rackHits: 0,
  });

  await page.evaluate(() =>
    window.__gearSim?.dispatch({ type: 'updateMotor', motorId: 'motor_2', patch: { on: false } }),
  );
  await expect.poll(async () => (await getAudio(page)).lockSounds.rattling).toEqual([]);
  expect((await getAudio(page)).lockSounds.impacts).toBe(1);
});

test('小と大のモーターを逆向きにつなぐと、大が勝ち、負けた小がきしむ', async ({ page }) => {
  await open(page, fixture('back-driven'));
  await startAudio(page);
  await expect.poll(async () => (await getAudio(page)).motors.length).toBe(2);
  const motion = await page.evaluate(() => window.__gearSim?.getMotion());
  expect(motion?.backDriven).toEqual(['motor_1']);
  const { motors } = await getAudio(page);
  const small = motors.find((m) => m.motorId === 'motor_1');
  const large = motors.find((m) => m.motorId === 'motor_2');
  expect(small?.strain).toBeCloseTo(1.22, 2);
  expect(small?.grind).toBeCloseTo(0.22, 2);
  expect(large?.grind).toBe(0);
});

test('Space で一時停止すると、モーターの音もかみ合いの音も止まる', async ({ page }) => {
  await open(page, fixture('back-driven'));
  await startAudio(page);
  await expect.poll(async () => (await getAudio(page)).motors.length).toBe(2);
  expect((await getAudio(page)).voices.length).toBe(1);
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => window.__gearSim?.isPaused())).toBe(true);
  await expect.poll(async () => (await getAudio(page)).motors).toEqual([]);
  expect((await getAudio(page)).voices).toEqual([]);
  expect((await getAudio(page)).background).toBeNull();
});
