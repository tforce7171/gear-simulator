import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/math/vec3';
import type { Scene } from '../../src/core/scene/types';
import { test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

// S1-22: ロック（脈打つ赤）と干渉（一定の赤）を人が画像で見比べるための画面

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

async function open(page: Page, scene: Scene, pose: { position: Vec3; target: Vec3 }) {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
  await page.evaluate((p) => window.__gearSim?.setCamera(p), pose);
  await page.waitForTimeout(200);
}

test('ロックした 2 枚（lock-opposed）', async ({ page }) => {
  // 2 枚の中心は [0, 4, 0] と [0, 4, 40]（中・20 歯）
  await open(page, fixture('lock-opposed'), {
    position: [70, 110, 90],
    target: [0, 4, 20],
  });
  await captureScene(page, 'lock-red');
});

test('干渉している 2 枚（overlap）', async ({ page }) => {
  await open(page, fixture('overlap'), {
    position: [40, 80, 50],
    target: [5, 20, 0],
  });
  await captureScene(page, 'interference');
});
