---
id: S2-05
title: 音・テーマ・保存形式の拡張
status: todo
depends: [S2-01, S2-02, S2-03, S2-04]
---

# S2-05 音・テーマ・保存形式の拡張

## 目的
S2-01〜S2-04 で入れた 4 種類の歯車を、音・テーマ・保存・画面 UI まで段階 1 と同じ水準にそろえ、段階 2 を締める。完了すると、パレットから種類を選んで組み、保存・読み込みでき、種類ごとに違う音と材質で鑑賞できる。

## 範囲
- **音**（S1-25・S1-26 の拡張。音の高さ = 歯の通過頻度の考え方は変えない）
  - かみ合いの種類（`MeshKind`）ごとに音色を変える
    | 種類 | 音色 |
    |---|---|
    | `'spur'`・`'bevel'` | 段階 1 と同じ（クリック＋うなり） |
    | `'helical'` | クリックを弱め（平歯車の 0.4 倍）、うなりを強める。なめらかにかみ合う音 |
    | `'crossedHelical'` | `'helical'` と同じに、すべりの雑音を弱く（`'worm'` の 0.3 倍）足す |
    | `'worm'` | クリックをさらに弱め（0.2 倍）、すべりの雑音（帯域を絞ったノイズ）を足す。雑音の強さは周速に比例して上がり、上限で頭打ち |
  - ウォームの組の歯の通過頻度は `条数 × ウォームの回転数` = `ホイールの歯数 × ホイールの回転数`（どちらで計算しても同じ）
  - 倍率などの値は `audio-model` の定数にまとめ、手で聞いて調整してよい（調整したら資料の表も直す）
- **テーマの材質**（S1-24 の拡張）
  - 歯車の種類ごとに材質を割り当てる表を持つ（`Record<GearKind, …>` で、種類の追加漏れを型で検出する）
    | 種類 | 真鍮 | 木製 |
    |---|---|---|
    | 平歯車・ハスバ・かさ・ねじ | 真鍮 | 明るい木 |
    | ウォーム | 鋼（銀色） | 濃い木 |
    | ホイール | 青銅（真鍮より赤み） | 明るい木 |
  - 音の材質（`AudioMaterialId`）はテーマで決まるまま（種類では変えない）
- **保存形式の version 2**（S1-28 の拡張）
  - `CURRENT_SAVE_VERSION = 2`。`MIGRATIONS[1]`（version 1 → 2）を登録する。version 1 のシーンは平歯車と `root`/`mesh`/`detached` だけなので、中身はそのままで `version` だけ 2 にする
  - version 2 の検証（形は `parseScene`、意味は `validateScene`。S1-28）: 歯車の種類ごとのフィールド（`hand`、`apex`、ウォームの `teeth === 1` など）、配置 `'bevel'`・`'skew'` の整合（親子の種類、`axisStep` が 1 か 2、子の `apex === -side` など）。不正なら S1-28 と同じくエラーの結果を返す
  - 段階 2 の部品を含むシーンを、段階 1 だけのアプリ（version 1 までしか読めない）に読ませると `unsupported-version` になる（version を上げる理由）
- **パレット**: 「生やす歯車の種類」を選ぶ欄を足す（平歯車・ハスバ・かさ・ウォーム・ホイール・ねじ歯車）。同じ軸の候補はこの種類で作る（S2-01 で足した引数に渡す）。選んでいる種類は、パレットで選んでいる大きさ（S1-17）と同じ所に持つ（シーンには含めず、Undo の対象にしない）。外周の候補の種類は親で決まる（ハスバ → 逆向きのハスバ、かさ → かさ、ウォーム ↔ ホイール、ねじ → ねじ）
- **プロパティパネル**（S1-20 の拡張）
  - 種類の名前を表示する
  - ハスバ: ねじれの向き（左／右）を表示するだけ（編集しない）
  - かさ: 歯数を変えると、かみ合うかさ歯車も同じ歯数になることを注記する。「向きを反転」ボタン（S2-02 のコマンド）
  - ウォーム: 「1 条」を表示し、歯数は編集させない
  - ホイール・ねじ: 歯数を編集できる
- **情報表示**（S1-23 の拡張）: ウォームの組のギア比を `30:1` のように表示する
- **国際化**: 種類の名前、ねじれの向き、注記などのキー（日・英）
- **通しテストと見た目確認の場面を追加**（S1-31 の拡張）

## 範囲外
- 固定具・内歯車・遊星・ラック（S3-01〜S3-04）
- 段階 3 の保存形式（S3-05）
- 音階に合わせて鳴らすモード、テーマの追加（範囲外（拡張候補））

## 作るもの
- `src/core/audio-model/`: かみ合いの種類から音色の係数を返す関数（シグネチャ案）
  ```ts
  export function meshTimbre(kind: MeshKind): { click: number; hum: number; slideNoise: number }; // 平歯車を 1 とした倍率
  export function slideNoiseLevel(kind: MeshKind, pitchLineSpeed: number): number; // 0〜1
  ```
  - `computeMeshVoices` の結果に `kind` を足し、合成側はこの係数で音を作る
- `src/audio/`: すべりの雑音の合成（ノイズ源＋帯域通過フィルタ）
- `src/render/` のテーマ: 種類ごとの材質の表
- `src/core/io/`: `MIGRATIONS[1]`、version 2 の検証、`CURRENT_SAVE_VERSION = 2`
- `src/ui/`: パレットの種類の欄、プロパティパネルの種類ごとの表示
- テスト用のフィクスチャ
  - `src/core/io/` のテストの隣に version 1 のファイル（S1-28 のフィクスチャを使えれば使う）
  - `e2e/fixtures/stage2-showcase.json`: 平歯車・ハスバ・かさ・ウォーム・ねじ歯車を 1 つずつ含み、モーター 1 つで全部が回るシーン（干渉なし、ロックなし）
- **design.md の書き換え**
  - §9: いまの最新が version 2 であること、version 1 → 2 の移行の中身
  - §7: テーマの材質を歯車の種類ごとに持つこと。パレットで選んだ種類を `AppState` に持つなら、その欄
  - §10: `getAudio` の `voices` に `kind` を足したこと

## 受け入れ条件
- [ ] パレットで種類を選び、同じ軸の候補からその種類の歯車を作れる
- [ ] 種類ごとに音色が違って聞こえる（特にウォームのすべり音）
- [ ] 真鍮・木製の両テーマで、ウォームとホイールが他と違う材質で描かれる
- [ ] 段階 2 の部品を含むシーンを保存・エクスポートして読み戻すと、元と同じになる
- [ ] 段階 1 で保存した version 1 のファイル・作品・自動保存が読める

## テストケース
### Vitest
- [ ] `meshTimbre`: `'helical'` の `click` < `'spur'` の `click`。`'worm'` の `slideNoise` > 0、`'spur'`・`'bevel'`・`'helical'` の `slideNoise` = 0。`'crossedHelical'` の `slideNoise` は `'worm'` より小さく 0 より大きい
- [ ] `computeMeshVoices`: S2-03 の `worm-basic`（ウォーム 60 rpm、ホイール 30 歯）→ その組の f = 1 Hz、`kind: 'worm'`
- [ ] `computeMeshVoices`: S2-01 の `helical-pair`（A 20 歯 60 rpm）→ f = 20 Hz、`kind: 'helical'`
- [ ] `slideNoiseLevel('worm', 0)` = 0、周速が上がると単調に増え、1 を超えない
- [ ] 材質の表: すべての `GearKind` に、両テーマの材質がある（型と実行時の両方）
- [ ] 移行: version 1 のファイル（平歯車 3 枚・モーター 1 つ）→ `parseSaveFile` → `ok`、`migratedFrom === 1`、`file.version === 2`、`file.scene` が元のシーンと `toEqual`
- [ ] 往復: `stage2-showcase` → `serializeSaveFile` → `parseSaveFile` → 元と `toEqual`、`migratedFrom === null`
- [ ] 検証: version 2 で、ハスバに `hand` がない／ウォームの `teeth: 2`／`'bevel'` の子の `apex === side`／`'skew'` の `axisStep: 0` → いずれも `ok: false`（例外にしない）
- [ ] version 3 のファイル → `unsupported-version`
### Playwright（`e2e/stage2.spec.ts`）
- [ ] 通し: 空のシーン → 縦のシャフトを置く → パレットで「かさ」を選び、同じ軸の候補からかさ歯車 A → A のかさ歯車の候補から B（横）→ B のシャフトに、パレットで「ウォーム」を選んで同じ軸の候補からウォーム W → W からホイール H → A のシャフトにモーターを付ける → H のシャフトの ω が `A の ω × (±1) / 30`（符号は S2-02・S2-03 の式から計算）→ 保存して再読み込み → 同じシーン → Ctrl+Z で H が消える
- [ ] `stage2-showcase.json` を読む → `locks` と `interferences` が空、すべてのシャフトの ω が 0 でない
- [ ] プロパティ: ウォームを選ぶと歯数の入力がない（または無効）。かさ歯車の歯数を 24 にすると、相手のかさ歯車も 24 になる
- [ ] エクスポート → インポートで `stage2-showcase` が元と等しい。ダウンロードしたファイルの `version === 2`
- [ ] version 1 のファイルをインポート → 読み込める
- [ ] `getAudio().voices` に、ウォームの組の音源がある（`kind` を返すよう `getAudio` を広げる）
### Playwright（見た目、`e2e/visual/stage2.spec.ts`）
- [ ] `stage2-showcase.json` を真鍮・木製で全体表示 → `screenshots/stage2-showcase-brass.png`、`screenshots/stage2-showcase-wood.png`
- [ ] ハスバ・かさ・ウォーム・ねじ歯車の拡大を各テーマで（8 枚）→ `screenshots/stage2-<種類>-<テーマ>.png`
- [ ] 情報表示 ON でウォームの組のギア比が出ている場面 → `screenshots/stage2-info-worm.png`
- [ ] パレットとプロパティパネルの日本語・英語 → `screenshots/stage2-ui-ja.png`、`screenshots/stage2-ui-en.png`

## 人が手で確かめる項目
- 種類ごとの音色の違いが分かり、どれも耳障りでない。ウォームのすべり音が速さに応じて自然に変わる
- ウォーム（鋼）とホイール（青銅）の材質が、両テーマで他の歯車と見分けられ、浮いて見えない
- パレットの種類の名前と、外周の候補の種類が親で決まることが、使っていて分かりやすい

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（§7、§9、§10 の `getAudio`）
- [ ] `status: done` にしてコミットした
