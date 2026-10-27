import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { isBlankImage, luminanceVariance } from './blank';
import { expect } from './test';

const SCREENSHOT_DIR = 'screenshots';

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
