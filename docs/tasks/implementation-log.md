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
| S1-02 | 資料のテストケースの `toothHalfAngleAt(1, 12, r_b) ≈ ±0.145805` を `±0.145804` に直した（資料とテストの両方） | 厳密な値は π/24 + inv(20°) = 0.14580408 で、小数 6 桁に丸めると 0.145804。0.145805 は丸めの誤りで、`toBeCloseTo(…, 6)` では通らないため |
| S1-02 | 歯車の形状にシャフトを通す穴は開けない | 穴の半径を合わせる S1-04 のシャフトの太さがまだ決まっておらず、シャフトの円柱が歯車を貫いて描かれれば見た目は足りるため。design.md §5 に書いた |
| S1-02 | 歯面の点は、半径ではなくインボリュートの展開角 t（r = r_b·√(1+t²)）を等分して取る。分割数の初期値は歯面 8、歯先 2、歯底 3。分割数が 1 以上の整数でなければ `RangeError` | 曲がりの強い基礎円の近くを細かく近似するため。初期値は資料の例のとおり |
| S1-02 | 歯底の円弧は、手前の歯との間の円弧を各歯の周期の先頭に置く（周期は 1 つ前の歯の歯面の下端の直後から始まる）。`r_f ≥ r_b` のときは歯面の下端の点が歯底の円弧の端を兼ね、`r_b > r_f` のときは半径方向の直線の下端の点が兼ねる | 点の重複を作らずに、12 回対称（点 i と点 i + 点数/z が回転で一致）を保つため |
| S1-02 | `GeometryCache.release` で、持っていないキーは何もしない（例外にしない） | 描画側の後片付けの順序の都合で二重に release しても壊れないようにするため |
| S1-02 | 作業は main の作業ツリーではなく `.claude/worktrees/S1-02`（`git worktree add`）で行った | 実行環境が共有の作業ツリーへの書き込みを禁止していたため |
| S1-03 | 歯車の中心を求める `gearCenter(shaftOrigin, axis, gear)` を `src/core/scene/gear-center.ts` に足した | 資料の「範囲」に式はあるが「作るもの」に関数が無く、S1-04・S1-09 が同じ式を使うため 1 か所にまとめた |
| S1-03 | `validateScene` のエラーの `code` は `idMismatch`・`missingRef`・`invalidKind`・`invalidSize`・`invalidAxis`・`notFinite`・`teethNotInteger`・`teethOutOfRange`・`offsetNotSnapped`・`rpmOutOfRange`・`invalidDirection`・`invalidMotorOn`・`multipleMotors`・`meshChildNotOnShaft`・`meshChildOffset`・`meshParentOnSameShaft`・`meshSizeMismatch`・`meshCycle` とした（`SceneErrorCode` 型） | 資料は「実装で決める」としていたため。S1-28 の読み込みでも使うので、型の上ではありえない値（不正な kind・size・on）も調べる |
| S1-03 | `meshCycle` は循環にかかわる `mesh` のシャフトごとに 1 件ずつ出す（2 本が互いを親にすれば 2 件）。参照切れで根に行き着かない場合は `missingRef` だけを出し、`meshCycle` は出さない | 問題の場所（`path`）をシャフトごとに示せるようにするため。参照切れを二重に報告しないため |
| S1-03 | `multipleMotors` の `id` はシャフトの ID、`path` は `shafts.<id>` にした。`meshChildOffset`・`meshSizeMismatch` の `id` は子の歯車 | どの部品に問題があるかを最も直接に示す場所にしたため |
| S1-03 | `createRandomIdGenerator` は `<kind>_` に英小文字と数字 10 文字を続ける（36^10 通り）。乱数を注入できる | 1000 回で重複しない確率が十分に高く、保存形式の ID として短いため |
| S1-03 | `shaftAxis` は参照先の歯車・シャフトが無いときも `null` を返す | 資料は循環のときだけ `null` としていたが、たどれないのは同じため |
| S1-04 | `Layout`・`Mesh` などの型は `src/core/layout/types.ts`、`MotionState`・`LockInfo`・`LockReason` と `emptyMotion()` は `src/core/kinematics/types.ts` に置いた | 資料の「作るもの」に型の置き場所が無く、render（描画の層）が app を import せずに使えるよう core に置いた。S1-07・S1-09 がそのまま使える |
| S1-04 | ストアに `dispatch` とは別に `setMotion(motion)` を足した。購読者には知らせない | 資料は `dispatch` を `loadScene` 相当だけに絞っており、毎フレームの運動の更新で購読者（後の自動保存など）を毎フレーム呼ばないため |
| S1-04 | `loadScene`（とストアの作成）の直後の運動は、角度 0、ω は暫定の運動を `dt = 0` で求めた値にした（`initialMotion`） | 読み込んだ直後に `getMotion().omegas` を読んでも次のフレームを待たずに正しい値が出るようにし、Playwright のテストが描画のタイミングに左右されないようにするため |
| S1-04 | 暫定の `resolveLayout` は、根にたどり着かない（参照切れ・循環の）シャフトと歯車を `Layout` に含めない。歯車の無いシャフトの `span` は `[0, 0]`。`mesh` のシャフトの子の歯車が別のシャフトに載っていれば、そのシャフトは置かない | 資料は「root・detached から mesh でたどれる木だけを扱う」としており、それ以外の扱いは S1-09 が決めるため |
| S1-04 | 仮の見た目の寸法はシャフトの太さ半径 1.5 mm、モーターは一辺 8 mm の立方体を、シャフトの `span` の負側の端から 1 mm 離して置いた。カメラは `(40, 75, 70)` から `(9, 18, 0)` を見る | 資料は「render 側の定数で仮に決める」としていたため。S・12 歯の歯底円半径（4.75 mm）より細く、固定シーンの全体が画面に入る位置にした |
| S1-04 | 起動時に固定シーンが出るようになったので、`e2e/visual/empty-scene.spec.ts` は `loadScene` で空のシーンを読んで 2 フレーム待ってから撮るようにした | 場面名（床のグリッドだけ）の意味を保つため |
| S1-04 | `src/app/demo-scene.test.ts` で、`demoScene` が `e2e/fixtures/two-spur.json` と等しく、`validateScene` を通ることを確かめる | 2 か所に同じシーンを持つので、ずれを防ぐため |
| S1-05 | 基準シャフトの選び方（優先の順に見て、それまでに選んだ行と独立なものを取る）は、拘束行列の列を優先の逆の順に並べてガウスの消去をし、ピボットにならなかった列（自由な列）を基準にすることで実現した。`linalg.ts` に `nullSpaceWithFreeColumns` を足した | 消去のピボットは左から貪欲に取られ、その補集合は双対のマトロイド（N の行）で右から貪欲に取ったものになるので、資料の選び方と一致する。基準の行が後から逆行列を掛けずに厳密に 1・0 になるため |
| S1-05 | 階数のしきい値は `相対しきい値（既定 1e-9）× 行列の成分の最大の絶対値` とし、部分ピボット選択つきで、行を正規化せずに消去する | 係数は歯数（整数）で大きさがそろっており、消去の途中で値の大きさが変わらないようにするため |
| S1-05 | ID の昇順は、`localeCompare` ではなく符号単位の比較（`<`）にした。長い減速の列のテストでは、10 本のシャフトの名前を `shaft_0`〜`shaft_9` にした | 実行環境のロケールに依らず決定的にするため。`shaft_10` は `shaft_2` より前に来るので、昇順に並ぶ名前にした |
| S1-05 | `KinematicComponent.meshes` は入力の `Mesh[]` の順のまま持つ。歯車のシャフトがシーンに無い `Mesh` も例外にする | 資料は順を決めていないが、入力が同じなら同じ順になり決定的なため。シャフトの無い歯車は呼ぶ側の不具合のため |
| S1-05 | 暫定の運動で、成分の「最初の ON のモーター」は、モーターの ID の昇順で最初のものとした。自由度 1 では `q = ω_m / n`（n はモーターのシャフトの行）、2 以上では `n·q = ω_m` を満たす最小ノルムの `q` にした。グラフは `Layout` をキーにした `WeakMap` に、シーンの参照と一緒に覚え、シーンが変わったときだけ作り直す | S1-04 は `Object.values` の順だったが、決定的にするため。`stepProvisionalMotion` の引数を変えずに済み、`store.ts`・`loop.ts` を変えなくてよいため。段階 1 では自由度 2 以上は出ない |
| S1-06 | `solveVelocities` は `paused` のとき `motorTorques` を空にする。自由度 0 の成分の ON のモーターも `motorTorques` に含め、値は `ω = 0` での `T_stall·d` にする | 資料は「ON のモーターだけ」としており、一時停止中は全モーターを OFF とみなすため。S1-07 の stalemate・contradiction の判定で、ON のモーターのトルクを成分によらず引けるようにするため |
| S1-06 | 線形代数は `linalg.ts` に `solveParticular`（自由な列の成分を 0 にした特解。階数のしきい値は S1-05 と同じ相対 1e-9）、`multiply`・`multiplyVector`・`transpose` を足して組んだ。`Nᵀ D N` の階数の判定もこのしきい値による | 資料は「自前の小さな実装でよい」としていたため。S1-05 の消去（`echelon`）を右辺つきに広げて使い回した |
| S1-06 | テスト「歯数比での相殺」の M の rpm は資料に無いので 30rpm にした | 速度 0 のつり合いでは停動トルクだけで決まり、rpm によらないため |
| S1-06 | `e2e/fixtures/opposing-motors.json` は `two-spur.json` の `gear_2` を 12 歯にし、`shaft_2` に `motor_2`（M 60rpm `direction 1`）を足したもの。spec は `e2e/force-balance.spec.ts` | 資料の指定どおりの配置で、ID の付け方を既存のフィクスチャに合わせたため |
| S1-07 | 手で回すときの ω は、`(θ_新 − θ_前) / dt` の `θ_前` を前の状態の各シャフトの角度ではなく `N q_前`（`q_前` は前の状態の基準シャフトの角度）とした | かみ合いの構成が変わった直後でも、ω が拘束 `ω = N q̇` を満たすようにするため。構成が変わらなければ同じ値になる |
| S1-07 | 手でつかんだシャフトがシーンに無ければ、手は無いものとして扱う。手で自由度 2 以上の成分を回すと例外にする。手でつかんだ自由度 0 の成分は、モーターが無くても `contradiction` にする | 資料のとおり（自由度 2 以上は S3-03）。消えたシャフトの手は S1-21 の後始末の前に 1 フレーム残りうるので、例外にしないため |
| S1-07 | 一時停止中に手で回すとき、モーターはすべて OFF とみなすので `backDriven` には入らない | 資料が「一時停止なら全モーターを OFF とみなす」としているため |
| S1-07 | 運動の ω の −0 は 0 にそろえる | `toEqual` が 0 と −0 を区別し、基底の負の成分と 0 の積で −0 が出るため |
| S1-07 | `e2e/fixtures/stalemate.json` は `opposing-motors.json` の `motor_2` を S にしたもの（`two-spur.json` と同じ配置で `gear_2` を 12 歯、両方に S 60rpm `direction 1`）。spec は `e2e/lock-detection.spec.ts`。`src/app/provisional-motion.test.ts` は、核の部分を `motion.test.ts`（シーンが変わればグラフを作り直す）と `store.test.ts`（最初の運動にロックが出る）に移して消した | 資料の指定どおりの配置で、ID を既存のフィクスチャに合わせたため。暫定の運動は資料の指示で消すため |
