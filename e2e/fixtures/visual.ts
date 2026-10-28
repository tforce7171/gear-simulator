import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { isBlankImage, luminanceVariance } from './blank';
import { nextFrames, setPaused, settleCamera } from './sim';
import { expect } from './test';

const SCREENSHOT_DIR = 'screenshots';

/** 見た目の確認の画面の大きさ（S1-31 でそろえた）。各 spec で test.use({ viewport: VISUAL_VIEWPORT }) */
export const VISUAL_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * 撮る前の準備（S1-31）。Space で一時停止して回転を止め（pause: false なら止めない。ロックの赤は
 * 一時停止中に消えるため）、カメラの動きが終わるのを待ち、止めた後の絵が描かれるまで数フレーム待つ
 */
export async function prepareCapture(page: Page, options: { pause?: boolean } = {}): Promise<void> {
  if (options.pause !== false) await setPaused(page, true);
  await settleCamera(page);
  await nextFrames(page, 3);
}

// screenshots/<name>.png に保存し、isBlankImage でないことを expect する
export async function captureScene(page: Page, name: string): Promise<void> {
  const buffer = await page.screenshot();
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await writeFile(join(SCREENSHOT_DIR, `${name}.png`), buffer);
  const png = PNG.sync.read(buffer);
  expect(
    isBlankImage(png.data),
    `${name}: 真っ黒・真っ白でないこと（輝度の分散 ${luminanceVariance(png.data).toFixed(2)}）`,
  ).toBe(false);
}
