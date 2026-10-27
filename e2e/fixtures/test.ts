import { test as base, expect } from '@playwright/test';

// console の error と pageerror を集め、テストの終わりに 0 件であることを確かめる（design.md §10）。
// すべての spec はこの test を import する。
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => {
        errors.push(`pageerror: ${err.message}`);
      });
      await use(errors);
      expect(errors, 'コンソールエラーと pageerror は 0 件であること').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
