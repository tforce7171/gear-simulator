---
id: S2-04
title: ねじ歯車
status: todo
depends: [S2-01, S2-03]
---

# S2-04 ねじ歯車

## 目的
ねじれた位置の 90° で、歯数比どおりに回転を伝えるねじ歯車を入れる。ウォームと違って減速比を自由に選べ、どちら側からでも駆動できる。S2-01 のねじり押し出しの形状と、S2-03 で作った `'skew'` の配置・拘束を使う。

## 範囲
- **決めた値**（`src/core/constants.ts`）
  - ねじれ角 `CROSSED_HELIX_ANGLE = 45°`、ねじれの向きは右（固定）。同じねじれ角・同じ向きの 2 枚が、軸の角度 90°（45° + 45°）でかみ合う
  - モジュールは S2-01 と同じく軸直角モジュール。ピッチ円半径 `m·z/2`。2 枚のねじれ角が同じなので歯直角モジュールも一致する
  - 歯数の範囲・歯幅は平歯車と同じ（要件 §3.2）
- **種類** `'crossedHelical'`。かみ合えるのは同じ大きさのねじ歯車だけ。平行軸ではかみ合わない（同じ向きのねじれは平行軸でかみ合わないため）
- **配置**: S2-03 で作った `'skew'`（ねじれた位置の 90°。`axisStep` と `side` を持ち、`axis` は持たない）をそのまま使う。子の中心 = `親の中心 + (r_親 + r_子)·side·u`（u は 2 本の軸のどちらとも直交する軸）。親 1 枚につき 4 か所
  - このタスクで足すのは、ねじ歯車同士の組み合わせ（`canMesh`、候補で作る子の種類、contact の条件）だけ。配置の解決・4 か所の列挙・拘束の式は S2-03 のものを変えずに使う
  - 子の `offset` は 0 としてシャフトの原点を逆算する（S2-03 と同じ）
- **候補**: ねじ歯車を選ぶと、`'skew'` の 4 か所のうち干渉しないものを候補に出す。子は同じ大きさ・S1-18 の既定の歯数のねじ歯車。同じ軸の候補で `'crossedHelical'` を作れるようにする
- **偶然のかみ合い（contact）**: どちらもねじ歯車、同じ大きさ、軸が直交し、中心を結ぶ線が両方の軸に直交し、長さが `r_a + r_b` と `MESH_DISTANCE_EPS` 以内
- **位相**: 中心を結ぶ線上の接点で、親の歯の中心と子の歯溝の中心が重なるように子の `basePhase` を決める。contact は段階 1 と同じく位相を問わず拘束として扱い、干渉にはしない
- **拘束**: S2-03 で作ったねじれた位置の共通式（係数の関数をそのまま使う）
  ```
  z_b·ω_b + s·z_a·ω_a = 0,  s = (e_a × u_ab)·e_b
  ```
  （右ねじれ 45° 同士の、接点での歯すじの法線方向の周速の一致から導いた式。ウォームと同じ形になる）
  - セルフロックはしない。どちらの側からでも駆動できる
- **形状**: S2-01 のねじり押し出しを、ねじれ角 45°・右で使う。歯幅 b でのねじれ角度は `b / r`
- **干渉判定**: 歯先円の円柱で近似する。かみ合っている組は除く
- **表示**: 段階 1 と同じ材質
- **保存**: シーンの検証で `'crossedHelical'` を受け付ける。`version` は 1 のまま
- **S2-01 の時点**: 歯車の種類を足すと、`switch (gear.kind)` の `assertNever` でコンパイルエラーになる所（`src/core/scene/gear-shape.ts` の `gearShape`・`newGearShape`・`meshPartnerShape`・`GEAR_KINDS`、`geometry/can-mesh.ts` の `canMesh`・`meshKindOf`、`geometry/shape-key.ts` の `gearShapeKey`、`scene/parse.ts`、`render/gear-geometry.ts` の `buildGeometry`）を直す（design.md §4）。`MeshKind` は `geometry/can-mesh.ts` にある。候補（`GrowCandidate`）は作る歯車の形 `shape: GearShape` を持ち、同じ軸の種類は `GrowSpec.coaxialKind`（app は今 `'spur'` を渡す。`src/app/interactions.ts`）、編集コマンドの種類は `addRootShaft` の `gear.kind?`・`growGear`（coaxial）の `kind?` で渡す。外周に生やす子の形は `meshPartnerShape` で決まる
- **S2-01 のねじり押し出し**: 角度は `src/core/geometry/helical.ts` の `helicalTwistAt(size, teeth, hand, z)`（`HELIX_ANGLE` を使う）・`helicalSliceCount`、形状データは `src/render/gear-geometry.ts` の `buildHelicalGeometry(size, teeth, hand)`。ねじれ角を引数で受け取る形に広げる

## 範囲外
- 90° 以外の軸の角度（範囲外（拡張候補））
- ねじれ角・向きを選べるようにすること（範囲外）
- 音色（すべりの成分）、テーマの材質、パレット・プロパティの UI（S2-05）
- 保存形式の version 2（S2-05）

## 作るもの
- `src/core/scene/`: `CrossedHelicalGear` を `Gear` に足す
  ```ts
  interface CrossedHelicalGear extends GearBase { readonly kind: 'crossedHelical' }
  ```
- `src/core/geometry/`: ねじり押し出しをねじれ角を引数で受け取る形にして共用する（S2-01 の関数を広げる）。`canMesh` に組み合わせを足す
- `src/core/layout/`: S2-03 の `'skew'` の候補・contact に、ねじ歯車の組み合わせを足す。`src/core/kinematics/`: S2-03 の係数の関数で `'crossedHelical'` の組も扱う（式は同じ）
- `e2e/fixtures/crossed-pair.json`: 横 X の起点のシャフト（原点 `[0, 80, 0]`）に中・20 歯のねじ歯車 A（`offset` 0 → 中心 `[4, 80, 0]`）とモーター 中（60 rpm、正の向き、ON）。A から `'skew'` の子 B（中・40 歯、`offset` 0、`axisStep: 2` → シャフトの軸 `'z'`、`side: 1` → 中心 `[4, 140, 0]`）
- **design.md の書き換え**
  - §3: `CROSSED_HELIX_ANGLE` を足す
  - §4: `CrossedHelicalGear` を足す。S2-03 で書いた `'skew'` の説明に、ねじ歯車にも使うことを追記する
  - §5: contact の条件にねじ歯車の場合を足す。`MeshKind` に `'crossedHelical'`
  - §6: 拘束の係数の表で、ねじれた位置の式がねじ歯車にも使われることを書く

## 受け入れ条件
- [ ] ねじ歯車を選ぶと 90° ねじれた位置の候補が出て、クリックで正しい位置に置かれる
- [ ] 歯数比どおりに回り、どちらの側にモーターを付けても回る（ロックしない）
- [ ] 平行な位置にはねじ歯車の候補が出ない

## テストケース
### Vitest
- [ ] `canMesh`: ねじ歯車同士（同じ大きさ）→ 真。ねじ歯車とハスバ歯車・平歯車 → 偽
- [ ] `resolveLayout(crossed-pair)`: B のシャフトの軸 `'z'`、B の中心 `[4, 140, 0]`。`meshes` に `kind: 'crossedHelical'`。`interferences` が空
- [ ] 運動: `crossed-pair`（A 2π rad/s）→ B は −π rad/s（s = (x × y)·z = 1）
- [ ] 運動: `side: -1`（B の中心 `[4, 20, 0]`）→ B は +π rad/s
- [ ] 運動: `axisStep: 1` にする（B のシャフトの軸 `'y'`、u は z、`side: 1` → 中心 `[4, 80, 60]`）→ s = (x × z)·y = −1 → B は +π rad/s
- [ ] 逆側の駆動: モーターを B のシャフトに移す（30 rpm = π rad/s）→ A は −2π rad/s。ロックしない
- [ ] 形状: 中・20 歯で、両端の断面の歯の角度の差が `8 / 20` = 0.4 rad
- [ ] 候補: A から列挙した外周の候補（新しいシャフトを作るもの）がすべて `'skew'` で、シャフトの軸が `'y'` か `'z'`。平行な軸（`'x'`）の候補はない
### Playwright
- [ ] `crossed-pair.json` → B のシャフトの ω が `-Math.PI`（`toBeCloseTo`）、`locks` が空
- [ ] A を選び、候補を 1 つクリック → 新しいシャフトが `placement.kind === 'skew'`、`interferences` が空
### Playwright（見た目）
- [ ] `crossed-pair.json` のかみ合い部分の拡大を `screenshots/crossed-helical-closeup.png` に保存する

## 人が手で確かめる項目
- 2 枚の歯すじが接点で平行にそろって見え、回転の向きが自然に見える

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（§3、§4、§5、§6）
- [ ] `status: done` にしてコミットした
