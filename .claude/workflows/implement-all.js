export const meta = {
  name: 'implement-all',
  description: 'docs/tasks の全タスクを依存順に 1 本ずつ実装・レビュー・main へマージする（止まらず最後まで）',
  whenToUse: 'gear-simulator の実装を開始・再開するとき。done のタスクは飛ばすので、何度起動しても続きから進む',
  phases: [
    { title: 'State', detail: 'タスク資料と git の状態を読む' },
    { title: 'Tasks', detail: 'タスクごとに 実装 → レビュー → 差し戻し → マージ' },
    { title: 'Retro', detail: 'docs/tasks/lessons.md の知見を還元して PR を出す' },
  ],
}

// 運用の決定（変えるときはここと docs/tasks/README.md を合わせる）
// - 直列。タスクごとに task/<ID> ブランチと worktree（.claude/worktrees/task-<ID>）を作り、impl・差し戻し・レビューで共有する。
//   合格したら main に --no-ff でマージし、worktree とブランチを消す
// - 共有のチェックアウト（git worktree list の先頭）は main のままにし、git の操作（merge・worktree add/remove・branch -d）だけに使う。
//   ファイルの編集はしない（バックグラウンドのジョブでは共有のチェックアウトへの編集が止められるため）
// - agent() の isolation: 'worktree' は使わない（担当ごとの使い捨てになり、同じブランチを引き継げないため）
// - 差し戻しは 2 回まで。それでも不合格なら、まっさらなエージェントで 1 回やり直す。駄目なら blocked
// - 人には聞かない。仮定は docs/tasks/implementation-log.md、手で確かめる項目は docs/tasks/manual-checks.md
// - push しない（例外は Retro だけ。PR の差分にタスクのマージが混ざらないよう main を ff で push してから、chore/retro-* の PR を出す）
// - 担当は知見（lessons）も返し、merge・block の担当が docs/tasks/lessons.md に追記する。
//   ループが最後まで回ったら Retro が retro スキル（.claude/skills/retro/SKILL.md）に従って還元し、ready の PR を出す。マージは人

const MAX_FIXES = 2
const MAX_LOOP = 80

const STATE_SCHEMA = {
  type: 'object',
  properties: {
    currentBranch: { type: 'string', description: '共有のチェックアウトの今のブランチ名' },
    dirty: { type: 'boolean', description: '共有のチェックアウトに未コミットの変更があるか' },
    taskBranches: { type: 'array', items: { type: 'string' }, description: '既存の task/* ブランチ（例: task/S1-05）' },
    taskWorktrees: {
      type: 'array',
      description: '既存の .claude/worktrees/task-* の worktree',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '共有のチェックアウトからの相対パス' },
          branch: { type: 'string' },
          dirty: { type: 'boolean' },
        },
        required: ['path', 'branch', 'dirty'],
      },
    },
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
  required: ['currentBranch', 'dirty', 'taskBranches', 'taskWorktrees', 'tasks'],
}

const LESSONS_FIELD = {
  type: 'array',
  description:
    '次に別のタスクをする担当が知っていれば、速く・確実に済んだこと（探し直した事実・詰まったこと・落とし穴）。タスク固有の仕様の仮定は含めない（implementation-log.md に書く）。無ければ空配列',
  items: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['探し直した事実', '詰まったこと', '落とし穴'] },
      text: { type: 'string', description: '1〜3 文。ファイル・関数・コマンドの名前を入れる' },
      evidence: { type: 'string', description: '回数・かかった手間・関わったファイルやコマンド' },
    },
    required: ['kind', 'text', 'evidence'],
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['ready', 'stuck'], description: 'ready = レビューに出せる状態でコミット済み' },
    verifyPassed: { type: 'boolean' },
    summary: { type: 'string', description: '何を作り、何を決めたか（日本語、数行）' },
    stuckReason: { type: 'string' },
    lessons: LESSONS_FIELD,
  },
  required: ['outcome', 'verifyPassed', 'summary', 'lessons'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    verifyPassed: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' }, description: '直すべき点。具体的に（ファイル、条件、期待値）' },
    lessons: LESSONS_FIELD,
  },
  required: ['pass', 'verifyPassed', 'issues', 'lessons'],
}

const RETRO_SCHEMA = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['pr', 'status-only', 'nothing', 'failed'] },
    branch: { type: 'string' },
    prUrl: { type: 'string' },
    detail: { type: 'string', description: '反映したもの・見送ったものの要約' },
  },
  required: ['outcome', 'detail'],
}

const DONE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    detail: { type: 'string' },
  },
  required: ['ok', 'detail'],
}

function wt(t) {
  return `.claude/worktrees/task-${t.id}`
}

const PLACES = `
作業場所:
- 「共有のチェックアウト」は git worktree list の先頭の行のパス（main のまま）。ここではファイルを編集しない。git の操作（merge・worktree add/remove・branch -d）だけに使う。
- 「タスクの worktree」は、共有のチェックアウトの中の .claude/worktrees/task-<ID>（ブランチは task/<ID>）。
- Bash の cd は次の呼び出しに引き継がれないことがある。コマンドは毎回絶対パスで書くか、git -C <パス> / cd <パス> && ... の形で場所を明示する。Edit/Write も絶対パスで、タスクの worktree の中のファイルを指す。
`

const COMMON_RULES = `
共通の決まり:
- 人間には質問できない。止まらずに最後までやる。仕様が曖昧なところは合理的な仮定を置いて進め、docs/tasks/implementation-log.md に「タスク ID・仮定・理由」を追記する。
- 編集・テスト・コミットはタスクの worktree（task/<ID> ブランチ）の中だけで行う。共有のチェックアウトでの checkout・編集、main への直接コミット、push、他のブランチへのマージはしない（マージは別の担当が行う）。
- コミットメッセージは design.md §11 の形式（例: feat(S1-05): 日本語の要約）。ブランチの中では細かく分けてよい。
- テストの削除・skip・期待値の緩和、Biome や tsconfig の規則の緩和で verify を通してはいけない。
- タスク資料の「範囲外」に書かれたものには手を出さない。
`

// 状態の書き換えで他の行を巻き込まない（S3-02 は依存の列の文字列で照合して S3-04 の行まで変えた）
// also: merge は完了の条件のチェックボックスも変えるので、許す行を足せるようにする（S5-05 は「2 行だけ」と食い違い、sed で全部の [ ] に印を付けた）
function statusRule(t, also = '') {
  return `状態は前の値に依らずに書き換える（資料は ^status: の行、README は [${t.id}]( で始まる行の最後の列）。書き換えたら git diff で、変わったのがこの 2 行${also}だけであることを確かめる。`
}

function implPrompt(t, mode, issues) {
  const header = {
    first: `タスク ${t.id}「${t.title}」（${t.path}）を実装して、レビューに出せる状態にしてください。`,
    fix: `タスク ${t.id}「${t.title}」（${t.path}）はレビューで不合格になりました。指摘を直してください。`,
    retry: `タスク ${t.id}「${t.title}」（${t.path}）は、これまでの試行がレビューで ${MAX_FIXES + 1} 回不合格になりました。あなたは新しい担当です。task/${t.id} ブランチの現状と最後の指摘を見て、続きから直すか、ブランチを main の位置からやり直す（タスクの worktree の中で git reset --hard main）かを判断し、合格する状態にしてください。`,
  }[mode]
  const issueText = issues && issues.length ? `\n最後のレビューの指摘:\n${issues.map(i => `- ${i}`).join('\n')}\n` : ''
  return `${header}
${issueText}
${PLACES}
手順:
1. タスクの worktree（${wt(t)}）を用意する。共有のチェックアウトで git worktree list と git branch --list task/${t.id} を見て:
   - worktree が既にあれば、それを使う。git log と差分を見て進み具合を確かめてから続ける。
   - ブランチ task/${t.id} だけあって worktree が無ければ、共有のチェックアウトで git worktree add ${wt(t)} task/${t.id} を実行する。
   - どちらも無ければ、共有のチェックアウトで git worktree add ${wt(t)} -b task/${t.id} main を実行する。
   作ったときは、その worktree の中で pnpm install --frozen-lockfile を流す。以降の作業はすべてその worktree の中で行う。
2. まだ doing でなければ、タスク資料の front matter と docs/tasks/README.md の状態欄を doing にする。${statusRule(t)}
3. タスク資料を全部読む。docs/design.md、docs/requirements.md の関連する節、依存タスクの資料（特に「作るもの」）も読む。既存のコードも確かめる。資料の見本やテストケースに具体的な配置（歯数・厚さ・位置）があれば、テストを書く前に使い捨てのスクリプト（pnpm exec tsx）で applyCommand → resolveLayout を流し、干渉が無く位相が合うことを確かめる。成り立たなければ、成り立つ数値に直して implementation-log.md に書く（S5-05 の 36・12・12 とラック 8 mm は組めず、実装の途中で数値を振り直した）。
4. 「テストケース」の節のテストを先に書き、それから実装する（Vitest / Playwright / Playwright（見た目））。期待値は資料の値をそのまま使う。
5. pnpm verify が通るまで直す。時間に依るテスト（カメラの移動・アニメーション・自動保存・トーストなど）を足したり変えたりしたら、pnpm e2e <spec> --repeat-each=5 でも全部通ることを確かめる（design.md §10 の「時間に依るテストの確かめ方」）。
6. 「完了の条件」の 2 つ目: 前提が変わったら docs/design.md と後続のタスク資料を書き換える。window.__gearSim の API を足したら design.md §10 の表も更新する。足した型・関数・辞書のキー・testid の名前で grep -rn '<名前>' docs/tasks を流し、後続のタスク資料で「足す・作る」と書かれている箇所を「${t.id} で足し済み」に直す（S1-15 で直し漏れがあり、後続が同じキーを二重に足すおそれがあった）。
   既にある値や規則を変えたら、変える前の値（数値）と旧い規則の言い回しでも docs/design.md と docs/tasks を grep し、残った説明を直す。足した名前の grep では、値を書いた文は見つからない（S5-01 の「4 の倍数」、S5-03 の「wood 520 Hz」がそれぞれレビューで不合格になった）。
   資料の「範囲外」で後続のタスクに送った項目があれば、その後続の資料を読み、このタスクで足した振る舞い（新しい経路・状態）があっても後続の「作るもの」で受け入れ条件を満たせるか確かめる。足りなければ後続の資料に書き足す（S5-03 で足したジーは粒と別の経路で鳴り、S5-05 の「止まっている間は鳴らない」を壊しかけた）。
7. 「人が手で確かめる項目」と、エージェントの環境では確かめられない受け入れ条件（ブラウザでの目視、実機での計測など）は、docs/tasks/manual-checks.md に「タスク ID・項目・確かめ方」を追記する。自動で確かめられるもの（わざと違反を入れて失敗を確かめて戻す、など）は自分で実際に行い、結果を summary に書く。
8. タスクの worktree の中ですべてコミットして、作業ツリーをきれいにして終える。worktree は消さない（レビューとマージで使う）。status を done にするのは、あなたではなくマージ担当の仕事なので、doing のままにする。
9. 振り返って lessons を返す: 何度も grep し直した名前や場所、落ちてから原因に気づいた検証、資料や CLAUDE.md に書いてあれば避けられた回り道。ファイルには書かない（マージ担当が docs/tasks/lessons.md に書く）。
${COMMON_RULES}
どうしても完了できない場合だけ outcome=stuck にして、理由を stuckReason に書く。`
}

function reviewPrompt(t) {
  return `タスク ${t.id}「${t.title}」（${t.path}）の実装をレビューしてください。ブランチは task/${t.id} で、タスクの worktree（${wt(t)}）に checkout されています。
${PLACES}
あなたはファイルを一切変更しない。コミットもしない。どこでも checkout しない。読むのも pnpm verify を流すのも、タスクの worktree の中で行う。

確かめること:
1. タスクの worktree の作業ツリーがきれいか（未コミットの変更があれば不合格）。worktree が無ければ不合格にして、その旨を issues に書く。
2. タスクの worktree の中で git diff main...task/${t.id} を読み、資料の「受け入れ条件」がすべて満たされているか。
3. 資料の「テストケース」がすべてテストとして書かれていて、資料の期待値どおりに検証しているか。skip や期待値の緩和がないか。Biome や tsconfig の規則が緩められていないか。
4. タスクの worktree の中で pnpm verify を自分で実行して、通るか。
5. 「完了の条件」の 2 つ目: 必要な docs/design.md や後続のタスク資料の更新（§10 の API の表など）が漏れていないか。このタスクで足した名前（型・関数・辞書のキー・testid）を docs/tasks で grep し、後続の資料にまだ「足す・作る」と書かれていないか。値や規則を変えていれば、変える前の値・言い回しで docs を grep して古い説明が残っていないか。「範囲外」で送った後続の資料を開き、このタスクで足した振る舞いを考えに入れても、その受け入れ条件を満たせるか。
   時間に依るテストを足したり変えたりしていれば、その spec を pnpm e2e <spec> --repeat-each=5 で流して全部通るか。
6. 「範囲外」に書かれたものに手を出していないか。
7. 置いた仮定が docs/tasks/implementation-log.md に、人が手で確かめる項目が docs/tasks/manual-checks.md に記録されているか。

コードの書き方（スタイル）は Biome に任せ、見なくてよい。
1〜7 は、不合格の点が見つかってもすべて確かめ、見つかった点を全部 issues に書く（S5-03 は 1 回目が 1 件だけ返し、2 回目で初めて出た指摘のために修正と再レビューが 1 往復増えた）。
不合格なら、直すべき点を具体的に issues に書く。合格なら issues は空にする。
lessons には、この不合格や確かめる作業から見えた、他のタスクでも起こりうる落とし穴を返す（このタスクだけの誤りは issues に書けば足りる）。`
}

// 担当が返した lessons とレビューの不合格を、merge・block の担当に渡す材料にする
function lessonsNote(t, notes) {
  const lines = notes.length ? notes.map(n => `- ${n}`).join('\n') : '- （なし）'
  return `docs/tasks/lessons.md の末尾に「### ${t.id} ${t.title}」の見出しを足し、次の材料を、そのファイルの「書き方」に沿って [未還元] の項目にする。同じことを言っている材料は 1 項目にまとめ、他のタスクに通じないもの（このタスクだけの誤り）は落とす。残る項目が無ければ見出しも足さない。
材料:
${lines}`
}

function mergePrompt(t, notes) {
  return `タスク ${t.id}「${t.title}」はレビューに合格しました。完了の処理と main へのマージをしてください。
${PLACES}
1. タスクの worktree（${wt(t)}）の中で、${t.path} の front matter を status: done にし、「## 完了の条件」の節の中のチェックボックスだけを [x] にする（受け入れ条件・テストケースの [ ] は変えない。sed なら '/^## 完了の条件/,/^## /' に範囲を絞る）。docs/tasks/README.md の状態欄も done にする。${statusRule(t, 'と、完了の条件のチェックボックス')}
   ${lessonsNote(t, notes)}
   コミットする（例: docs(${t.id}): 完了にする）。
2. 共有のチェックアウトが main で、作業ツリーがきれいなことを確かめる。違えば何も変えずに ok=false にして、状態を detail に書く。
3. 共有のチェックアウトで git merge --no-ff task/${t.id} -m "merge(${t.id}): ${t.title}" を実行する。
4. 競合したら、共有のチェックアウトでは git merge --abort して、ファイルは編集しない。代わりにタスクの worktree の中で git merge main を行い、両方の意図を残して解消し、pnpm verify が通ることを確かめてからコミットする。そのあと 3 をやり直す。
5. 共有のチェックアウトで git worktree remove ${wt(t)} を実行する。未追跡のファイルが理由で断られたら、worktree の中で git status --porcelain が空（コミット漏れが無い）ことを確かめてから --force を付けて消す。続けて git branch -d task/${t.id} でブランチを消す。
6. 共有のチェックアウトが main で作業ツリーがきれいなことを確かめる。push はしない。
ok は、main にマージされ、共有のチェックアウトの作業ツリーがきれいなときだけ true にする。`
}

function blockPrompt(t, reason, notes) {
  return `タスク ${t.id}「${t.title}」は、何度やってもレビューに合格しませんでした。blocked として記録してください。
理由: ${reason}
${PLACES}
1. タスクの worktree（${wt(t)}）に未コミットの変更があれば、その中で wip(${t.id}): 途中の状態 としてコミットする。worktree とブランチは消さない。
2. main の上での記録は、共有のチェックアウトを編集せずに行う。共有のチェックアウトで git worktree add --detach .claude/worktrees/block-${t.id} main を実行し、その一時の worktree の中で:
   - ${t.path} の front matter を status: blocked にし、docs/tasks/README.md の状態欄も blocked にする。${statusRule(t)}
   - docs/tasks/implementation-log.md に「${t.id} は blocked。理由、最後の指摘、task/${t.id} ブランチ（${wt(t)}）に途中の作業がある」と追記する。
   - ${lessonsNote(t, notes)}
   - docs(${t.id}): blocked にする としてコミットする。
3. 共有のチェックアウト（main で作業ツリーがきれいなこと）で git merge --ff-only <2 のコミット> を実行して main を進める。
4. 共有のチェックアウトで git worktree remove .claude/worktrees/block-${t.id} を実行して一時の worktree を消す。push はしない。
ok は、main に blocked の記録が入り、共有のチェックアウトの作業ツリーがきれいなときだけ true にする。`
}

// ---- 状態を読む ----
phase('State')
const state = await agent(
  `gear-simulator リポジトリの状態を読んでください。ファイルは変更しない。
- 共有のチェックアウト（git worktree list の先頭の行）の今のブランチ名と、未コミットの変更があるか。
- 既存の task/* ブランチ（git branch --list 'task/*'）。
- git worktree list のうち .claude/worktrees/task-* にある worktree の、共有のチェックアウトからの相対パス、ブランチ名、未コミットの変更があるか。
- docs/tasks/README.md の表にあるすべてのタスクについて、表の順に、ID、題名、資料のパス、資料の front matter の status、依存を返す。
- 依存の「S1-01〜S1-30」「S2-01〜S2-04」のような範囲表記は、個別の ID に展開する。依存が「-」なら空配列。`,
  { label: 'read-state', schema: STATE_SCHEMA, effort: 'low' },
)

if (state.currentBranch !== 'main' || state.dirty) {
  log(`共有のチェックアウトが main でないか、未コミットの変更があります（ブランチ: ${state.currentBranch}、dirty: ${state.dirty}）。main のきれいな状態にしてから起動し直してください。作業中のタスクは .claude/worktrees/task-<ID> に残っていれば続きから進みます。`)
  return { aborted: true, reason: 'shared checkout is not clean main', branch: state.currentBranch, dirty: state.dirty }
}

const tasks = state.tasks
const byId = Object.fromEntries(tasks.map(t => [t.id, t]))
// 再開の判定: status が doing のタスク、次に worktree かブランチが残っているタスクを優先する
const leftover = new Set([
  ...state.taskWorktrees.map(w => w.branch.replace(/^refs\/heads\//, '')),
  ...state.taskBranches,
].filter(b => b.startsWith('task/')).map(b => b.slice('task/'.length)))
const results = []

function ready(t) {
  return (t.status === 'todo' || t.status === 'doing') && t.depends.every(d => byId[d] && byId[d].status === 'done')
}

function pickNext() {
  return tasks.find(t => ready(t) && t.status === 'doing') || tasks.find(t => ready(t) && leftover.has(t.id)) || tasks.find(ready)
}

log(`タスク ${tasks.length} 本。done ${tasks.filter(t => t.status === 'done').length} 本、blocked ${tasks.filter(t => t.status === 'blocked').length} 本。途中の worktree・ブランチ: ${[...leftover].join(', ') || 'なし'}`)

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
  // lessons.md に書く材料（担当の lessons と、レビューの不合格。末尾の #n で何回目の差し戻しかが分かる）
  const notes = []
  const collect = (r, who) => {
    for (const l of (r && r.lessons) || []) notes.push(`〔${l.kind}〕${l.text} 根拠: ${l.evidence}（${who}）`)
  }
  collect(impl, 'impl')

  // 実装 → レビュー → 差し戻し（最大 MAX_FIXES 回）→ 新しい担当で 1 回やり直し
  const attempts = [...Array(MAX_FIXES).fill('fix'), 'retry']
  for (let i = 0; i <= attempts.length; i++) {
    if (impl && impl.outcome === 'ready') {
      review = await agent(reviewPrompt(t), { label: `review:${t.id}#${i + 1}`, phase: 'Tasks', schema: REVIEW_SCHEMA })
      collect(review, `review#${i + 1}`)
      if (review && !review.pass) {
        for (const issue of review.issues) notes.push(`〔レビューの指摘〕${issue}（review#${i + 1} で不合格）`)
      }
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
    collect(impl, `${mode}#${i + 1}`)
  }

  if (passed) {
    const merged = await agent(mergePrompt(t, notes), { label: `merge:${t.id}`, phase: 'Tasks', schema: DONE_SCHEMA, effort: 'low' })
    if (merged && merged.ok) {
      t.status = 'done'
      log(`${t.id} 完了・main にマージ済み`)
      results.push({ id: t.id, status: 'done', summary: impl && impl.summary })
      continue
    }
    lastIssues = [`マージに失敗: ${merged ? merged.detail : '結果が返らなかった'}`]
  }

  await agent(blockPrompt(t, lastIssues.join(' / '), notes), { label: `block:${t.id}`, phase: 'Tasks', schema: DONE_SCHEMA, effort: 'low' })
  t.status = 'blocked'
  log(`${t.id} は blocked。依存していないタスクを続ける`)
  results.push({ id: t.id, status: 'blocked', issues: lastIssues })
}

const remaining = tasks.filter(t => t.status !== 'done')
const waiting = remaining
  .filter(t => t.status !== 'blocked')
  .map(t => ({ id: t.id, waitingOn: t.depends.filter(d => !byId[d] || byId[d].status !== 'done') }))
log(`終了。done ${tasks.length - remaining.length}/${tasks.length}、blocked ${remaining.filter(t => t.status === 'blocked').length}、依存待ち ${waiting.length}`)

// ---- 知見を還元する ----
// 中断した実行では回らない。lessons.md の [未還元] は残るので、再開して最後まで回ったときにまとめて還元する
phase('Retro')
const retro = await agent(
  `implement-all の実行が終わりました。共有のチェックアウトにある .claude/skills/retro/SKILL.md を読み、その手順に従って docs/tasks/lessons.md の知見を還元してください。
${PLACES}
この実行で扱ったタスク: ${results.map(r => `${r.id}（${r.status}）`).join('、') || 'なし'}
人には聞かない。見送るかどうかも自分で決め、理由を PR の本文と lessons.md に残す。PR は ready で出し、マージはしない。`,
  { label: 'retro', phase: 'Retro', schema: RETRO_SCHEMA },
)
log(`Retro: ${retro ? `${retro.outcome} ${retro.prUrl || retro.branch || ''}` : '結果が返らなかった'}`)

return {
  thisRun: results,
  blocked: remaining.filter(t => t.status === 'blocked').map(t => t.id),
  waiting,
  retro,
  next: '人が確かめる項目は docs/tasks/manual-checks.md、仮定と blocked の理由は docs/tasks/implementation-log.md を見る。Retro の PR をレビューしてマージする（Retro が失敗していれば /retro で回し直す）',
}
