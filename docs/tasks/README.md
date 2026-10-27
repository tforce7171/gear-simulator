# タスク一覧

[requirements.md](../requirements.md) を実装するためのタスク。共通の設計は [design.md](../design.md) を参照。

## 進め方

1. 依存するタスクがすべて `done` になっているタスクを 1 つ選び、資料の `status` を `doing` にする。
2. 資料の「テストケース」を先に書き、実装して通す。
3. `pnpm verify` が通ったら、`status` を `done` にしてコミットする（`feat(S1-05): ...`）。
4. 実装中に前提（design.md や後続のタスク資料）が変わったら、同じコミットで資料も書き換える。

### 自動実行

`.claude/workflows/implement-all.js` が、上の手順をタスクごとにエージェントで回す（Claude Code で「implement-all ワークフローを実行して」）。

- タスクごとに `task/<ID>` ブランチを切り、レビューに合格したら main に `--no-ff` でマージしてブランチを消す。この間だけ design.md §11 の「main に直接コミット」の例外とする。
- 差し戻しは 2 回まで。それでも駄目なら新しい担当で 1 回やり直し、なお不合格なら `blocked`（途中の作業は `task/<ID>` に残す）。`blocked` を `todo` に戻して起動し直すと再挑戦する。
- 仮定と `blocked` の理由は [implementation-log.md](implementation-log.md)、人が手で確かめる項目は [manual-checks.md](manual-checks.md) に貯める。
- `done` と `blocked` は飛ばすので、中断しても起動し直せば続きから進む。

## 段階 1: 基盤

| ID | 題名 | 依存 | 状態 |
|---|---|---|---|
| [S1-01](stage1/01-project-setup.md) | プロジェクトの土台 | - | done |
| [S1-02](stage1/02-involute-profile.md) | インボリュート歯形の生成と形状データの共有 | S1-01 | done |
| [S1-03](stage1/03-scene-and-mesh-geometry.md) | シーンのデータ形式と、かみ合いの幾何 | S1-02 | done |
| [S1-04](stage1/04-vertical-slice.md) | 最小の縦通し: 固定シーンを描画して回す | S1-03 | done |
| [S1-05](stage1/05-mesh-graph.md) | 運動学: かみ合いのグラフ、速度比、矛盾の検出 | S1-04 | done |
| [S1-06](stage1/06-force-balance.md) | 力のつり合い | S1-05 | done |
| [S1-07](stage1/07-lock-detection.md) | ロック判定と状態の出力 | S1-06 | done |
| [S1-08](stage1/08-collision.md) | 干渉判定 | S1-04 | done |
| [S1-09](stage1/09-layout-tree.md) | 配置の木構造 | S1-03, S1-08 | done |
| [S1-10](stage1/10-candidates.md) | 生やす候補の列挙 | S1-08, S1-09 | done |
| [S1-11](stage1/11-edit-commands-history.md) | 編集コマンドと Undo/Redo | S1-09 | done |
| [S1-12](stage1/12-i18n.md) | 日本語と英語の切り替えの仕組み | S1-01 | done |
| [S1-13](stage1/13-camera-basic.md) | カメラ（基本） | S1-04 | done |
| [S1-14](stage1/14-camera-advanced.md) | カメラ（応用） | S1-13, S1-15 | done |
| [S1-15](stage1/15-ui-shell.md) | 画面の骨組み | S1-04, S1-12 | done |
| [S1-16](stage1/16-selection.md) | 選択、ピッキング、Esc、Delete | S1-11, S1-13, S1-15 | done |
| [S1-17](stage1/17-root-shaft-placement.md) | 起点のシャフトを置く | S1-16 | done |
| [S1-18](stage1/18-grow-gears.md) | 候補の表示とクリックで歯車を生やす | S1-10, S1-16 | done |
| [S1-19](stage1/19-handles.md) | 外周の角度の円弧ハンドル、シャフト上の位置のドラッグ | S1-18 | done |
| [S1-20](stage1/20-property-editing.md) | プロパティの編集（歯数、モーター） | S1-07, S1-16 | done |
| [S1-21](stage1/21-hand-rotation.md) | 手で回す | S1-07, S1-16 | done |
| [S1-22](stage1/22-lock-interference-pause.md) | ロックの表示、干渉の警告、一時停止 | S1-07, S1-08, S1-16 | doing |
| [S1-23](stage1/23-info-overlay.md) | 情報表示 | S1-07, S1-15 | done |
| [S1-24](stage1/24-themes.md) | テーマと質感 | S1-04 | done |
| [S1-25](stage1/25-audio-basic.md) | 音（基本） | S1-07, S1-24 | done |
| [S1-26](stage1/26-audio-spatial.md) | 音（空間） | S1-13, S1-25 | done |
| [S1-27](stage1/27-storage.md) | 保存（IndexedDB） | S1-11, S1-15 | doing |
| [S1-28](stage1/28-json-io.md) | JSON のエクスポートとインポート | S1-27 | todo |
| [S1-29](stage1/29-context-menu.md) | コンテキストメニュー | S1-14, S1-20, S1-23 | todo |
| [S1-30](stage1/30-settings.md) | 設定画面 | S1-14, S1-24, S1-25 | todo |
| [S1-31](stage1/31-e2e-and-perf.md) | 通しテストと見た目の確認をそろえる、性能の計測 | S1-01〜S1-30 | todo |

## 段階 2: 軸の向きを変える歯車

| ID | 題名 | 依存 | 状態 |
|---|---|---|---|
| [S2-01](stage2/01-helical.md) | ハスバ歯車 | S1-31 | todo |
| [S2-02](stage2/02-bevel.md) | かさ歯車 | S1-31 | todo |
| [S2-03](stage2/03-worm.md) | ウォームギア | S1-31 | todo |
| [S2-04](stage2/04-crossed-helical.md) | ねじ歯車 | S2-01, S2-03 | todo |
| [S2-05](stage2/05-stage2-integration.md) | 音・テーマ・保存形式の拡張 | S2-01〜S2-04 | todo |

## 段階 3: 同軸・直線の機構

| ID | 題名 | 依存 | 状態 |
|---|---|---|---|
| [S3-01](stage3/01-anchor.md) | 固定具（アンカー） | S2-05 | todo |
| [S3-02](stage3/02-internal-gear.md) | 内歯車 | S2-05 | todo |
| [S3-03](stage3/03-planetary.md) | 遊星歯車とキャリア | S3-01, S3-02 | todo |
| [S3-04](stage3/04-rack-pinion.md) | ラック＆ピニオン | S2-05 | todo |
| [S3-05](stage3/05-stage3-integration.md) | 音・テーマ・保存形式の拡張 | S3-01〜S3-04 | todo |

## タスク資料のひな形

各タスクの資料は次の形で書く。Claude Code が 1 タスクずつ読んで実装する前提で書く。外から見える振る舞いとテストの観点を書き、内部の構造までは決めない。

````markdown
---
id: S1-05
title: 運動学: かみ合いのグラフ、速度比、矛盾の検出
status: todo
depends: [S1-03]
---

# S1-05 運動学: かみ合いのグラフ、速度比、矛盾の検出

## 目的
なぜこのタスクが必要か。完了すると何ができるようになるか。

## 範囲
- このタスクでやること

## 範囲外
- やらないこと（どのタスクでやるか）

## 作るもの
- `src/core/kinematics/graph.ts`
  ```ts
  export function buildMeshGraph(scene: Scene, layout: Layout): MeshGraph;
  ```
- 主なモジュールと関数の形（シグネチャの案）。型は design.md に合わせる

## 受け入れ条件
- [ ] 外から見て確かめられる条件

## テストケース
### Vitest
- [ ] 入力 → 期待する出力
### Playwright
- [ ] 操作 → 期待する状態（`__gearSim` で読む）

## 人が手で確かめる項目
- 自動テストで確かめにくいこと（なければ「なし」）

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した
- [ ] `status: done` にしてコミットした
````
