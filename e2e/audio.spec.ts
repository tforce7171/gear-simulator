import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-25: 音（基本）

type AudioState = {
  contextState: string;
  muted: boolean;
  material: 'metal' | 'wood';
  voices: Array<{ key: string; frequency: number; click: number; tone: number }>;
};
// S1-26 で getAudio に足した中身（background・motors・lockSounds、voices の position）は audio-spatial.spec.ts で確かめる

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

// シーン A（S1-23）のモーターを 120 rpm にしたもの: g1|g2 は 12 枚 × 2 回転/秒 = 24 Hz、
// g2|g3 は 36 枚 × 2/3 回転/秒 = 24 Hz（どちらもクロスフェードの範囲）
function sceneA120(): Scene {
  const scene = fixture('scene-a');
  const motor = scene.motors.motor_m1;
  if (motor === undefined) throw new Error('motor_m1 が無い');
  return { ...scene, motors: { motor_m1: { ...motor, rpm: 120 } } };
}

async function open(page: Page, scene?: Scene): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  if (scene !== undefined) await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
}

async function getAudio(page: Page): Promise<AudioState> {
  const state = await page.evaluate(() => window.__gearSim?.getAudio());
  if (state === undefined) throw new Error('__gearSim が無い');
  return state;
}

// 描画領域の何もない左上の隅をクリックする（部品を選ばない）
async function clickCanvas(page: Page): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  await page.mouse.click(box.x + 10, box.y + 10);
}

test('起動直後は AudioContext を作らない。キャンバスをクリックすると running になる', async ({
  page,
}) => {
  await open(page);
  // 何フレームか回しても作らない
  await page.waitForTimeout(300);
  expect((await getAudio(page)).contextState).toBe('none');
  await clickCanvas(page);
  await expect.poll(async () => (await getAudio(page)).contextState).toBe('running');
  expect((await getAudio(page)).material).toBe('metal');
});

test('キー入力でも音を開始する', async ({ page }) => {
  await open(page);
  expect((await getAudio(page)).contextState).toBe('none');
  await page.keyboard.press('Shift');
  await expect.poll(async () => (await getAudio(page)).contextState).toBe('running');
});

test('シーン A を 120 rpm で回すと 2 組が鳴り、g1|g2 は 24 Hz でクロスフェード', async ({
  page,
}) => {
  await open(page, sceneA120());
  await clickCanvas(page);
  await expect.poll(async () => (await getAudio(page)).contextState).toBe('running');
  await expect.poll(async () => (await getAudio(page)).voices.length).toBe(2);
  const { voices } = await getAudio(page);
  const g12 = voices.find((v) => v.key === 'gear_g1|gear_g2');
  expect(g12).toBeDefined();
  expect(g12?.frequency).toBeCloseTo(24, 3);
  expect(g12?.click).toBeCloseTo(0.588, 2);
  expect(g12?.tone).toBeCloseTo(0.809, 2);
  expect(voices.map((v) => v.key).sort()).toEqual(['gear_g1|gear_g2', 'gear_g2|gear_g3']);
});

test('M でミュートが切り替わり、ツールバーのボタンが aria-pressed で示す。ボタンでも切り替わる', async ({
  page,
}) => {
  await open(page);
  const button = page.getByTestId('toolbar-mute');
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect((await getAudio(page)).muted).toBe(false);

  await page.keyboard.press('m');
  expect((await getAudio(page)).muted).toBe(true);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // ミュート中でも AudioContext は作る（主音量 0 で動かす）
  await expect.poll(async () => (await getAudio(page)).contextState).toBe('running');

  await page.keyboard.press('m');
  expect((await getAudio(page)).muted).toBe(false);
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  await button.click();
  expect((await getAudio(page)).muted).toBe(true);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  expect((await getAudio(page)).muted).toBe(false);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('21 組のかみ合いが回るシーン（chain-22）では 16 組だけ鳴らす', async ({ page }) => {
  await open(page, fixture('chain-22'));
  const meshes = await page.evaluate(() => window.__gearSim?.getLayout().meshes.length);
  expect(meshes).toBe(21);
  await clickCanvas(page);
  await expect.poll(async () => (await getAudio(page)).contextState).toBe('running');
  await expect.poll(async () => (await getAudio(page)).voices.length).toBe(16);
  const { voices } = await getAudio(page);
  // カメラに近い 16 組（S1-26）。小・24 枚・60 rpm なので、どれも 24 Hz
  for (const v of voices) expect(v.frequency).toBeCloseTo(24, 3);
  expect(new Set(voices.map((v) => v.key)).size).toBe(16);
});

test('一時停止中は鳴らす組が無い', async ({ page }) => {
  await open(page, sceneA120());
  await clickCanvas(page);
  await expect.poll(async () => (await getAudio(page)).voices.length).toBe(2);
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => window.__gearSim?.isPaused())).toBe(true);
  await expect.poll(async () => (await getAudio(page)).voices.length).toBe(0);
});
