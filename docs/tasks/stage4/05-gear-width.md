---
id: S4-05
title: 歯車の厚さを変えられるようにする
status: doing
depends: [S4-03]
---

# S4-05 歯車の厚さを変えられるようにする

## 目的
歯車の厚さ（歯幅）は大きさごとの固定値で、変えられない。歯車ごとに厚さを変えられるようにする。

## 範囲
- 調査で分かった今の作り
  - 厚さは `GEAR_SIZES` の固定値（S 4 mm / M 8 mm / L 12 mm、`src/core/constants.ts`）。`GearBase` に厚さの欄は無い（S4-03 で省略できる `width` を足した）
  - 厚さを使う所: 描画（`gear-geometry.ts:37,113,137,218`、`rack.ts:53`）、干渉（`collision.ts:66` の `halfWidth`）、かみ合いの重なり（`mesh-snap.ts:26`、`resolve.ts:648,823`）、シャフトの範囲（`resolve.ts` の `requiredSpanOf`。S4-03 で `spanOf` から改名）、検証（`validate.ts:623`）、情報表示の矢印（`info-arrows.ts:46`）、性能のシーン（`perf-scene.ts:96`）
  - S4-03 で決まったこと（このタスクの前提）:
    - `GearBase.width?` は型（`src/core/scene/types.ts`）・読み込み（`parseScene`）・検証（`validateScene` の `invalidWidth`。今は `AXIAL_SNAP` の正の倍数だけを見る。範囲 4〜32 mm はこのタスクで足す）・保存形式 version 4 に入っている。省いたときの値は `gearWidth(gear)`（`src/core/geometry/dimensions.ts`）。形・干渉・かみ合い・シャフトの範囲はまだ大きさごとの歯幅（`sectionWidth`・`GEAR_SIZES`）を使う
    - シャフトの範囲は `Shaft.span`。部品の範囲は `requiredShaftSpans`（`resolve.ts` の `requiredSpanOf`。区画の幅は `sectionWidth`）。`requiredSpanOf` を `width` に切り替えれば、厚くしてはみ出したときにシャフトが伸びるのは `applyCommand` の `fitShaftSpans` が自動で行う（伸縮したシャフトは伸ばすだけ、部品にぴったりのシャフトは部品についていく。design.md §4）
    - コマンドは干渉を理由に失敗しない決まりだが、S4-03 の `growGear`（coaxial）と `setShaftSpan` は `newInterferences(前, 後)` が空でなければ `notAllowed` にしている。`setGearWidth` の「ぶつかる → 拒否」も同じ形にできる（シャフトが伸びる分も含めて確かめる）
    - 保存するときに `width` を書くなら、`toSaveFile`（`withShaftSpans` を通している）で省いた歯車に `gearWidth` を入れるか、コマンドで作る歯車に `width` を持たせる
- 歯車ごとの `width` を使う。省略時は大きさごとの値。上の使う所をすべて `width` に切り替える
- 範囲: 4 mm 刻みで 4〜32 mm
- 変えられる種類: 平歯車・はすば歯車・内歯車・ねじ歯車（`crossedHelical`）・ラック。かさ歯車・ウォーム・ウォームホイールは固定のまま（プロパティに出さない。コマンドは拒否）
- 操作: プロパティパネルに厚さの数値と［−］［＋］のボタン
- 厚くしてシャフトの範囲からはみ出す → シャフトを自動で伸ばす（S4-03 の範囲を書き換える）
- 同じシャフトのほかの歯車やほかの部品とぶつかる → 変更を取り消し、理由を出す
- かみ合う 2 枚の厚さは違ってもよい。厚さの方向に少しでも重なっていればかみ合う
- 厚さは見た目と干渉・かみ合いの判定にだけ使う。音・運動（回転・力）には影響させない
- 保存形式: version は上げない（S4-03 の version 4 に、省略できる `width` が入っている）。保存するときは `width` を書く
- 国際化: プロパティの項目名、拒否の理由（日・英）

## 範囲外
- かさ歯車・ウォーム・ウォームホイールの厚さ
- 厚さによる音・力の変化

## 作るもの
- `src/core/edit/commands.ts`: `setGearWidth { gearId, width }`（範囲外・4 mm の倍数でない → `invalidValue`、固定の種類 → `notAllowed`、ぶつかる → 拒否）
- 厚さを使う所の `width` への切り替え
- `src/ui/properties.ts`: 厚さの欄
- **design.md の書き換え**: §3（厚さの定数が初期値になったこと）、§4（`width`）

## 受け入れ条件
- [x] 平歯車を選ぶと厚さの欄が出て、［＋］で 4 mm ずつ厚くなり、見た目に反映される
- [x] かさ歯車・ウォーム・ウォームホイールでは厚さの欄が出ない
- [x] 厚くしてはみ出すとシャフトが伸び、ぶつかるときは取り消されて理由が出る
- [x] 厚さの違う 2 枚がかみ合って回る
- [x] 厚さは保存・読み込みで保たれ、Undo/Redo できる

## テストケース
### Vitest
- [x] `setGearWidth`: 4〜32 mm の 4 mm の倍数 → 通る。2・36・6 mm → `invalidValue`。かさ歯車 → `notAllowed`
- [x] 厚くしてシャフトからはみ出す → シャフトの範囲が伸びる
- [x] 厚くして同じシャフトの歯車とぶつかる → 拒否
- [x] 厚さ 8 mm と 20 mm の平歯車の組 → かみ合いとして認識され、速度比が厚さに関係しない
- [x] 干渉判定が `width` を使う（厚くすると、前はぶつからなかった配置がぶつかる）
- [x] `width` を持つシーンを保存・読み込み → 同じ値
### Playwright
- [x] 平歯車を選び、厚さの［＋］を 2 回押す → `__gearSim` の歯車の `width` が 8 mm 増える

## 人が手で確かめる項目
- 厚い歯車・薄い歯車の見た目、厚さの違う組のかみ合いの見た目

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した
- [ ] `status: done` にしてコミットした
