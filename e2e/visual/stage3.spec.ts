import type { Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/math/vec3';
import type { ThemeId } from '../../src/core/theme';
import { fixtureScene, getLayout, openApp, setCamera } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S3-05: 段階 3 の部品を両テーマで撮る（stage3-showcase の全体、遊星歯車機構・ラック・固定具の拡大）。
// キャリアの rpm とラックの速度の情報表示と、キャリア・ラックのプロパティパネルの日本語・英語。
// 固定具（黒い鉄・濃い木）やキャリア（鋼）が他の部品と見分けられるかは、人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

const showcase = fixtureScene('stage3-showcase');
const THEMES: readonly ThemeId[] = ['brass', 'wood'];

// 遊星歯車機構（太陽 [0, 64, 0]、リングのウェブは下）を開いている側（上）から斜めに、ラック（基準位置 [300, 40, 20]、
// 歯が上向き）を正面（+z）の少し上から、リングの固定具（リングのシャフトの下の端の台座と、床までの支柱）を斜め横から
const CLOSEUPS: ReadonlyArray<{ name: string; position: Vec3; target: Vec3 }> = [
  { name: 'planetary', position: [70, 175, 95], target: [0, 64, 0] },
  { name: 'rack', position: [340, 80, 140], target: [300, 45, 20] },
  { name: 'anchor', position: [80, 55, 95], target: [0, 28, 0] },
];

async function setTheme(page: Page, theme: ThemeId): Promise<void> {
  await page.evaluate(
    (t) => window.__gearSim?.updateSettings({ theme: t, quality: 'high' }),
    theme,
  );
}

// 木目のテクスチャ・影・環境マップの描画がソフトウェア描画では重いので、場面ごとに別のテストにする
for (const theme of THEMES) {
  test(`stage3-showcase-${theme}（全体）`, async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page, { scene: showcase });
    await setTheme(page, theme);
    await page.keyboard.press('Home');
    await prepareCapture(page);
    await captureScene(page, `stage3-showcase-${theme}`);
  });

  for (const shot of CLOSEUPS) {
    test(`stage3-${shot.name}-${theme}（拡大）`, async ({ page }) => {
      test.setTimeout(90_000);
      await openApp(page, { scene: showcase });
      await setTheme(page, theme);
      await setCamera(page, { position: shot.position, target: shot.target });
      await prepareCapture(page);
      await captureScene(page, `stage3-${shot.name}-${theme}`);
    });
  }
}

test('stage3-info（情報表示 ON。キャリアの rpm、ラックの速度と向き）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: showcase });
  await page.evaluate(() => window.__gearSim?.setLanguage('ja'));
  await page.getByTestId('toolbar-info').click();
  await page.keyboard.press('Home');
  const carrier = page.locator('[data-testid="info-label"][data-part-id="carrier_k"]');
  await expect(carrier.getByTestId('info-label-main')).toHaveText('20.0 rpm');
  const rack = page.locator('[data-testid="info-label"][data-part-id="rack_r"]');
  // v = 20 mm × 3 rpm × 2π / 60
  await expect(rack.getByTestId('info-label-main')).toHaveText(
    `${((20 * 3 * 2 * Math.PI) / 60).toFixed(1)} mm/s`,
  );
  await expect(rack.getByTestId('info-label-arrow')).toBeVisible();
  // 遊星は自転の rpm（シャフトの ω。60 rpm）
  await expect(
    page
      .locator('[data-testid="info-label"][data-gear-id="gear_p0"]')
      .getByTestId('info-label-main'),
  ).toHaveText('60.0 rpm');
  // 回転の矢印も写すので止めない
  await prepareCapture(page, { pause: false });
  await captureScene(page, 'stage3-info');
});

// キャリアを選んだ状態（遊星の数の選択肢・固定する）と、ラックを選んだ状態（歯数・固定する）
for (const lang of ['ja', 'en'] as const) {
  test(`stage3-ui-${lang}（キャリアとラックのプロパティパネル）`, async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page, { scene: showcase });
    await page.evaluate((l) => window.__gearSim?.setLanguage(l), lang);
    const plate = (await getLayout(page)).carriers.carrier_k?.center ?? [0, 74, 0];
    await setCamera(page, {
      position: [plate[0] + 90, plate[1] + 120, plate[2] + 150],
      target: plate,
    });
    await page.evaluate(() => window.__gearSim?.select('carrier_k'));
    await expect(page.getByTestId('prop-planet-count-5')).toBeDisabled();
    await expect(page.getByTestId('prop-anchor-check')).toBeVisible();
    await prepareCapture(page);
    await captureScene(page, `stage3-ui-${lang}`);

    await page.evaluate(() => window.__gearSim?.select('rack_r'));
    await expect(page.getByTestId('prop-rack-teeth')).toHaveValue('40');
    await setCamera(page, { position: [340, 80, 140], target: [300, 45, 20] });
    await prepareCapture(page);
    await captureScene(page, `stage3-ui-rack-${lang}`);
  });
}
