# 実装の記録

自動実行（`.claude/workflows/implement-all.js`）の中で、仕様が曖昧なところに置いた仮定と、`blocked` になったタスクの理由を書く。共通の前提が変わるものは、ここに加えて design.md も書き換える。

| タスク | 仮定・出来事 | 理由 |
|---|---|---|
| S1-01 | 依存は 2026-10 時点の最新（TypeScript 7.0、Vite 8、Vitest 5、Biome 2.6、Playwright 1.64、three 0.186）に固定した。`packageManager` は `pnpm@11.10.0` | 新規のプロジェクトで古い版を選ぶ理由がなく、`pnpm verify` がこの組み合わせで通ることを確かめたため |
| S1-01 | Biome の検査対象から `docs/`・`.claude/`・`**/*.md` を外した | `biome check --write .` が資料の Markdown とワークフローの JS を書き換えてしまうため。資料の書式は人が決める |
| S1-01 | Biome の書式は 2 スペース、シングルクォート、行幅 100 にした | design.md のコード例がこの書き方のため |
| S1-01 | `src/core/import-rules.test.ts` は自分自身を検査対象から外した | 禁止パターン（`indexedDB` など）を正規表現として持つので、自分自身が必ず誤検知になるため |
| S1-01 | 外の層への相対 import の Biome の規則は、`**/render`・`**/render/**` などのパターンで書いた。`src/core` の中に `render`・`app` などの名前のフォルダは作らない前提 | Biome のパターンは import の文字列だけを見て、解決先を見られないため。解決先での判定は import-rules.test.ts が行う |
| S1-01 | Playwright のブラウザの導入は `postinstall` にせず、`pnpm e2e:install`（`playwright install chromium`）のスクリプトを足した | `pnpm install` のたびに 100 MB 以上を取りに行かないため |
| S1-01 | `e2e/blank.spec.ts` もフィクスチャの `test` を使うので、ブラウザ（page）は起動する（ページは開かない） | 「すべての spec はこの test を import する」という決まりを優先したため |
