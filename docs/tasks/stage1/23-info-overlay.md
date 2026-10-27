---
id: S1-23
title: 情報表示
status: doing
depends: [S1-07, S1-15]
---

# S1-23 情報表示

## 目的
歯車ごとの rpm・ギア比・回転方向を画面に重ねて表示し、減速や増速の様子を数字と矢印で読めるようにする（要件 §7.3）。

## 範囲
- 表示する値: rpm、ギア比、回転方向の矢印。
- 表示の ON/OFF。標準は OFF。
  - OFF: 選択中の歯車だけ表示する（選択が歯車でなければ何も出さない）。
  - ON: すべての歯車に表示する。
- ツールバーの「情報表示」ボタン（S1-15 が置き場を用意済み）で切り替える。押した状態を `aria-pressed` で示す。
- 状態は `AppState.view.infoOverlay: boolean`（初期値 `false`）に持つ。保存しない（設定の保存対象は要件 §10 の 5 項目だけ）。
- 表示値の計算は純粋関数にし、Vitest で確かめる。

### 値の定義
- **rpm**: その歯車のシャフトの角速度 ω（`MotionState.omegas`）から `|ω| × 60 / 2π`。小数 1 桁で表示する（`20.0 rpm`）。1000 以上は整数で表示する。`|ω| < LOCK_OMEGA_EPS` は `0.0 rpm`。
- **回転方向**: ω の符号。軸の正の向きから見て、正なら反時計回り、負なら時計回り（design.md §2）。`|ω| < LOCK_OMEGA_EPS` なら矢印を出さない。
- **ギア比**: 「基準のモーターのシャフトが何回転すると、この歯車が 1 回転するか」。`基準の速度 ÷ この歯車の速度` の絶対値を `3.00 : 1` の形（小数 2 桁）で出す。1 より大きければ減速、小さければ増速。
  - 基準のモーター: その歯車と同じ連結成分（かみ合いとシャフトでつながった範囲）にあるモーターのうち、ID の文字列順で最初のもの。ON/OFF は問わない。
  - 比は運動の解ではなく、S1-05 の速度比（歯数から決まる比）から求める。モーターが止まっていても、一時停止中でも同じ値を出す。
  - 次の場合は `—` を出す: 連結成分にモーターがない、連結成分の回転条件が矛盾している（自由度 0）、自由度が 2 以上（段階 3 で起こる）。
  - モーターのシャフトに載っている歯車は `1.00 : 1`。

### 表示の形
- ラベル: 歯車の中心を画面に投影した位置の少し上に、DOM の要素で 2 行（`20.0 rpm` / `ギア比 3.00 : 1`）を出す。文字列は `t()` を通す。カメラの後ろや画面外の歯車のラベルは隠す。前後の隠れ（遮蔽）は考えない。
- ラベルの文字は 10 Hz で更新する（毎フレーム書き換えると読みにくい）。位置は毎フレーム更新する。
- 矢印: 歯車の軸の正の側の面の少し外（歯先円の 1.15 倍の半径）に、90° の円弧の矢印を 3D で描く。回転方向に向ける。矢印自体は回さない。
- ロック中の歯車は `0.0 rpm`、矢印なし。ギア比は上の規則のとおり。

## 範囲外
- コンテキストメニューからの ON/OFF（S1-29）
- 見た目の確認の場面一覧の整理（S1-31。ここでは情報表示 ON の 1 枚を撮る）
- キーボードの割り当て（要件にないので作らない）

## 作るもの
- `src/core/kinematics/info.ts`
  ```ts
  export interface GearInfo {
    gearId: GearId;
    rpm: number;                  // 絶対値。|ω| < LOCK_OMEGA_EPS なら 0
    direction: 1 | -1 | 0;        // ω の符号。止まっていれば 0
    ratio: number | null;         // 基準の速度 ÷ この歯車の速度 の絶対値。決まらなければ null
    referenceMotorId: MotorId | null;
  }
  export function computeGearInfo(scene: Scene, layout: Layout, motion: MotionState): Record<GearId, GearInfo>;
  export function formatRpm(rpm: number): string;           // "20.0 rpm"
  export function formatRatio(ratio: number | null): string; // "3.00 : 1" / "—"
  ```
  - 速度比は S1-05 の関数を使う（引数の形は S1-05 の実装に合わせてよい）。
- `src/render/` に矢印の描画、`src/ui/` にラベルの重ね表示。ラベルの要素には `data-testid="info-label"` と `data-gear-id` を付ける。
- 表示する歯車の決め方を純粋関数にする: `visibleInfoGearIds(scene, selection, infoOverlay): GearId[]`
- 辞書のキー（日・英）: `ギア比`／`Ratio`。ツールバーのボタン名（`toolbar.info`・`toolbar.info.tooltip`）は S1-15 で足し済み。ボタンは `UiShell.toolbar.button('info')` で受け取り、動作を付けて `disabled = false` にする。
- `__gearSim` に追加
  ```ts
  getInfoOverlay(): { enabled: boolean; arrows: Array<{ gearId: GearId; direction: 1 | -1 }> };
  ```
- 見た目の確認用のフィクスチャ `e2e/fixtures/scene-a.json`（下のテストのシーン A。S1-25 が先に作っていればそれを使う）

## 受け入れ条件
- [ ] 起動直後は情報表示が OFF で、歯車を選ぶとその歯車だけにラベルと矢印が出る。
- [ ] ツールバーのボタンで ON にすると全歯車に出る。もう一度押すと OFF に戻る。
- [ ] 数値は rpm 小数 1 桁、ギア比小数 2 桁で、モーターを止めてもギア比は変わらない。
- [ ] 日本語と英語でラベルの文字が切り替わる。

## テストケース
共通のシーン A: シャフト s1（モーター 小、60 rpm、向き +1、ON）に歯車 g1（小、12 枚）。g1 の外周に g2（小、36 枚、シャフト s2）。g2 の外周に g3（小、24 枚、シャフト s3）。

### Vitest
- [ ] シーン A: g1 → rpm 60.0、direction 1、ratio 1.00。g2 → rpm 20.0、direction -1、ratio 3.00。g3 → rpm 30.0、direction 1、ratio 2.00（g1 と g3 の歯数比 24/12）。
- [ ] シーン A でモーターを OFF: 全歯車 rpm 0、direction 0、ratio は上と同じ（1.00 / 3.00 / 2.00）。
- [ ] モーターのない連結成分の歯車: ratio null、referenceMotorId null。
- [ ] 三角形にかみ合って矛盾した連結成分: ratio null、rpm 0。
- [ ] 連結成分にモーターが 2 つ（`motor_b` と `motor_a`）: referenceMotorId は `motor_a`。
- [ ] `formatRpm`: 20 → `20.0 rpm`、0.04 → `0.0 rpm`、1234.5 → `1235 rpm`。`formatRatio`: 3 → `3.00 : 1`、1/3 → `0.33 : 1`、null → `—`。
- [ ] `visibleInfoGearIds`: OFF で選択なし → `[]`。OFF で g2 を選択 → `[g2]`。OFF でシャフトを選択 → `[]`。ON → 全歯車。

### Playwright
- [ ] シーン A を `loadScene` → ラベル 0 個。g2 をクリック（`projectToScreen`）→ ラベル 1 個（`data-gear-id` が g2）で、`20.0 rpm` と `3.00 : 1` を含む。`getInfoOverlay().arrows` が `[{ gearId: g2, direction: -1 }]`。
- [ ] ツールバーの情報表示ボタン → `getInfoOverlay().enabled === true`、ラベル 3 個、矢印 3 個。もう一度押す → enabled false、ラベルは選択中の g2 の 1 個。
- [ ] 言語を英語にすると、ラベルが `Ratio` を含む。
- [ ] 見た目: シーン A、情報表示 ON で `screenshots/info-overlay-on.png` を撮る（真っ黒・真っ白でないこと、コンソールエラー 0 件）。

## 人が手で確かめる項目
- ラベルが歯車に重なって読めなくならないか、矢印の向きが実際の回転と合って見えるか。
- 200 個の歯車で ON にしても、目に見えて重くならないか。

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`view.infoOverlay`、`__gearSim.getInfoOverlay` を design.md §7・§10 に書く）
- [ ] `status: done` にしてコミットした
