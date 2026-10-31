import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages はリポジトリ名のサブパス（/<repo>/）で配信されるので、資産を相対パスで参照する
  base: './',
  test: {
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    environment: 'node',
    // ファイルごとにワーカーを作り直さない（起動の待ちを減らす）。テストはモジュールの状態を共有しない前提
    isolate: false,
  },
});
