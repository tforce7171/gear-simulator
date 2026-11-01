---
name: retro
description: docs/tasks/lessons.md に貯まった知見の候補を CLAUDE.md・スキル・design.md・implement-all.js などに還元し、ready の PR を出す。implement-all の最後に自動で回るほか、手で回して過去のワークフロー実行の記録から還元することもできる。
disable-model-invocation: true
---

# 知見の還元

材料は `docs/tasks/lessons.md` の項目。形式と状態の意味は、そのファイルの「書き方」が正本。人には聞かずに最後まで進め、判断は PR のレビューに委ねる。

## 1. 作業場所を用意する

共有のチェックアウト（`git worktree list` の先頭）は編集しない。そこで:

```
name=retro-$(date +%Y%m%d-%H%M)
git worktree add .claude/worktrees/$name -b chore/$name main
```

以降の編集・コミットはすべてこの worktree の中で行う。コードを変えて `pnpm verify` を流すときだけ `pnpm install --frozen-lockfile` を流す。

## 2. 材料を集める

- `lessons.md` の `[未還元]` と `[見送り n/3 ...]` の項目。
- 手で回すときに、ユーザーがワークフローの実行（`wf_...`）を指定したら、その記録も材料にする。記録の場所と読み方は下の「実行の記録の読み方」。分析した結果は、先に `lessons.md` へ `[未還元]` の項目として書き足してから 3 に進む（材料を 1 か所にまとめるため）。
- まだマージされていない retro の PR（`gh pr list --state open --search "head:chore/retro-"`）があれば、そのブランチの `lessons.md` で状態が変わっている項目は、その PR に任せて今回は触らない。

`[未還元]` が 1 つも無ければ、何も変えずに終える（worktree とブランチを消す）。見送りの項目だけのために retro を回さない。

## 3. 振り分ける

項目ごとに、今の main の CLAUDE.md・`.claude/skills/*`・design.md（§10 を中心に、関わる節）・`.claude/workflows/implement-all.js`・`e2e/fixtures/` を読んで、状態を 1 つに決める:

- **既出**: 既に書いてあり、担当がそこにたどり着けた → `[既出]`。
- **既出だがたどり着けなかった**: 書いてあるのに担当が探し直した → 新しく書かず、担当が最初に読む場所（CLAUDE.md・タスク資料のひな形・implement-all.js のプロンプト）に案内を 1 行足す。→ `[還元済み]`。
- **陳腐化**: 今の main では起きない（スクリプトや部品が既に直っている）。`git grep` で確かめる → `[陳腐化]`。
- **新規**: 下の「反映先」に書く → `[還元済み]`。
- **見送り**: 反映すると大きすぎる・確かめきれない・他の作業とぶつかる → `[見送り n/3 <理由>]`（前から見送りなら n を 1 増やし、3 に達したら `[却下 <理由>]`）。

1 回しか起きていないタスク固有の誤りは、似た誤りが他のタスクでも起こりうるときだけ新規にする。

### 反映先

| 知見 | 反映先 |
|---|---|
| 毎回探し直す事実、作業の作法 | CLAUDE.md（該当する節） |
| 仕様、テストの取り決め | docs/design.md（該当する節。テストなら §10） |
| 2 回以上くり返された、何段もある手順 | `.claude/skills/<名前>/SKILL.md`（新規。既存のスキルに足せるならそちら） |
| 担当（impl・review・merge）の作法 | `.claude/workflows/implement-all.js` のプロンプト。直したら、その理由をタスク ID 付きのコメントで残す（既存の `statusRule` の例に合わせる） |
| コードで直せる問題（待ち方・部品の重複など） | `e2e/fixtures/` などのテストの部品 |
| ユーザーの好み | メモリ（`~/.claude/projects/<プロジェクト>/memory/`）。リポジトリではないので PR の本文にも書く |

## 4. 書く

- CLAUDE.md・スキル・プロンプトは Skill ツールで `mattpocock-skills:writing-for-agents` を読み、その指針で書く。既存の文に足すより、言い換えて 1 か所にまとめるほうを選ぶ。
- 書いた関数名・パス・コマンド・testid は、すべて `git grep` で実在を確かめる。
- コードの変更は `pnpm verify <関わる spec>` が通ったときだけ残す。通らなければ変更を戻し、その項目を見送りにして、PR の本文に案として書く。
- `lessons.md` の各項目の状態を書き換える（`[還元済み chore/<name>]` など）。項目は消さない。

完了の条件: 2 で今回扱うとした項目すべての状態が `[未還元]` 以外になっている。

## 5. 出す

- 反映したものがあれば: 細かく分けてコミットし（`docs(retro): ...`・`chore(retro): ...`・`test(retro): ...`）、`git push -u origin chore/<name>` して、`gh pr create` で ready の PR を出す（draft にしない）。本文には、反映したもの（項目 → 反映先）、既出・陳腐化にしたもの、見送り・却下とその理由、メモリに書いたものを書く。
- 状態の書き換えだけなら（全部が既出・陳腐化・見送り）: `docs(retro): 知見の状態を更新する` としてコミットし、共有のチェックアウト（main で作業ツリーがきれいなこと）で `git merge --ff-only chore/<name>` する。PR は出さない。
- どちらも最後に、共有のチェックアウトで `git worktree remove .claude/worktrees/<name>` する。ff でマージしたときはブランチも消す。

## 実行の記録の読み方

手で回して過去の実行を材料にするときだけ読む。

- 記録は `~/.claude/projects/<プロジェクトのディレクトリ>/<セッション ID>/subagents/workflows/<runId>/` にある。起動したセッションが worktree に入っていると、プロジェクトのディレクトリが worktree 側（`-home-...--claude-worktrees-<名前>`）に移る。`find ~/.claude/projects -type d -name '<runId>'` で探す。
- `journal.jsonl` に担当ごとの開始と結果（ラベルは `impl:<ID>`・`review:<ID>#n`・`fix:<ID>#n`・`retry:<ID>#n`・`merge:<ID>`）、`agent-<id>.jsonl` に各担当のトランスクリプトがある。1 本で数 MB になるので、jq で抜き出して読む。
- ツールの呼び出しを数えるときは `type=="assistant"` のレコードだけを数える（`api-request-blob` のレコードが同じ tool_use を二重に持つため）。
- 見るもの: 差し戻し・やり直しになった回の issues、同じ grep や Read のくり返し、落ちてから直した検証、時間のかかった担当。タスクの範囲で分けてサブエージェントに並行で読ませ、結果を lessons.md の形式で返させる。
