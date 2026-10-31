// Playwright を、チェックアウトをまたいで 1 本ずつ流す。`pnpm e2e [playwright test の引数...]`
//
// メインのチェックアウトとワークツリーは git の共通ディレクトリ（git rev-parse --git-common-dir）を共有するので、
// そこにロックファイルを置き、flock で取ってから playwright test を起動する。他のチェックアウトの e2e が
// 流れていれば、終わるまで待つ。同時に流すと CPU・GPU を奪い合って時間切れが出るため（design.md §10）。
// ポートはチェックアウトごとに分けてある（playwright.config.ts）ので、待たずに流したいときは E2E_NO_LOCK=1。
// flock が無い環境では、ロックを取らずに流す。

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const playwright = ['pnpm', 'exec', 'playwright', 'test', ...args];

function lockFile(): string | null {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return resolve(r.stdout.trim(), 'gear-simulator-e2e.lock');
}

function hasFlock(): boolean {
  return spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0;
}

function run(cmd: string[]): number {
  const [bin, ...rest] = cmd;
  const r = spawnSync(bin ?? '', rest, { stdio: 'inherit' });
  return r.status ?? 1;
}

const lock = process.env.E2E_NO_LOCK ? null : lockFile();
if (lock === null || !hasFlock()) {
  process.exit(run(playwright));
}

// 空いていればすぐ取る。取れなければ、待つことを知らせてから待つ
if (spawnSync('flock', ['-n', lock, 'true']).status !== 0) {
  console.log(`[e2e] 他のチェックアウトの e2e が終わるのを待っています（${lock}）`);
}
process.exit(run(['flock', lock, ...playwright]));
