import type { Page } from '@playwright/test';
import type { SpurGear } from '../src/core/scene/types';
import { clickGear, fixtureScene, getMotion, getScene, openApp } from './fixtures/sim';
import { expect, test } from './fixtures/test';

// S5-05: 欠け歯車でラックを往復させる。見本「ラック往復」（e2e/fixtures/rack-reciprocation.json と同じ）は、
// 横 z の起点 shaft_s に欠け歯車 A（gear_a、小・39 歯のうち 8 歯）と B（gear_b、13 歯のうち 8 歯）、
// B の下に中間歯車（gear_idler、13 歯）、A の下にラック rack_r（厚さ 14 mm）。モーター 60 rpm（ON）

test.use({ locale: 'ja-JP' });

const reciprocation = fixtureScene('rack-reciprocation');

// 正面（+z の側）から見る
const VIEW = {
  position: [0, 30, 220] as [number, number, number],
  target: [0, 30, 6] as [number, number, number],
};

async function rackPosition(page: Page): Promise<number> {
  return (await getMotion(page)).rackPositions.rack_r ?? 0;
}

test('作品一覧の見本「ラック往復」を開いてモーターを回す → ラックが増えて減ることをくり返し、ロックがない', async ({
  page,
}) => {
  await openApp(page);
  await page.getByTestId('toolbar-works').click();
  const dialog = page.getByTestId('works-dialog');
  await expect(dialog).toBeVisible();
  const card = dialog.locator('[data-testid="sample-card"][data-sample-id="rackReciprocation"]');
  await expect(card.getByTestId('sample-name')).toHaveText('ラック往復');
  await card.getByTestId('sample-open').click();
  await expect(dialog).toHaveCount(0);
  expect(await getScene(page)).toEqual(reciprocation);

  // 増えて減る、を 2 回くり返すまで見る（向きが変わるたびに数える）
  let lastSign = 0;
  let turns = 0;
  let prev = await rackPosition(page);
  await expect
    .poll(
      async () => {
        const motion = await getMotion(page);
        expect(motion.locks).toEqual([]);
        const s = motion.rackPositions.rack_r ?? 0;
        const sign = Math.sign(s - prev);
        prev = s;
        if (sign !== 0 && sign !== lastSign) {
          if (lastSign !== 0) turns++;
          lastSign = sign;
        }
        return turns;
      },
      { timeout: 20_000, intervals: [50] },
    )
    .toBeGreaterThanOrEqual(4);
  expect((await getMotion(page)).locks).toEqual([]);

  // Undo で開く前の（空の）シーンに戻る
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Object.keys((await getScene(page)).gears).length).toBe(0);
});

test('平歯車を選び、「残す歯数」の［−］を押す → toothCount が 1 減る。「歯の位置」の［＋］で toothStart が 1 増える', async ({
  page,
}) => {
  await openApp(page, { scene: reciprocation, camera: VIEW });
  await clickGear(page, 'gear_idler');
  const gear = async (): Promise<SpurGear> => (await getScene(page)).gears.gear_idler as SpurGear;
  await expect(page.getByTestId('prop-tooth-count')).toHaveValue('13');
  await expect(page.getByTestId('prop-tooth-arc-note')).toBeVisible();
  await page.getByTestId('prop-tooth-count-dec').click();
  await expect.poll(async () => (await gear()).toothCount).toBe(12);
  await expect(page.getByTestId('prop-tooth-count')).toHaveValue('12');
  await page.getByTestId('prop-tooth-start-inc').click();
  await expect.poll(async () => (await gear()).toothStart).toBe(1);
  // Undo で 1 つずつ戻る
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await gear()).toothStart).toBeUndefined();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await gear()).toothCount).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await gear()).toothCount).toBe(12);
});

test('かみ合い直す瞬間に位相が合わない配置 → toothClash でロックし、情報表示に「歯が合わない」と出る', async ({
  page,
}) => {
  // B の歯の位置を 0 にすると、回転角 0 で B も A もかかっておらず、B は弧の端に来るまでの間に中間歯車と位相がずれる
  // （ラックは止まったまま B だけが 1.25 歯ぶん回る）ので、B がかかり始める瞬間にロックする
  const clash = {
    ...reciprocation,
    gears: {
      ...reciprocation.gears,
      gear_b: { ...(reciprocation.gears.gear_b as SpurGear), toothStart: 0 },
    },
  };
  await openApp(page, { scene: clash, camera: VIEW });
  await page.getByTestId('toolbar-info').click();
  await expect
    .poll(async () => (await getMotion(page)).locks.map((l) => l.reason), { timeout: 15_000 })
    .toEqual(['toothClash']);
  const label = page.locator('[data-testid="info-label"][data-part-id="rack_r"]');
  await expect(label.getByTestId('info-label-lock')).toHaveText('歯が合わない');
});
