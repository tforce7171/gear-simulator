import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { interpolate } from '../src/core/i18n';
import { ja } from '../src/core/i18n/ja';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-28: JSON のエクスポートとインポート

const fixture = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).pathname;
const sceneA = JSON.parse(readFileSync(fixture('scene-a.json'), 'utf8')) as Scene;
const EMPTY: Scene = { shafts: {}, gears: {}, motors: {}, anchors: {}, carriers: {} };

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
}

async function loadScene(page: Page, scene: Scene): Promise<void> {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
}

async function getScene(page: Page): Promise<Scene> {
  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  if (scene === undefined) throw new Error('__gearSim が無い');
  return scene;
}

type FileSpec = string | { name: string; mimeType: string; buffer: Buffer };

// 「インポート」→ ファイル選択の画面でファイルを渡す
async function importFile(page: Page, file: FileSpec): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-import').click();
  await (await chooser).setFiles(file);
}

test('エクスポートしたファイルをインポートすると同じシーンに戻り、Ctrl+Z で読み込む前に戻る', async ({
  page,
}) => {
  await open(page);
  await loadScene(page, sceneA);
  const downloading = page.waitForEvent('download');
  await page.getByTestId('toolbar-export').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^gear-simulator-\d{8}-\d{6}\.json$/);
  const path = await download.path();
  const text = readFileSync(path, 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  const file = JSON.parse(text);
  expect(file.format).toBe('gear-simulator');
  expect(file.version).toBe(2); // S2-05 から最新は 2
  expect(file.scene).toEqual(sceneA);

  await loadScene(page, EMPTY);
  expect(await getScene(page)).toEqual(EMPTY);
  await importFile(page, path);
  await expect.poll(() => getScene(page)).toEqual(sceneA);
  await expect(page.getByTestId('toast')).toHaveCount(0);

  await page.keyboard.press('Control+z');
  expect(await getScene(page)).toEqual(EMPTY);
});

test('歯数が範囲外のファイルは、歯数の範囲の文言のトーストを出し、シーンを変えない', async ({
  page,
}) => {
  await open(page);
  await loadScene(page, sceneA);
  await importFile(page, fixture('invalid-teeth.json'));
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-kind', 'error');
  await expect(toast).toContainText(
    interpolate(ja['import.error.invalidScene.teeth'], { path: 'gears.gear_g1.teeth' }),
  );
  await expect(toast).toContainText('歯数');
  await expect(toast).toContainText('範囲');
  expect(await getScene(page)).toEqual(sceneA);
});

test('新しすぎるバージョンのファイルは、新しいバージョンの文言', async ({ page }) => {
  await open(page);
  await loadScene(page, sceneA);
  await importFile(page, fixture('future-version.json'));
  await expect(page.getByTestId('toast')).toContainText(ja['import.error.unsupportedVersion']);
  expect(await getScene(page)).toEqual(sceneA);
});

test('中身が not json のファイルは、読めないファイルの文言', async ({ page }) => {
  await open(page);
  await loadScene(page, sceneA);
  await importFile(page, {
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not json'),
  });
  await expect(page.getByTestId('toast')).toContainText(ja['import.error.invalidJson']);
  expect(await getScene(page)).toEqual(sceneA);
});

test('他のアプリのファイルは、このアプリのファイルではない文言', async ({ page }) => {
  await open(page);
  await loadScene(page, sceneA);
  await importFile(page, {
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"other","version":1}'),
  });
  await expect(page.getByTestId('toast')).toContainText(ja['import.error.notGearSimulator']);
  expect(await getScene(page)).toEqual(sceneA);
});

test('ファイル選択は .json と application/json だけを受け付ける', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('import-file')).toHaveAttribute('accept', '.json,application/json');
  await expect(page.getByTestId('toolbar-export')).toBeEnabled();
  await expect(page.getByTestId('toolbar-import')).toBeEnabled();
});

test('自動保存が壊れていると、空のシーンで起動し、復元できなかったトーストが出る', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('gear-simulator', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('autosave', 'readwrite');
          tx.objectStore('autosave').put(
            { updatedAt: 0, file: { format: 'gear-simulator', version: 1, scene: { shafts: 1 } } },
            'current',
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  expect(await getScene(page)).toEqual(EMPTY);
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  const lang = await page.evaluate(() => window.__gearSim?.getLanguage());
  const { en } = await import('../src/core/i18n/en');
  await expect(toast).toContainText(
    lang === 'ja' ? ja['storage.restoreFailed'] : en['storage.restoreFailed'],
  );
});
