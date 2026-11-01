---
id: S5-02
title: プロパティの厚さの欄をそろえ、括弧書きをなくす
status: done
depends: [S5-01]
---

# S5-02 プロパティの厚さの欄をそろえ、括弧書きをなくす

## 目的
プロパティパネルの厚さの行は［−］入力［＋］の右に「mm」が付いていて、すぐ上の歯数の行（［−］入力［＋］だけ）と幅がそろわない。また注意書き「4〜32 mm（4 mm 刻み）」のような括弧書きが読みにくい。見た目をそろえ、プロパティパネルの文言から括弧書きをなくす。

## 範囲
- 厚さの行から単位の欄（`properties.width.unit` の `gs-prop__unit`）をなくし、［−］入力［＋］の並びと幅を歯数の行とそろえる
- 単位は注意書きに書く。例: ja「0.5〜32 mm、0.5 mm 刻み」、en「0.5–32 mm, in 0.5 mm steps」
- `properties.*` の見出し・値・注意書き・ツールチップから括弧書き（ja の「（）」、en の「()」）をなくし、言い換える。今あるもの（ja / en の両方）:
  - `properties.width.range`
  - `properties.bevel.flip.tooltip`
  - `properties.axis.x` / `properties.axis.z`（例: 「横 X」「横 Z」など、括弧を使わない表し方に）
  - `properties.axis.hint`
  - `properties.motor.rpm`（例: 「回転数 rpm」）
  - `properties.carrier.planetCount.disabled` / `properties.carrier.note`
  - `properties.internal.web` / `properties.internal.web.flip.tooltip`
  - `properties.planetary.role.ring` / `properties.planetary.teethNote` / `properties.planetary.ringNote`
  - `properties.anchor.gearNote`
  - 実装時に `grep -n "^\s*'properties\.[^']*':.*[（(]" src/core/i18n/*.ts` と、複数行の値も含めて確かめ直す
- 言い換えで意味が変わらないこと（読点や「・」でつなぐ、文を分けるなど）

## 範囲外
- `properties.*` 以外の文言（ツールバーのショートカット表記「（M）」、パレットのツールチップ「小（モジュール 1）」など）は今のまま
- 厚さの刻みそのもの → S5-01

## 作るもの
- `src/ui/properties.ts`: `widthRows` から単位の欄をなくす
- `src/core/i18n/ja.ts` / `en.ts`: 上の文言の書き換え。使わなくなった `properties.width.unit` を消す
- 必要なら CSS（`gs-prop__stepper` の幅）

## 関連箇所
- `widthRows`・歯数の行（`gearSection` の中の `prop-teeth-dec` / `prop-teeth-inc`）（`src/ui/properties.ts`）
  - S5-01 で済み: `widthRows` の刻みは `GEAR_WIDTH_STEP`（0.5 mm）、入力欄は `numberField(..., step)` で 0.5 mm の倍数に丸める（`parseClampedStep`）。`properties.width.range` の `{min}`・`{step}` には 0.5 が入る
- 影響を受けるテスト: 文言を直に比べている e2e（`grep -rln "mm（\|rpm\|properties\.width" e2e`）と i18n の Vitest
- 見た目の確認: `e2e/visual/` のプロパティパネルが写る場面（`ui-ja-settings` など）を撮り直して Read で見る
- 保存形式: 変えない

## 受け入れ条件
- [x] 歯数の行と厚さの行で、［−］入力［＋］の左端・右端・入力欄の幅がそろう
- [x] 厚さの注意書きに単位と刻みが括弧なしで書かれている（ja / en）
- [x] プロパティパネルの文言（ja / en）に括弧書きが残っていない

## テストケース
### Vitest
- [x] ja / en の `properties.*` の値に「（」「）」「(」「)」が含まれない
### Playwright
- [x] 平歯車を選ぶ → `prop-teeth-dec` と `prop-width-dec`、`prop-teeth-inc` と `prop-width-inc` の x 座標と幅がそれぞれ等しい（`boundingBox` で比べる）

## 人が手で確かめる項目
- 日本語と英語の両方で、プロパティパネルの並びと言い換えた文言が自然に読めるか

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した
- [x] `status: done` にしてコミットした
