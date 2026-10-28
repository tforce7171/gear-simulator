import type { Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/math/vec3';
import type { ThemeId } from '../../src/core/theme';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S2-05: 段階 2 の歯車を両テーマで撮る（全体・種類ごとの拡大）。ウォームの組のギア比の情報表示と、
// パレットとプロパティパネルの日本語・英語。ウォーム（鋼）とホイール（青銅）が他と見分けられ、浮いて見えないかは
// 人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

const showcase = fixtureScene('stage2-showcase');
const THEMES: readonly ThemeId[] = ['brass', 'wood'];

// stage2-showcase のかみ合いの接点（core/audio-model の meshContactPoint）と、そこから寄る向き
const CLOSEUPS: ReadonlyArray<{ name: string; contact: Vec3; direction: Vec3 }> = [
  // ハスバ A（縦軸、中心 [0, 48, 0]）と B（[0, 48, 40]）。横（+x）の少し上から
  { name: 'helical', contact: [0, 48, 20], direction: [1, 0.5, 0.15] },
  // かさ歯車 A（縦軸、[0, 64, 0]）と B（軸 z、[0, 80, −16]）。斜め前（+x）の少し上から
  { name: 'bevel', contact: [0, 78.1, -14.1], direction: [1, 0.35, 0.45] },
  // ウォーム（軸 z、[0, 80, −68]）とホイール（軸 x、[0, 40, −68]）。ホイールの面の側（+x）の斜め上から
  { name: 'worm', contact: [0, 70, -68], direction: [1, 0.45, 0.6] },
  // ねじ歯車 A（軸 x、[−32, 40, −68]）と B（縦軸、[−32, 40, −108]）。外側（−x）の少し上から
  { name: 'crossed-helical', contact: [-32, 40, -88], direction: [-1, 0.55, 0.25] },
];
const CLOSEUP_DISTANCE = 70;

function closeup(contact: Vec3, direction: Vec3): { position: Vec3; target: Vec3 } {
  const k = CLOSEUP_DISTANCE / Math.hypot(...direction);
  return {
    position: [
      contact[0] + direction[0] * k,
      contact[1] + direction[1] * k,
      contact[2] + direction[2] * k,
    ],
    target: contact,
  };
}

async function setTheme(page: Page, theme: ThemeId): Promise<void> {
  await page.evaluate(
    (t) => window.__gearSim?.updateSettings({ theme: t, quality: 'high' }),
    theme,
  );
}

// 木目のテクスチャ・影・環境マップの描画がソフトウェア描画では重いので、場面ごとに別のテストにする
for (const theme of THEMES) {
  test(`stage2-showcase-${theme}（全体）`, async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page, { scene: showcase });
    await setTheme(page, theme);
    await page.keyboard.press('Home');
    await prepareCapture(page);
    await captureScene(page, `stage2-showcase-${theme}`);
  });

  for (const shot of CLOSEUPS) {
    test(`stage2-${shot.name}-${theme}（拡大）`, async ({ page }) => {
      test.setTimeout(90_000);
      await openApp(page, { scene: showcase });
      await setTheme(page, theme);
      await setCamera(page, closeup(shot.contact, shot.direction));
      await prepareCapture(page);
      await captureScene(page, `stage2-${shot.name}-${theme}`);
    });
  }
}

test('stage2-info-worm（情報表示 ON でウォームの組のギア比）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: fixtureScene('worm-basic') });
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await page.getByTestId('toolbar-info').click();
  await setCamera(page, { position: [120, 110, 190], target: [16, 55, 0] });
  const worm = page.locator('[data-testid="info-label"][data-gear-id="gear_h"]');
  await expect(worm.getByTestId('info-label-worm')).toHaveText('ウォーム比 30:1');
  await expect(
    page
      .locator('[data-testid="info-label"][data-gear-id="gear_w"]')
      .getByTestId('info-label-worm'),
  ).toHaveText('ウォーム比 30:1');
  // 回転の矢印も写すので止めない
  await prepareCapture(page, { pause: false });
  await captureScene(page, 'stage2-info-worm');
});

// パレットで種類を選び、かさ歯車を選んだ状態（種類の名前・注記・向きを反転のボタン）
for (const lang of ['ja', 'en'] as const) {
  test(`stage2-ui-${lang}（パレットとプロパティパネル）`, async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page, { scene: showcase });
    await page.evaluate((l) => window.__gearSim?.setLanguage(l), lang);
    await page.getByTestId('palette-kind-worm').click();
    await page.evaluate(() => window.__gearSim?.select('gear_bevel_a'));
    await expect(page.getByTestId('prop-bevel-flip')).toBeVisible();
    await page.keyboard.press('Home');
    await prepareCapture(page);
    await captureScene(page, `stage2-ui-${lang}`);
  });
}
