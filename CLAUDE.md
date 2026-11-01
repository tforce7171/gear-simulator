# gear-simulator

設計は `docs/design.md`、タスクは `docs/tasks/`。design.md は約 1000 行あるので、必要な節だけを読む:
§1 ディレクトリ構成 / §3 定数 / §4 シーンのデータ形式 / §5 導出データ（レイアウト・候補） / §6 運動 / §7 アプリの状態・編集コマンド / §8 国際化 / §9 保存形式 / §10 テストの取り決め（e2e の書き方・`__gearSim`・見た目の確認） / §11 コミット

## 検証

- `pnpm verify [spec...]`: biome → tsc → Vitest 全部 → e2e。e2e は、引数の spec だけか、引数を省けば main から変わった spec（と、変わった `e2e/fixtures/` を import する spec）だけを流す。
  - e2e の spec は src を import しない。src だけを変えても、既存の spec は引数なしでは流れない。src を変えたら、影響する spec を `grep -rln "<触った API や testid>" e2e` で探して引数で渡す。
- `pnpm verify:all`: e2e を全部流す（約 300 件・約 2 分）。タスクの最後に 1 回だけ流す。
- 1 本だけ流す: `pnpm e2e e2e/x.spec.ts -g "<テスト名>"`、`pnpm test <path>`、`pnpm typecheck`。整形と import の並びは `pnpm exec biome check --write <path>` で直る。
- e2e は前で流し、結果が出るまでソースを編集しない。実行中に編集すると、関係のない spec まで落ちて流し直しになる。実装をわざと壊してテストが落ちるか確かめるのも、e2e が流れていないときに行い、戻したら `git diff` で戻ったことを確かめる。

## テストの部品

- e2e の `test` / `expect` は `e2e/fixtures/test.ts` から import する。操作の関数は `e2e/fixtures/sim.ts`（一覧は `grep -n "^export" e2e/fixtures/sim.ts`）。
- 見た目の確認は画像の比較ではなく、撮った png を Read で見て確かめる。手順は design.md §10 の「見た目の確認」（`e2e/fixtures/visual.ts` の `captureScene` → `screenshots/<場面名>.png`）。
- `e2e/fixtures/*.json` は Vitest も使う。`src/app/demo-scene.test.ts` は `two-spur.json` と一致することを、`src/app/grow.test.ts` は全 fixture の候補を確かめている。シーンの形を変えたら fixture を全部直す（保存形式も変えるなら save-format-bump スキル）。
- `window.__gearSim` の型は `src/debug/gear-sim.ts` の `GearSimDebug`、実装をつなぐのは `src/main.ts` の `installGearSim(...)`。
- e2e は時間（`waitForTimeout`）で待たない。状態は `expect.poll`、カメラは `sim.ts` の `settleCamera` / `settledCamera`、描画は `nextFrames`、時計は `openWithPausedClock` で待ち、spec に自前の待ち関数を書かない。時間に依るテストは `--repeat-each=5` で確かめる（design.md §10 の「待ち方」）。

## コードを読む・直す

- 千行を超えるファイル（`src/core/edit/commands.ts`、`src/core/layout/resolve.ts`、`docs/design.md`）や `src/main.ts`・`src/app/interactions.ts` は、`grep -n "^export\|^function" <file>` で目次を出し、必要な関数だけを読む。
- `Scene`・`Command`・`GrowSpec` などの型を変えたら、まず `pnpm typecheck` で壊れた箇所の一覧を出し、その一覧に沿って直す。
- 文言は `src/core/i18n/ja.ts` と `en.ts` の両方に足す（`MessageKey` は ja.ts から導かれ、en の過不足は型エラーになる）。
- 編集コマンドを足すときは add-edit-command スキル、歯車の種類を足すときは add-gear-kind スキルを使う。
- 描画（`src/render`）を変えるときは、design.md §7 の「描画を軽くする仕組み」を読む。見た目を行列・visible・材質の差し替え以外で変える（材質の色を直に書き換えるなど）なら `invalidate` するか `SceneSync.version()` を増やす。そうしないと見た目が変わっても描き直されない。重さは `pnpm perf --headless` で、main を `git worktree add --detach` したものと比べる。
