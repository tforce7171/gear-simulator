import type { Page } from '@playwright/test';
import { en } from '../src/core/i18n/en';
import { ja } from '../src/core/i18n/ja';
import { openWithPausedClock } from './fixtures/sim';
import { expect, test } from './fixtures/test';

test.use({ locale: 'ja-JP' });

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
}

test('エラーのトーストが出て、言語の切り替えで書き換わり、閉じるボタンで消える', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() =>
    import('/src/ui/toast.ts').then((m) => {
      m.showToast('app.title', 'error');
    }),
  );
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-kind', 'error');
  await expect(toast).toHaveAttribute('role', 'alert');
  await expect(toast.getByTestId('toast-message')).toHaveText(ja['app.title']);
  const close = toast.getByTestId('toast-close');
  await expect(close).toHaveAttribute('aria-label', ja['toast.close']);
  await expect(close).toHaveAttribute('title', ja['toast.close']);

  await page.evaluate(() => window.__gearSim?.setLanguage('en'));
  await expect(toast.getByTestId('toast-message')).toHaveText(en['app.title']);
  await expect(close).toHaveAttribute('aria-label', en['toast.close']);

  await close.click();
  await expect(toast).toHaveCount(0);
});

test('通知のトーストは role="status" で、時間がたつと消える', async ({ page }) => {
  await openWithPausedClock(page);
  await page.evaluate(() =>
    import('/src/ui/toast.ts').then((m) => {
      m.showToast('app.title', 'info');
    }),
  );
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute('data-kind', 'info');
  await expect(toast).toHaveAttribute('role', 'status');
  // 3 秒より前では残っている
  await page.clock.runFor(2500);
  await expect(toast).toHaveCount(1);
  await page.clock.runFor(1000);
  await expect(toast).toHaveCount(0);
});

test('エラーのトーストは通知より長く残り、6 秒で消える', async ({ page }) => {
  await openWithPausedClock(page);
  await page.evaluate(() =>
    import('/src/ui/toast.ts').then((m) => {
      m.showToast('app.title', 'error');
    }),
  );
  const toast = page.getByTestId('toast');
  await expect(toast).toHaveCount(1);
  await page.clock.runFor(4000);
  await expect(toast).toHaveCount(1);
  await page.clock.runFor(2500);
  await expect(toast).toHaveCount(0);
});

test('複数のトーストは描画領域の下寄りに積み重なり、新しいものが下に出る。返り値の関数で閉じられる', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() =>
    import('/src/ui/toast.ts').then((m) => {
      m.showToast('app.title', 'info');
      const close = m.showToast('toast.close', 'error');
      (window as unknown as { __closeToast: () => void }).__closeToast = close;
    }),
  );
  const toasts = page.getByTestId('toast');
  await expect(toasts).toHaveCount(2);
  await expect(toasts.nth(0)).toHaveAttribute('data-kind', 'info');
  await expect(toasts.nth(1)).toHaveAttribute('data-kind', 'error');
  const first = await toasts.nth(0).boundingBox();
  const second = await toasts.nth(1).boundingBox();
  const canvas = await page.locator('canvas').boundingBox();
  if (first === null || second === null || canvas === null) throw new Error('boundingBox が無い');
  expect(second.y).toBeGreaterThan(first.y);
  // 描画領域の中の下寄りに重なる
  expect(first.y).toBeGreaterThan(canvas.y + canvas.height / 2);
  expect(second.x).toBeGreaterThanOrEqual(canvas.x);
  expect(second.x + second.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(second.y + second.height).toBeLessThanOrEqual(canvas.y + canvas.height);

  await page.evaluate(() => (window as unknown as { __closeToast: () => void }).__closeToast());
  await expect(toasts).toHaveCount(1);
  await expect(toasts.nth(0)).toHaveAttribute('data-kind', 'info');
});

test('差し込みの値を受け取って t() に渡す', async ({ page }) => {
  await open(page);
  // 差し込みのある文言は後続のタスクが辞書に足す。ここでは余分な値を渡しても壊れないことを確かめる
  await page.evaluate(() =>
    import('/src/ui/toast.ts').then((m) => {
      m.showToast('app.title', 'info', { name: 'x' });
    }),
  );
  await expect(page.getByTestId('toast-message')).toHaveText(ja['app.title']);
});

test('トーストの上の pointerdown は canvas に届かない', async ({ page }) => {
  await open(page);
  await page.evaluate(() =>
    import('/src/ui/toast.ts').then((m) => {
      m.showToast('app.title', 'error');
    }),
  );
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas === null) throw new Error('canvas が無い');
    (window as unknown as { __downs: number }).__downs = 0;
    canvas.addEventListener('pointerdown', () => {
      (window as unknown as { __downs: number }).__downs += 1;
    });
  });
  await page.getByTestId('toast-message').click();
  expect(await page.evaluate(() => (window as unknown as { __downs: number }).__downs)).toBe(0);
});
