import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages はリポジトリ名のサブパス（/<repo>/）で配信されるので、資産を相対パスで参照する
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
