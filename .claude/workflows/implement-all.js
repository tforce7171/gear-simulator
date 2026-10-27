export const meta = {
  name: 'implement-all',
  description: 'docs/tasks の全タスクを依存順に 1 本ずつ実装・レビュー・main へマージする（止まらず最後まで）',
  whenToUse: 'gear-simulator の実装を開始・再開するとき。done のタスクは飛ばすので、何度起動しても続きから進む',
  phases: [
    { title: 'State', detail: 'タスク資料と git の状態を読む' },
    { title: 'Tasks', detail: 'タスクごとに 実装 → レビュー → 差し戻し → マージ' },
  ],
}

// 運用の決定（変えるときはここと docs/tasks/README.md を合わせる）
// - 直列。タスクごとに task/<ID> ブランチを切り、合格したら main に --no-ff でマージしてブランチを消す
// - 差し戻しは 2 回まで。それでも不合格なら、まっさらなエージェントで 1 回やり直す。駄目なら blocked
// - 人には聞かない。仮定は docs/tasks/implementation-log.md、手で確かめる項目は docs/tasks/manual-checks.md
// - push しない

const MAX_FIXES = 2
const MAX_LOOP = 80

const STATE_SCHEMA = {
  type: 'object',
  properties: {
    currentBranch: { type: 'string' },
    dirty: { type: 'boolean', description: '作業ツリーに未コミットの変更があるか' },
    tasks: {
      type: 'array',
      description: 'docs/tasks/README.md の表の順',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          path: { type: 'string', description: 'リポジトリからの相対パス' },
          status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
          depends: { type: 'array', items: { type: 'string' }, description: '範囲表記は個別の ID に展開する' },
        },
        required: ['id', 'title', 'path', 'status', 'depends'],
      },
    },
  },
  required: ['currentBranch', 'dirty', 'tasks'],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['ready', 'stuck'], description: 'ready = レビューに出せる状態でコミット済み' },
    verifyPassed: { type: 'boolean' },
    summary: { type: 'string', description: '何を作り、何を決めたか（日本語、数行）' },
    stuckReason: { type: 'string' },
  },
  required: ['outcome', 'verifyPassed', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    verifyPassed: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' }, description: '直すべき点。具体的に（ファイル、条件、期待値）' },
  },
  required: ['pass', 'verifyPassed', 'issues'],
}

const DONE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    detail: { type: 'string' },
  },
  required: ['ok', 'detail'],
}

const COMMON_RULES = `
共通の決まり:
- 人間には質問できない。止まらずに最後までやる。仕様が曖昧なところは合理的な仮定を置いて進め、docs/tasks/implementation-log.md に「タスク ID・仮定・理由」を追記する。
- コミットは task/<ID> ブランチの上だけで行う。main への直接コミット、push、他のブランチへのマージはしない（マージは別の担当が行う）。
- コミットメッセージは design.md §11 の形式（例: feat(S1-05): 日本語の要約）。ブランチの中では細かく分けてよい。
- テストの削除・skip・期待値の緩和、Biome や tsconfig の規則の緩和で verify を通してはいけない。
- タスク資料の「範囲外」に書かれたものには手を出さない。
`

function implPrompt(t, mode, issues) {
  const header = {
    first: `タスク ${t.id}「${t.title}」（${t.path}）を実装して、レビューに出せる状態にしてください。`,
    fix: `タスク ${t.id}「${t.title}」（${t.path}）はレビューで不合格になりました。指摘を直してください。`,
    retry: `タスク ${t.id}「${t.title}」（${t.path}）は、これまでの試行がレビューで ${MAX_FIXES + 1} 回不合格になりました。あなたは新しい担当です。task/${t.id} ブランチの現状と最後の指摘を見て、続きから直すか、ブランチを main の位置からやり直す（git reset --hard main）かを判断し、合格する状態にしてください。`,
  }[mode]
  const issueText = issues && issues.length ? `\n最後のレビューの指摘:\n${issues.map(i => `- ${i}`).join('\n')}\n` : ''
  return `${header}
${issueText}
手順:
1. git の状態を確認する。今が main なら task/${t.id} ブランチを作って移る。既にそのブランチがあれば checkout し、git log と差分を見て進み具合を確かめてから続ける。
2. まだ doing でなければ、タスク資料の front matter と docs/tasks/README.md の状態欄を doing にする。
3. タスク資料を全部読む。docs/design.md、docs/requirements.md の関連する節、依存タスクの資料（特に「作るもの」）も読む。既存のコードも確かめる。
4. 「テストケース」の節のテストを先に書き、それから実装する（Vitest / Playwright / Playwright（見た目））。期待値は資料の値をそのまま使う。
5. pnpm verify が通るまで直す。
6. 「完了の条件」の 2 つ目: 前提が変わったら docs/design.md と後続のタスク資料を書き換える。window.__gearSim の API を足したら design.md §10 の表も更新する。
7. 「人が手で確かめる項目」と、エージェントの環境では確かめられない受け入れ条件（ブラウザでの目視、実機での計測など）は、docs/tasks/manual-checks.md に「タスク ID・項目・確かめ方」を追記する。自動で確かめられるもの（わざと違反を入れて失敗を確かめて戻す、など）は自分で実際に行い、結果を summary に書く。
8. すべてコミットして、作業ツリーをきれいにして終える。status を done にするのは、あなたではなくマージ担当の仕事なので、doing のままにする。
${COMMON_RULES}
どうしても完了できない場合だけ outcome=stuck にして、理由を stuckReason に書く。`
}

function reviewPrompt(t) {
  return `タスク ${t.id}「${t.title}」（${t.path}）の実装をレビューしてください。ブランチは task/${t.id} です（checkout されていなければ checkout する）。
あなたはファイルを一切変更しない。コミットもしない。

確かめること:
1. 作業ツリーがきれいか（未コミットの変更があれば不合格）。
2. git diff main...task/${t.id} を読み、資料の「受け入れ条件」がすべて満たされているか。
3. 資料の「テストケース」がすべてテストとして書かれていて、資料の期待値どおりに検証しているか。skip や期待値の緩和がないか。Biome や tsconfig の規則が緩められていないか。
4. pnpm verify を自分で実行して、通るか。
5. 「完了の条件」の 2 つ目: 必要な docs/design.md や後続のタスク資料の更新（§10 の API の表など）が漏れていないか。
6. 「範囲外」に書かれたものに手を出していないか。
7. 置いた仮定が docs/tasks/implementation-log.md に、人が手で確かめる項目が docs/tasks/manual-checks.md に記録されているか。

コードの書き方（スタイル）は Biome に任せ、見なくてよい。
不合格なら、直すべき点を具体的に issues に書く。合格なら issues は空にする。`
}

function mergePrompt(t) {
  return `タスク ${t.id}「${t.title}」はレビューに合格しました。完了の処理と main へのマージをしてください。
1. task/${t.id} ブランチで、${t.path} の front matter を status: done にし、「完了の条件」のチェックボックスを [x] にする。docs/tasks/README.md の状態欄も done にする。コミットする（例: docs(${t.id}): 完了にする）。
2. git checkout main して、git merge --no-ff task/${t.id} -m "merge(${t.id}): ${t.title}" を実行する。
3. 競合したら、両方の意図を残して解消し、pnpm verify が通ることを確かめてからマージコミットを作る。
4. git branch -d task/${t.id} でブランチを消す。
5. main で作業ツリーがきれいなことを確かめる。push はしない。
ok は、main にマージされ、作業ツリーがきれいなときだけ true にする。`
}

function blockPrompt(t, reason) {
  return `タスク ${t.id}「${t.title}」は、何度やってもレビューに合格しませんでした。blocked として記録してください。
理由: ${reason}
1. task/${t.id} ブランチに未コミットの変更があれば、wip(${t.id}): 途中の状態 としてコミットする。ブランチは消さない。
2. git checkout main する。
3. main の上で ${t.path} の front matter を status: blocked にし、docs/tasks/README.md の状態欄も blocked にする。
4. docs/tasks/implementation-log.md に「${t.id} は blocked。理由、最後の指摘、task/${t.id} ブランチに途中の作業がある」と追記する。
5. docs(${t.id}): blocked にする としてコミットする。push はしない。`
}

// ---- 状態を読む ----
phase('State')
const state = await agent(
  `gear-simulator リポジトリの状態を読んでください。ファイルは変更しない。
- git の今のブランチ名と、未コミットの変更があるか。
- docs/tasks/README.md の表にあるすべてのタスクについて、表の順に、ID、題名、資料のパス、資料の front matter の status、依存を返す。
- 依存の「S1-01〜S1-30」「S2-01〜S2-04」のような範囲表記は、個別の ID に展開する。依存が「-」なら空配列。`,
  { label: 'read-state', schema: STATE_SCHEMA, effort: 'low' },
)

if (state.dirty && !state.currentBranch.startsWith('task/')) {
  log(`作業ツリーに未コミットの変更があります（ブランチ: ${state.currentBranch}）。片付けてから起動し直してください。`)
  return { aborted: true, reason: 'dirty working tree', branch: state.currentBranch }
}

const tasks = state.tasks
const byId = Object.fromEntries(tasks.map(t => [t.id, t]))
const resumeId = state.currentBranch.startsWith('task/') ? state.currentBranch.slice('task/'.length) : null
const results = []

function ready(t) {
  return (t.status === 'todo' || t.status === 'doing') && t.depends.every(d => byId[d] && byId[d].status === 'done')
}

function pickNext() {
  if (resumeId && byId[resumeId] && ready(byId[resumeId])) return byId[resumeId]
  return tasks.find(ready)
}

log(`タスク ${tasks.length} 本。done ${tasks.filter(t => t.status === 'done').length} 本、blocked ${tasks.filter(t => t.status === 'blocked').length} 本。`)

// ---- タスクを 1 本ずつ ----
phase('Tasks')
for (let loop = 0; loop < MAX_LOOP; loop++) {
  const t = pickNext()
  if (!t) break
  log(`${t.id} ${t.title} を開始`)

  let impl = await agent(implPrompt(t, 'first'), { label: `impl:${t.id}`, phase: 'Tasks', schema: IMPL_SCHEMA })
  let review = null
  let lastIssues = []
  let passed = false

  // 実装 → レビュー → 差し戻し（最大 MAX_FIXES 回）→ 新しい担当で 1 回やり直し
  const attempts = [...Array(MAX_FIXES).fill('fix'), 'retry']
  for (let i = 0; i <= attempts.length; i++) {
    if (impl && impl.outcome === 'ready') {
      review = await agent(reviewPrompt(t), { label: `review:${t.id}#${i + 1}`, phase: 'Tasks', schema: REVIEW_SCHEMA })
      if (review && review.pass) {
        passed = true
        break
      }
      lastIssues = review ? review.issues : ['レビュー担当が結果を返さなかった。もう一度レビューに出せる状態か確かめる']
    } else {
      lastIssues = [`実装担当が完了できなかった: ${impl ? impl.stuckReason || impl.summary : '結果が返らなかった'}`]
    }
    if (i === attempts.length) break
    const mode = attempts[i]
    log(`${t.id} 不合格（${i + 1} 回目）→ ${mode === 'fix' ? '差し戻し' : '新しい担当でやり直し'}`)
    impl = await agent(implPrompt(t, mode, lastIssues), { label: `${mode}:${t.id}#${i + 1}`, phase: 'Tasks', schema: IMPL_SCHEMA })
  }

  if (passed) {
    const merged = await agent(mergePrompt(t), { label: `merge:${t.id}`, phase: 'Tasks', schema: DONE_SCHEMA, effort: 'low' })
    if (merged && merged.ok) {
      t.status = 'done'
      log(`${t.id} 完了・main にマージ済み`)
      results.push({ id: t.id, status: 'done', summary: impl && impl.summary })
      continue
    }
    lastIssues = [`マージに失敗: ${merged ? merged.detail : '結果が返らなかった'}`]
  }

  await agent(blockPrompt(t, lastIssues.join(' / ')), { label: `block:${t.id}`, phase: 'Tasks', schema: DONE_SCHEMA, effort: 'low' })
  t.status = 'blocked'
  log(`${t.id} は blocked。依存していないタスクを続ける`)
  results.push({ id: t.id, status: 'blocked', issues: lastIssues })
}

const remaining = tasks.filter(t => t.status !== 'done')
const waiting = remaining
  .filter(t => t.status !== 'blocked')
  .map(t => ({ id: t.id, waitingOn: t.depends.filter(d => !byId[d] || byId[d].status !== 'done') }))
log(`終了。done ${tasks.length - remaining.length}/${tasks.length}、blocked ${remaining.filter(t => t.status === 'blocked').length}、依存待ち ${waiting.length}`)

return {
  thisRun: results,
  blocked: remaining.filter(t => t.status === 'blocked').map(t => t.id),
  waiting,
  next: '人が確かめる項目は docs/tasks/manual-checks.md、仮定と blocked の理由は docs/tasks/implementation-log.md を見る',
}
