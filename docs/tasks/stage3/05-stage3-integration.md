---
id: S3-05
title: 音・テーマ・保存形式の拡張
status: todo
depends: [S3-01, S3-02, S3-03, S3-04]
---

# S3-05 音・テーマ・保存形式の拡張

## 目的
S3-01〜S3-04 で入れた固定具・内歯車・遊星歯車機構・ラックを、音・テーマ・保存・画面 UI まで段階 1・2 と同じ水準にそろえ、段階 3（＝要件の全範囲）を締める。

## 範囲
- **音**（S1-25・S1-26・S2-05 の拡張。S2-05 の時点: 種類ごとの音色は `MESH_TIMBRES`（`MeshKind` → `{ click, hum, slideNoise }`）、`MeshVoice` は `kind` と `slide`（すべりの雑音の強さ）を持ち、`src/audio/engine.ts` が連続音に `hum`、クリックに `click` を掛ける。こもらせる音色を足すなら `MeshTimbre` に欄を足す）
  - 内歯車の組（`'internal'`）: 平歯車と同じ音色で、うなりを少しこもらせる（高域を落とす）
  - 遊星のかみ合い: 歯の通過頻度は **キャリアに対する相対の回転** で求める（太陽と遊星の組なら `z_s·|ω_s − ω_c| / 2π`）。音源の位置は、公転に合わせて毎フレーム実際の位置（S3-03 の関数）に置く
  - ラックの組: 歯の通過頻度 `|v| / (π·m)`（Hz）。音色は平歯車と同じ
  - ラックが端に当たった瞬間に、1 回だけ「当たる音」（短い衝撃音。材質はテーマに合わせる）を鳴らす。その後のロック中は段階 1 のロックの音
  - 固定具そのものは音を出さない
  - 鳴らす音源の選び方（カメラに近い最大 16 個）は、ラックの組・遊星の組も同じ規則で数える
- **テーマの材質**（S2-05 の表の拡張）
  | 部品 | 真鍮 | 木製 |
  |---|---|---|
  | 内歯車 | 真鍮 | 明るい木 |
  | キャリア | 鋼（銀色） | 濃い木 |
  | ラック | 真鍮 | 明るい木 |
  | 固定具（台座・支柱） | 黒い鉄 | 濃い木 |
  - 歯車以外の部品の材質も、種類の追加漏れを型で検出できる表にする
  - S2-05 の時点: 歯車は `src/render/themes.ts` の `GEAR_KIND_MATERIALS`（`Record<GearKind, Record<ThemeId, GearMaterialId>>`）と `GEAR_MATERIAL_LOOKS`（`'brass' | 'steel' | 'bronze' | 'lightWood' | 'darkWood'` の見た目）。`ThemeLook` に歯車の欄は無く、`gearLook(theme, kind)` で引く。`SceneSync.setBaseMaterials` の `gear` は種類ごとの材質（同じ材質は共有）。シャフト・モーターは `ThemeLook.shaft`・`motor` のまま
- **保存形式の version 3**（S2-05 の拡張）
  - `CURRENT_SAVE_VERSION = 3`。`MIGRATIONS[2]`（version 2 → 3）で `anchors: {}`、`carriers: {}`、`racks: {}` を足す
  - S3-01・S3-03・S3-04 の「読み込みで足りないコレクションを `{}` で補う」暫定処理を取り除き、移行に置き換える。version 3 ではこれらのコレクションを必須にする
  - version 3 の検証: 固定具の対象が存在し、1 つの対象に 1 つ。遊星のシャフトに固定具・モーターがない。`planet` の親の歯車がキャリアのシャフトと同じ線上。`concentric` の親が存在し、循環しない。ラックの `pinion` の `axisStep` が 1 か 2、`detached` のラックの `direction` と `normal` が異なる。内歯車の歯数と歯数差、遊星の機構の条件（同心・等配・隣の遊星）
  - version 1 → 2 → 3 と順に移行できる
- **プロパティパネル**（S1-20・S2-05 の拡張）
  - 内歯車: 歯数（範囲は S3-02 の `teethRange`）、ウェブの向き（反転ボタン）
  - キャリア: 遊星の数（1〜6。条件を満たさない数は選べない）、固定する
  - 遊星歯車機構の中の歯車: 太陽・遊星の歯数は条件を満たす値だけ選べる。リングの歯数は表示だけ（太陽と遊星から決まる旨を注記）
  - ラック: 歯数（10〜60）、固定する
  - 遊星のシャフト: モーター・固定の項目を出さない
- **パレット**: 生やす種類に内歯車を足す（同じ軸の候補用）。パレットから固定具を選ぶ道具は作らない（固定はプロパティとコンテキストメニューで行う）
- **情報表示**（S1-23 の拡張）: キャリアの rpm、ラックの速度（mm/s）と向きの矢印を表示する。遊星は自転の rpm を表示する
- **コンテキストメニュー**: キャリア・ラックの上で「固定する／固定を外す」「ここに寄る」「削除」
- **国際化**: 新しい部品名、プロパティの項目、注記、メニューのキー（日・英）
- **通しテストと見た目確認の場面を追加**（S1-31・S2-05 の拡張）
  - S1-31 の時点: 通しテストは `e2e/flows/*.spec.ts`（操作は画面から、状態は `__gearSim`）。共通の操作（`openApp`・`fixtureScene`・`clickGear`・`gearPoint`・`clickPerimeterCandidate`・`deselect`・`setPaused`・`settleCamera`・`waitAutosaved` など）は `e2e/fixtures/sim.ts` にある。見た目の確認は `test.use({ viewport: VISUAL_VIEWPORT })`（1280×800）にし、撮る前に `prepareCapture(page)`（Space で一時停止してカメラの停止を待つ。ロックや回転の矢印を写す場面は `{ pause: false }`）を呼んでから `captureScene` する（`e2e/fixtures/visual.ts`）。性能は `pnpm perf`（`scripts/perf.ts`、`src/debug/perf-scene.ts` の `generatePerfScene`）で測る。

## 範囲外
- 慣性、ラック端のばね付き止め、テーマの追加、GIF や動画の書き出し（範囲外（拡張候補））
- 性能の計測スクリプトの変更（S1-31 のものを使う。遊星・ラックを含むシーンで手元で測るだけ）

## 作るもの
- `src/core/audio-model/`
  ```ts
  export function rackToothPassFrequency(velocity: number, module: number): number; // Hz
  export function planetToothPassFrequency(teeth: number, omega: number, carrierOmega: number): number; // Hz
  ```
  - `computeMeshVoices` がラックの組・遊星の組・内歯車の組も返し、位置は実際の位置にする
  - ラックが端に当たった瞬間を、前後のフレームの `locks` の変化から検出する関数
- `src/audio/`: 当たる音の合成、内歯車のこもった音色
- `src/render/` のテーマ: 部品ごとの材質の表
- `src/core/io/`: `MIGRATIONS[2]`、version 3 の検証、`CURRENT_SAVE_VERSION = 3`。暫定処理の削除
- `src/ui/`: プロパティパネル、パレット、情報表示、コンテキストメニューの拡張
- テスト用のフィクスチャ
  - `e2e/fixtures/stage3-showcase.json`: 遊星歯車機構（リングを固定）、内歯車の組、ラック、固定具を含み、モーター 1〜2 つで回るシーン（干渉なし、ロックなし。ラックは 10 秒以上端に達しない速さ）
  - version 2 のファイル: `e2e/fixtures/stage2-showcase.json`（S2-05。version 2 のまま使う）。ただしこれは `Scene` の形（`SaveFile` ではない）なので、ファイルとして読ませるときは `toSaveFile` で包む（S2-05 の `e2e/stage2.spec.ts` はエクスポートしたファイルを使った）か、`src/core/io/save-file-v1.json`（S2-05。version 1 の `SaveFile`）と同じように version 2 の `SaveFile` を足す
- **design.md の書き換え**
  - §4: 「段階 3 で anchors などのコレクションを足すときは…」を、version 3 で足したことに書き換える
  - §9: 最新が version 3、version 2 → 3 の移行の中身
  - §7: 歯車以外の部品の材質の表
  - §10: `getAudio` の `voices` にラックの組・遊星の組が入ること

## 受け入れ条件
- [ ] 段階 3 の部品を含むシーンを保存・エクスポートして読み戻すと、元と同じになる
- [ ] version 1・2 のファイル・作品・自動保存が読める
- [ ] 遊星のかみ合いの音が公転とともに動いて聞こえ、ラックの速さで音の高さが変わる。端に当たると衝撃音が鳴る
- [ ] プロパティパネルから遊星の数・ラックの歯数・内歯車の歯数を変えられ、条件を満たさない値は選べない
- [ ] 両テーマで新しい部品が描き分けられる

## テストケース
### Vitest
- [ ] `rackToothPassFrequency(40π, 2)` = 20（S3-04 の `rack-basic` の速さ。P 20 歯 × 1 回転/秒と同じ）
- [ ] `planetToothPassFrequency(24, 2π, 2π/3)`（S3-03 のリング固定、太陽 60 rpm・キャリア 20 rpm）= 24 × (1 − 1/3) = 16 Hz
- [ ] `computeMeshVoices`: `planetary-ring-fixed` → 太陽と遊星の組 3 つ・遊星とリングの組 3 つ。遊星とリングの組の f = `12 × |−2π − 2π/3| / 2π` = 16 Hz（太陽と遊星の組と一致する）。音源の位置が、キャリアの角度 π のとき基準配置から π 回った位置
- [ ] `computeMeshVoices`: `rack-basic` → ラックの組の f = 20 Hz
- [ ] 端に当たった瞬間の検出: 前のフレームに `'rackEnd'` がなく、今のフレームにある → 1 回。続くフレーム → 0 回
- [ ] 材質の表: すべての部品の種類に、両テーマの材質がある
- [ ] 移行: version 2 のファイル → `ok`、`migratedFrom === 2`、`version === 3`、`anchors`・`carriers`・`racks` が `{}`、他は元と `toEqual`
- [ ] 移行: version 1 のファイル → version 3 まで順に移行される（`migratedFrom === 1`）
- [ ] 往復: `stage3-showcase` → 保存 → 読み込み → 元と `toEqual`
- [ ] 検証: version 3 で `anchors` がない／遊星のシャフトにモーターがある／`concentric` が自分自身を親にする（循環）／`detached` のラックの `direction` と `normal` が同じ／`pinion` のラックの `axisStep: 3`／(z_s + z_r)/n が整数でない遊星の機構 → いずれも `ok: false`（例外にしない）
- [ ] 暫定処理の削除: version 3 と書かれていて `racks` がないファイル → `ok: false`
- [ ] version 4 のファイル → `unsupported-version`
### Playwright（`e2e/stage3.spec.ts`）
- [ ] 通し（遊星）: 空のシーン → 縦のシャフトを置く → 中・24 歯の平歯車 → 選んで遊星歯車機構の候補をクリック → リングを右クリック →「固定する」→ 太陽のシャフトにモーター（60 rpm）→ キャリアのシャフトの ω が `2 * Math.PI / 3` → キャリアを選んでプロパティで遊星の数を 4 → 遊星のシャフトが 4 本、ω は変わらない → 保存して再読み込み → 同じシーン → Ctrl+Z を繰り返して空に戻る
- [ ] 通し（ラック）: `one-root-motor.json`（S1-18）を読む → 歯車を選んでラックの候補をクリック → `rackVelocities` が 0 でない → 端まで待つ → `locks` に `'rackEnd'` → プロパティでモーターの向きを反転 → ロックが解ける
- [ ] プロパティ: 遊星の数の選択肢で、条件を満たさない数（z_s 24・z_r 48 で 5）が選べない。リングの歯数が編集できない
- [ ] `stage3-showcase.json` → `locks`・`interferences` が空。エクスポート → インポートで等しく、ファイルの `version === 3`
- [ ] version 2 のファイル（`stage2-showcase`）をインポート → 読める
- [ ] `getAudio().voices` に、ラックの組と遊星の組の音源がある
### Playwright（見た目、`e2e/visual/stage3.spec.ts`）
- [ ] `stage3-showcase.json` を真鍮・木製で全体表示 → `screenshots/stage3-showcase-brass.png`、`screenshots/stage3-showcase-wood.png`
- [ ] 遊星歯車機構の拡大（開いている側から）を各テーマで → `screenshots/stage3-planetary-<テーマ>.png`
- [ ] ラックの拡大、固定具の拡大を各テーマで → `screenshots/stage3-rack-<テーマ>.png`、`screenshots/stage3-anchor-<テーマ>.png`
- [ ] 情報表示 ON（キャリアの rpm、ラックの速度）→ `screenshots/stage3-info.png`
- [ ] キャリアとラックのプロパティパネルの日本語・英語 → `screenshots/stage3-ui-ja.png`、`screenshots/stage3-ui-en.png`

## 人が手で確かめる項目
- 公転する遊星の音が、近づくとよく聞こえ、動きに合って移動して聞こえる
- ラックの端の衝撃音が、ロックの音と重なっても耳障りでない
- 固定具（黒い鉄・濃い木）やキャリア（鋼）が、両テーマで他の部品と見分けられる
- `stage3-showcase` を含むシーンで、性能が段階 1 の目標（歯車 200 個で 60fps）から大きく落ちない（S1-31 のスクリプトで手元で測る）

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（§4、§7、§9）
- [ ] `status: done` にしてコミットした
