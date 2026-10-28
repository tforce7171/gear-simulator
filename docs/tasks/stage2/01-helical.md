---
id: S2-01
title: ハスバ歯車
status: done
depends: [S1-31]
---

# S2-01 ハスバ歯車

## 目的
平行軸で使う 2 つ目の歯車として、歯がねじれたハスバ歯車を入れる。段階 2 で歯車の種類が増える最初のタスクなので、`Gear` を種類ごとの判別共用体にし、かみ合いに種類を持たせる土台もここで作る。完了すると、ハスバ歯車を生やしてかみ合わせ、平歯車と同じ速度比で回せる。

## 範囲
- **決めた値**（`src/core/constants.ts` に置く）
  - ねじれ角 `HELIX_ANGLE = 20°`（固定。ユーザーは変えられない）
  - モジュールは **軸直角モジュール** として扱う。ピッチ円半径は平歯車と同じ `m·z/2`、中心距離も平歯車と同じ。歯直角モジュールは `m·cos 20°` になる
  - 歯幅・歯数の範囲は平歯車と同じ（要件 §3.2）
- **ねじれの向き** `hand: 'left' | 'right'`
  - かみ合うのは **同じねじれ角で、ねじれの向きが逆** の組だけ。平歯車とハスバ歯車はかみ合わない
  - ねじれの向きはユーザーが選ばない。外周に生やした子は親の逆、同じ軸に通した歯車は `'right'`
- **形状**: 軸直角断面のインボリュート歯形（S1-02 と同じ）を、歯幅の方向に押し出しながらねじる。歯幅 b でのねじれ角度は `Δφ = b·tan β / r`（r はピッチ円半径、`'right'` は軸の正の向きに進むほど正の回転）。両端の断面は平歯車と同じ歯形
- **形状データの共有**: キーに `hand` を含める（`(種類, 大きさ, 歯数, hand)`）
- **候補**（S1-10 の拡張）
  - 外周: ハスバ歯車を選んでいるとき、平歯車と同じ外周の候補を出す。子は同じ大きさ・逆の `hand` のハスバ歯車
  - 同じ軸: 作る歯車の種類を引数で受け取れるようにする（パレットで種類を選ぶ UI は S2-05。それまでは `'spur'` を渡す）
- **配置**: `mesh` のシャフトの中心距離・位相の求め方は平歯車と同じ。位相は歯幅の中央の断面で合わせる（逆向きのねじれ同士なので、歯幅全体でかみ合う）
- **偶然のかみ合い（contact）**: §5 の条件に「どちらもハスバ歯車で `hand` が逆」を加える。段階 1 と同じく位相は問わず、拘束として扱う。平歯車とハスバ歯車、同じ向きのハスバ歯車同士がちょうどの距離にあるときはかみ合いにならず、歯先円の円柱が重なるので干渉になる
- **運動学**: 拘束は平歯車と同じ `z_a·ω_a + z_b·ω_b = 0`。軸方向の力（スラスト）は扱わない
- **干渉判定**: 平歯車と同じ円柱で近似する
- **表示**: 段階 1 と同じ材質で描く。シャフト上の位置の吸着、外周の角度のハンドルも平歯車と同じに動く
- **保存**: シーンの検証で `'helical'` と `hand` を受け付ける（S1-28 から、生の値の形は `src/core/scene/parse.ts` の `parseScene`、意味は `validateScene` で確かめる。種類やフィールドを足すときは両方に足す。`parseScene` は型にないフィールドを捨てるので、足したフィールドを `parseScene` で拾わないと読み込みで消える）。保存形式の `version` は 1 のまま（上げるのは S2-05）

## 範囲外
- パレットで歯車の種類を選ぶ UI、プロパティパネルでの種類別の表示（S2-05）
- かみ合いの種類ごとの音色、テーマごとの材質の違い（S2-05）
- 保存形式の version 2 への移行（S2-05）
- 90° に交差するねじ歯車（S2-04）
- ねじれ角を選べるようにすること、やまば歯車（範囲外）

## 作るもの
- `src/core/scene/`: `Gear` を判別共用体にする
  ```ts
  interface GearBase {
    readonly id: GearId;
    readonly shaftId: ShaftId;
    readonly size: SizeKey;
    readonly teeth: number;
    readonly offset: number; // 歯幅の負側の面の位置。AXIAL_SNAP の倍数（design.md §4）
  }
  interface SpurGear extends GearBase { readonly kind: 'spur' }
  interface HelicalGear extends GearBase { readonly kind: 'helical'; readonly hand: 'left' | 'right' }
  type Gear = SpurGear | HelicalGear; // S2-02 以降で種類を足す
  type GearKind = Gear['kind'];
  ```
  - 種類ごとに分岐する箇所は `switch (gear.kind)` で網羅性を型で確かめる（`never` の検査）。後続のタスクで種類を足したとき、直す場所がコンパイルエラーで分かるようにする
- `src/core/geometry/`: ハスバ歯車の形状生成（ねじり押し出し）と、かみ合えるかの判定
  ```ts
  export function canMesh(a: Gear, b: Gear): boolean; // 種類・大きさ・hand の組み合わせだけで判定（位置は見ない）
  ```
- `src/core/layout/`: 候補の列挙に「作る歯車の種類」を受け取る引数を足す。contact の判定に `canMesh` を使う
- `Mesh` に種類を足す
  ```ts
  type MeshKind = 'spur' | 'helical'; // S2-02 以降で足す
  interface Mesh { a: GearId; b: GearId; source: 'tree' | 'contact'; kind: MeshKind }
  ```
- `src/render/`: ハスバ歯車の描画。形状データのキーに `hand` を入れる
- `e2e/fixtures/helical-pair.json`: 縦軸の起点のシャフト（原点 `[0, 35, 0]`）に中・20 歯 `'right'` のハスバ歯車 A（`offset` 0）と中のモーター（60 rpm、正の向き、ON）。A の外周（`angle: 0`）に中・40 歯 `'left'` の B
- **design.md の書き換え**
  - §4: `Gear` を上の判別共用体に書き換え、「段階 2・3 で種類を足す」のコメントを、種類ごとの追加フィールドの一覧に置き換える
  - §5: `Mesh` に `kind: MeshKind` を足す。contact の条件に「`canMesh(a, b)` が真」を加える
  - §7: 形状データのキーを `(種類, 大きさ, 歯数, 形を変える属性)` にする（ハスバ歯車では `hand`）
  - §3: `HELIX_ANGLE` を足す

## 受け入れ条件
- [x] ハスバ歯車を選ぶと外周の候補が出て、クリックすると逆向きのねじれの子がかみ合う位置に置かれる
- [x] ハスバ歯車同士が平歯車と同じ速度比・逆向きに回り、歯幅のどの断面でも歯がめり込んで見えない
- [x] 平歯車とハスバ歯車はかみ合わない（候補が出ない。ちょうどの距離に置かれたら干渉として赤く表示する）
- [x] 平歯車だけのシーンの振る舞いは段階 1 から変わらない

## テストケース
### Vitest
- [x] `canMesh`: `'right'` と `'left'` のハスバ（同じ大きさ）→ 真。`'right'` 同士 → 偽。ハスバと平歯車 → 偽。大きさ違い → 偽
- [x] 形状: 中・20 歯 `'right'` の形状で、軸方向の −b/2 と +b/2 の断面の歯の角度の差が `8·tan20° / 20` ≈ 0.1456 rad（`'left'` では符号が逆）
- [x] 形状データの共有: 中・20 歯 `'right'` を 2 回求めると同じ参照。`'left'` とは別の参照
- [x] 外周の候補: 中・20 歯 `'right'` の A から外周の候補を列挙すると、すべて `kind: 'helical'`、`hand: 'left'`、大きさ M
- [x] 同じ軸の候補で種類 `'helical'` を渡すと `hand: 'right'` の歯車になる
- [x] `resolveLayout(helical-pair)`: B の中心が A の中心から 60（20 + 40）。`meshes` に `{ a: A, b: B, source: 'tree', kind: 'helical' }`。`interferences` が空
- [x] 運動: `helical-pair` で A が 60 rpm（2π rad/s）→ B は −π rad/s
- [x] contact: A と、A から距離 60 に `'left'` のハスバ（木の親子ではない）→ contact のかみ合い。同じ位置に `'right'` のハスバ → かみ合いでなく、`interferences` に入る。平歯車でも同じく干渉
- [x] 三角形: 中・20 歯のハスバ 3 枚を互いにちょうどの距離に置けるかを確かめ、置けないこと（ねじれの向きが 2 種類しかないので、3 枚が互いに逆向きにはなれない）を `canMesh` で確認する
### Playwright
- [x] `helical-pair.json` を読む → `getLayout().meshes[0].kind === 'helical'`、B のシャフトの ω が `-Math.PI`（`toBeCloseTo`）
- [x] A を選び、外周の候補をクリック → 新しい歯車が `kind: 'helical'`、`hand: 'left'`。Ctrl+Z で消える
### Playwright（見た目）
- [x] `helical-pair.json` のかみ合い部分の拡大を `screenshots/helical-closeup.png` に保存する

## 人が手で確かめる項目
- 歯のねじれが自然に見え、かみ合った 2 枚のねじれが逆向き（互いに沿う向き）に見える
- 回っているとき、歯幅の端から端まで歯がめり込んで見えない

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（§3、§4、§5、§7）
- [x] `status: done` にしてコミットした
