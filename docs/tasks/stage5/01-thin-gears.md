---
id: S5-01
title: 歯車とラックを 0.5 mm 刻みで薄くできるようにする
status: todo
depends: []
---

# S5-01 歯車とラックを 0.5 mm 刻みで薄くできるようにする

## 目的
厚さの下限が 4 mm なので、小の歯車（既定 30 歯・直径 30 mm）でも直径と厚さの比が約 7.5 : 1 にとどまり、分厚く見える。腕時計の歯車のような薄い歯車を作れるように、厚さを 0.5 mm から 0.5 mm 刻みで選べるようにする。

## 範囲
- 歯車（厚さを変えられる種類。`isWidthAdjustable`）とラックの厚さの範囲を **0.5〜32 mm、0.5 mm 刻み**にする
  - 刻みは軸方向の配置の刻み `AXIAL_SNAP`（4 mm）と切り離し、厚さ専用の定数（例: `GEAR_WIDTH_STEP = 0.5`）にする。`GEAR_WIDTH_RANGE.min` を 0.5 にする
  - `setGearWidth` / `setRackWidth`: 範囲外、または 0.5 mm の倍数でない値は `invalidValue`
  - `validateScene` の `invalidWidth` も同じ規則にする（4 mm の倍数でなくてもよくなる）
  - プロパティの［−］［＋］は 0.5 mm ずつ動かす。数値を入力したときは、0.5 mm の倍数に丸めてから範囲に収める
- 新しく置く歯車の既定の厚さは今のまま（大きさごとの `GEAR_SIZES[size].faceWidth`: 4 / 8 / 12 mm）
- 軸方向に置く位置（シャフト上の位置・`offset`）の刻みは 4 mm のまま。薄い歯車は 4 mm の区画の中に置かれる
- 薄くしても、かみ合い（厚さ方向に少しでも重なればかみ合う）・干渉・シャフトの範囲の計算が今どおり成り立つこと
- 浮動小数の比較: 0.5 mm 刻みは 2 進数で正確に表せるが、倍数の判定は誤差を許す形にする（`Math.round(w / step) * step` と比べるなど）

## 範囲外
- プロパティの欄の見た目（mm の位置・注意書きの文言）→ S5-02
- かさ歯車・ウォーム・ウォームホイールの厚さ（今どおり固定）
- 薄い歯車の肉抜き（スポーク）

## 作るもの
- `src/core/constants.ts`: 厚さの刻みの定数、`GEAR_WIDTH_RANGE` の下限
- `src/core/edit/commands.ts`: `setGearWidth`・`setRackWidth` の検証を新しい刻みに
- `src/core/scene/validate.ts`: `invalidWidth` の判定
- `src/ui/properties.ts`: `widthRows` の刻みを厚さ専用の定数に
- **design.md の書き換え**: §3（厚さの範囲と刻み）、§4（`width` の説明）

## 関連箇所
- `widthRows`（`src/ui/properties.ts`）は今 `AXIAL_SNAP` を刻みに使っている
- 厚さを使う所は S4-05 の資料の「調査で分かった今の作り」を参照（描画・干渉・かみ合いの重なり・`requiredSpanOf`・情報表示の矢印・性能のシーン）
- 形のキャッシュ `gearShapeKey`（`src/core/geometry/shape-key.ts`）は厚さを含む。0.5 mm の値でキーが正しく分かれるか確かめる
- 影響を受けるテスト: `setGearWidth` / `setRackWidth` / `validateScene` の Vitest（2 mm を `invalidValue` としている箇所など）、`grep -rln "prop-width" e2e` で出る spec
- 保存形式: 変えない（`width` は version 4 から入っている。0.5 mm の値もそのまま数値として保存される）

## 受け入れ条件
- [ ] 平歯車を選び、厚さの［−］を押すと 0.5 mm ずつ薄くなり、0.5 mm で［−］が押せなくなる
- [ ] ラックも同じく 0.5 mm まで薄くできる
- [ ] 1 mm の平歯車どうし、1 mm と 8 mm の平歯車がかみ合って回る
- [ ] 新しく置いた歯車の厚さは今までと同じ
- [ ] 0.5 mm 刻みの厚さが、保存・読み込み・Undo/Redo で保たれる

## テストケース
### Vitest
- [ ] `setGearWidth`: 0.5・1・1.5・32 mm → 通る。0・0.25・0.7・32.5 mm → `invalidValue`
- [ ] `setRackWidth`: 同上
- [ ] `validateScene`: `width: 1.5` → 通る。`width: 0.3` → `invalidWidth`
- [ ] 1 mm の平歯車 2 枚が隣の軸でかみ合いとして認識され、速度比が今と同じ
- [ ] 同じシャフトの、4 mm 離れた位置にある 1 mm の歯車 2 枚は干渉しない
- [ ] 厚さ 1.5 mm のシーンを保存・読み込み → 同じ値
### Playwright
- [ ] 小の平歯車を選び、厚さの［−］を 7 回押す → `__gearSim` の `width` が 0.5、［−］が無効

## 人が手で確かめる項目
- 0.5〜1 mm の歯車を斜めや真横から見て、薄い板として破綻なく描かれるか（影・縁の見え方）

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した
- [ ] `status: done` にしてコミットした
