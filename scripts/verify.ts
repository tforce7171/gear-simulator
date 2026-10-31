// タスクごとの確認。`pnpm verify [e2e の spec...]` と `pnpm verify:all`（design.md §10）
//
// biome check → tsc --noEmit → vitest run → Playwright の順に流し、どれかが落ちたらそこで止める。
// Playwright は範囲を絞る:
// - spec を引数で渡したら、それだけ（例: pnpm verify e2e/rack.spec.ts e2e/visual/stage3.spec.ts）
// - 渡さなければ、main から変わった spec（と、変わった fixtures を import している spec）だけ
//   （playwright test --only-changed=<main との分岐点>。まだコミットしていない変更も含む）
// - --all を付けたら全部（pnpm verify:all。節目やマージの前に流す）

import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const all = argv.includes('--all');
const specs = argv.filter((a) => a !== '--all');

function run(label: string, cmd: string[]): void {
  console.log(`\n[verify] ${label}: ${cmd.join(' ')}`);
  const [bin, ...rest] = cmd;
  const r = spawnSync(bin ?? '', rest, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n[verify] ${label} で失敗しました`);
    process.exit(r.status ?? 1);
  }
}

function changedBase(): string {
  const r = spawnSync('git', ['merge-base', 'HEAD', 'main'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'HEAD';
}

run('biome', ['pnpm', 'exec', 'biome', 'check', '.']);
run('tsc', ['pnpm', 'exec', 'tsc', '--noEmit']);
run('vitest', ['pnpm', 'exec', 'vitest', 'run']);

const e2e = ['pnpm', 'exec', 'tsx', 'scripts/e2e.ts'];
if (all) {
  run('e2e（全部）', e2e);
} else if (specs.length > 0) {
  run('e2e（指定した spec）', [...e2e, ...specs]);
} else {
  run('e2e（main から変わった spec）', [
    ...e2e,
    `--only-changed=${changedBase()}`,
    '--pass-with-no-tests',
  ]);
  console.log(
    '\n[verify] e2e は main から変わった spec だけを流しました。src を変えて既存の通しテストに影響しそうなら、' +
      '関係する spec を引数で渡すか（pnpm verify e2e/xxx.spec.ts）、pnpm verify:all を流してください。',
  );
}
console.log('\n[verify] すべて通りました');
