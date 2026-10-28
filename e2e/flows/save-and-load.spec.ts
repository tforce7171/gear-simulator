import { readFileSync } from 'node:fs';
import { EMPTY, getMotion, getScene, loadScene, waitAutosaved, waitReady } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { buildTwoGearsWithMotor } from './build';

// 通しテスト 2（S1-31）: 組み立てたシーンを保存・自動保存・作品一覧・エクスポートとインポートで行き来する

const WORK_NAME = '通しテスト';

test('保存して読み込む: 作品・自動保存・JSON のどれからも同じシーンに戻り、モーターが回る', async ({
  page,
}) => {
  const parts = await buildTwoGearsWithMotor(page);
  const built = await getScene(page);

  // 「保存」で名前を付けて保存
  await page.getByTestId('toolbar-save').click();
  const save = page.getByTestId('save-dialog');
  await expect(save).toBeVisible();
  await save.getByTestId('save-name').fill(WORK_NAME);
  await save.getByTestId('save-submit').click();
  await expect(save).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__gearSim?.getStorageStatus().currentWorkId))
    .not.toBeNull();

  // 再読み込み → 自動保存から同じシーン
  await waitAutosaved(page);
  await page.reload();
  await waitReady(page);
  expect(await getScene(page)).toEqual(built);

  // 空にしてから、作品一覧で開く
  await loadScene(page, EMPTY);
  await page.getByTestId('toolbar-works').click();
  const works = page.getByTestId('works-dialog');
  await expect(works).toBeVisible();
  const card = works.getByTestId('work-card').filter({ hasText: WORK_NAME });
  await expect(card).toHaveCount(1);
  await card.getByTestId('work-open').click();
  await expect(works).toHaveCount(0);
  expect(await getScene(page)).toEqual(built);

  // エクスポート → 空にする → インポート
  const downloading = page.waitForEvent('download');
  await page.getByTestId('toolbar-export').click();
  const path = await (await downloading).path();
  expect(JSON.parse(readFileSync(path, 'utf8')).scene).toEqual(built);
  await loadScene(page, EMPTY);
  expect(await getScene(page)).toEqual(EMPTY);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-import').click();
  await (await chooser).setFiles(path);
  await expect.poll(() => getScene(page)).toEqual(built);

  const omega = (await getMotion(page)).omegas[parts.firstShaft] ?? 0;
  expect(Math.abs(omega)).toBeGreaterThan(0);
});
