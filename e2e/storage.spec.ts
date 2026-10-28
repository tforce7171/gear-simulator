import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

// S1-27: 保存（IndexedDB）

const sceneA = JSON.parse(
  readFileSync(new URL('./fixtures/scene-a.json', import.meta.url), 'utf8'),
) as Scene;
const EMPTY: Scene = { shafts: {}, gears: {}, motors: {}, anchors: {} };

type StorageStatus = {
  lastAutosaveAt: number | null;
  pendingAutosave: boolean;
  currentWorkId: string | null;
};

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
}

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await waitReady(page);
}

async function loadScene(page: Page, scene: Scene): Promise<void> {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
}

async function getScene(page: Page): Promise<Scene> {
  const scene = await page.evaluate(() => window.__gearSim?.getScene());
  if (scene === undefined) throw new Error('__gearSim が無い');
  return scene;
}

async function status(page: Page): Promise<StorageStatus> {
  const s = await page.evaluate(() => window.__gearSim?.getStorageStatus());
  if (s === undefined) throw new Error('__gearSim が無い');
  return s;
}

async function waitAutosaved(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__gearSim?.getStorageStatus();
    return s !== undefined && !s.pendingAutosave && s.lastAutosaveAt !== null;
  });
}

// 「保存」→ 名前を入れて保存（いま開いている作品が無いとき）
async function saveNew(page: Page, name: string): Promise<void> {
  await page.getByTestId('toolbar-save').click();
  const dialog = page.getByTestId('save-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('save-name').fill(name);
  await dialog.getByTestId('save-submit').click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await status(page)).currentWorkId).not.toBeNull();
}

async function openWorks(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await page.getByTestId('toolbar-works').click();
  const dialog = page.getByTestId('works-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('自動保存したシーンで、再読み込みのあとに始まる', async ({ page }) => {
  await open(page);
  await loadScene(page, sceneA);
  expect((await status(page)).pendingAutosave).toBe(true);
  await waitAutosaved(page);
  await page.reload();
  await waitReady(page);
  expect(await getScene(page)).toEqual(sceneA);
  // 履歴は空（Undo しても変わらない）
  await page.evaluate(() => window.__gearSim?.undo());
  expect(await getScene(page)).toEqual(sceneA);
});

test('何も保存されていなければ空のシーンで始まり、トーストは出ない', async ({ page }) => {
  await open(page);
  expect(await getScene(page)).toEqual(EMPTY);
  expect(await status(page)).toEqual({
    lastAutosaveAt: null,
    pendingAutosave: false,
    currentWorkId: null,
  });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('作品を保存して、別のシーンにしてから一覧で開き、Undo で戻す', async ({ page }) => {
  await open(page);
  await loadScene(page, sceneA);
  await saveNew(page, 'テスト作品');
  await loadScene(page, EMPTY);
  const dialog = await openWorks(page);
  const cards = dialog.getByTestId('work-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByTestId('work-name')).toHaveText('テスト作品');
  await expect(cards.getByTestId('work-date')).not.toBeEmpty();
  const img = cards.getByTestId('work-thumbnail');
  await expect
    .poll(() =>
      img.evaluate((el) => {
        const i = el as HTMLImageElement;
        return i.complete ? [i.naturalWidth, i.naturalHeight] : null;
      }),
    )
    .toEqual([256, 256]);
  await cards.getByTestId('work-open').click();
  await expect(dialog).toHaveCount(0);
  expect(await getScene(page)).toEqual(sceneA);
  await page.locator('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  expect(await getScene(page)).toEqual(EMPTY);
});

test('上書き保存は 1 枚のまま更新日時が新しくなり、新しい作品として保存すると 2 枚で新しいほうが先頭', async ({
  page,
}) => {
  await open(page);
  await loadScene(page, sceneA);
  await saveNew(page, '一枚目');
  let dialog = await openWorks(page);
  const before = Number(await dialog.getByTestId('work-card').getAttribute('data-updated-at'));
  await dialog.getByTestId('work-open').click();
  await expect(dialog).toHaveCount(0);

  // 歯数を変えて上書き保存
  await page.evaluate(() =>
    window.__gearSim?.dispatch({ type: 'setGearTeeth', gearId: 'gear_g2', teeth: 30 }),
  );
  await page.getByTestId('toolbar-save').click();
  let save = page.getByTestId('save-dialog');
  await expect(save.getByTestId('save-name')).toHaveValue('一枚目');
  await save.getByTestId('save-overwrite').click();
  await expect(save).toHaveCount(0);

  dialog = await openWorks(page);
  const cards = dialog.getByTestId('work-card');
  await expect(cards).toHaveCount(1);
  const after = Number(await cards.getAttribute('data-updated-at'));
  expect(after).toBeGreaterThan(before);
  await dialog.getByTestId('works-close').click();
  await expect(dialog).toHaveCount(0);

  // 新しい作品として保存
  const firstId = (await status(page)).currentWorkId;
  await page.getByTestId('toolbar-save').click();
  save = page.getByTestId('save-dialog');
  await save.getByTestId('save-name').fill('二枚目');
  await save.getByTestId('save-as-new').click();
  await expect(save).toHaveCount(0);
  await expect.poll(async () => (await status(page)).currentWorkId).not.toBe(firstId);
  expect((await status(page)).currentWorkId).not.toBeNull();

  dialog = await openWorks(page);
  await expect(dialog.getByTestId('work-card')).toHaveCount(2);
  await expect(dialog.getByTestId('work-name')).toHaveText(['二枚目', '一枚目']);
});

test('名前を変えて開き直すと新しい名前、削除して確かめると一覧が空になる', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await loadScene(page, sceneA);
  await saveNew(page, 'テスト作品');
  let dialog = await openWorks(page);
  await dialog.getByTestId('work-rename').click();
  const input = dialog.getByTestId('work-rename-input');
  await input.fill('別の名前');
  await input.press('Enter');
  await expect(dialog.getByTestId('work-name')).toHaveText('別の名前');
  await dialog.getByTestId('works-close').click();
  await expect(dialog).toHaveCount(0);

  dialog = await openWorks(page);
  await expect(dialog.getByTestId('work-name')).toHaveText('別の名前');
  await dialog.getByTestId('work-delete').click();
  // 確認するまでは消えない
  await expect(dialog.getByTestId('work-card')).toHaveCount(1);
  await dialog.getByTestId('work-delete-yes').click();
  await expect(dialog.getByTestId('work-card')).toHaveCount(0);
  await expect(dialog.getByTestId('works-empty')).toHaveText('保存した作品はまだない');
  // いま開いている作品を消したので、なしになる（シーンはそのまま）
  expect((await status(page)).currentWorkId).toBeNull();
  expect(await getScene(page)).toEqual(sceneA);
});

test('IndexedDB を使えなくても起動でき、「保存」でエラーのトーストが出る', async ({ page }) => {
  await page.addInitScript(() => {
    // biome-ignore lint/suspicious/noExplicitAny: テスト用に IndexedDB を壊す
    (indexedDB as any).open = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
  await open(page);
  expect(await getScene(page)).toEqual(EMPTY);
  await loadScene(page, sceneA);
  await page.getByTestId('toolbar-save').click();
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-kind', 'error');
  await expect(page.getByTestId('save-dialog')).toHaveCount(0);
  await page.getByTestId('toolbar-works').click();
  await expect(toast).toHaveCount(2);
  // 自動保存は止まっている
  await page.waitForTimeout(1200);
  expect(await status(page)).toMatchObject({ lastAutosaveAt: null, pendingAutosave: false });
});
