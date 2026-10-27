---
id: S1-25
title: 音（基本）
status: todo
depends: [S1-07, S1-24]
---

# S1-25 音（基本）

## 目的
かみ合った歯車の機械音を Web Audio で合成して鳴らす（要件 §9）。歯の通過頻度で、遅いときのカチカチから速いときのうなりへ連続的に変わる。材質（金属・木）で音色が変わる。空間配置と専用音は S1-26 で足す。

## 範囲
- 録音素材を使わず、`OscillatorNode`・ノイズ（`AudioBuffer` に実行時に作る）・`BiquadFilterNode`・`GainNode` で合成する。
- 音源の単位は **かみ合い 1 組**（`Layout.meshes` の 1 要素）。キーは 2 つの GearId を文字列順に並べて `|` でつないだもの。
- 音の計算は `src/core/audio-model/` の純粋関数にし、Vitest で確かめる。`src/audio/` は計算結果を Web Audio のノードに流すだけにする。
- ミュート: `M` キーとツールバーの「ミュート」ボタン（S1-15 が置き場を用意済み）。状態は `AppState.settings.muted: boolean`（初期値 `false`）。localStorage への保存は S1-30。
- `AudioContext` は、最初のユーザー操作（`pointerdown` または `keydown`）で作って `resume()` する。それまでは作らない。ミュート中でも作る（主音量 0 で動かす）。

### 歯の通過頻度と鳴り方
- 歯の通過頻度 `f = z × |ω| / 2π`（Hz）。かみ合う 2 枚で `z_a·|ω_a| = z_b·|ω_b|` なので、どちらで計算しても同じ。
- 切り替わりの境目
  - `f < 15 Hz`: **クリック**だけ。歯が 1 枚通過するたびに 1 回鳴らす。
  - `15 ≤ f < 30 Hz`: クリックと連続音を等パワーでクロスフェードする。`w = (f − 15) / 15`、クリックの音量 `cos(w·π/2)`、連続音の音量 `sin(w·π/2)`。
  - `f ≥ 30 Hz`: **連続音（うなり）**だけ。基本周波数 = `f`。
  - 例: 小・12 枚・60 rpm は 12 Hz でクリック。36 枚・60 rpm は 36 Hz でうなり。
- 連続音の基本周波数は 30〜2000 Hz にクランプする（f は 2000 を超えうるが、それ以上は耳障りなだけ）。
- 連続音の音量は `f` とともに少し上げる: `toneLevel = 0.6 + 0.4 × min(1, log2(f / 30) / log2(400 / 30))`（30 Hz で 0.6、400 Hz 以上で 1.0）。
- クリックの時刻は、角度の変化から求める: 前のフレームから今のフレームの間に、歯の境目（シャフトの角度 × z / 2π の整数を跨いだ点）を何回跨いだかを数え、跨いだ時刻をフレーム内で線形補間して `AudioContext` の時刻に予約する（遅延 30 ms を足す）。手で回したときもこれで鳴る。1 フレームで跨いだ回数が多い（`f ≥ 30 Hz` 相当）ときはクリックを予約しない。
- クリックの高さは毎回 ±3% ずらす（同じ音の連続が機械的に聞こえないように）。乱数は関数の引数で注入する。

### 材質のパラメータ（目安。聞いて調整してよいが、性格は変えない）
| | `metal`（真鍮） | `wood`（木製） |
|---|---|---|
| クリック: 共鳴の部分音 | 2400 / 3900 / 6100 Hz、減衰 80 / 60 / 40 ms | 420 / 950 Hz、減衰 25 / 15 ms |
| クリック: ノイズ | ハイパス 3000 Hz、減衰 8 ms | ローパス 1200 Hz、減衰 12 ms |
| 連続音: 倍音の振幅（1, 2, 3, … 倍） | 1, 0.6, 0.45, 0.3, 0.2, 0.12 | 1, 0.3, 0.1 |
| 連続音: ローパス | 4000 Hz | 900 Hz |
| 連続音: 加えるノイズ（ざらつき） | 0.05 | 0.15 |
| 音量 | クリック 0.5、連続音 0.25 | クリック 0.6、連続音 0.2 |

- 材質の切り替えは `setMaterial(id)` で受ける。テーマとの結び付け（`THEME_AUDIO_MATERIAL`、S1-24）は S1-30 で行う。このタスクでは初期値 `metal` で鳴らす。

### このタスクでの音源の数
- 動いているかみ合い（`f > 0`）のうち、`Layout.meshes` の順で最初の `MAX_AUDIO_VOICES`（16）組だけ鳴らす。カメラに近い順の選択と、残りのまとめは S1-26 で置き換える。
- 主音量は 0.5。ミュートの ON/OFF は主音量を 50 ms で滑らかに変える（プツッと鳴らさない）。
- ロック中・一時停止中は ω = 0 なので鳴らない。

## 範囲外
- 3D 配置、カメラに近い 16 組の選択、背景のうなり、ロック・逆に回される・モーターのうなりの専用音（S1-26）
- テーマに合わせた材質の切り替え、ミュートの localStorage 保存（S1-30）
- 段階 2・3 の歯車の音（S2-05、S3-05）

## 作るもの
- `src/core/audio-model/`
  ```ts
  import type { AudioMaterialId } from '../theme'; // S1-24 で定義したもの
  export const CLICK_MAX_HZ = 15;
  export const TONE_MIN_HZ = 30;
  export const TONE_MAX_HZ = 2000;

  export function meshKey(a: GearId, b: GearId): string;
  export function toothPassFrequency(teeth: number, omega: number): number; // Hz
  export function clickToneMix(f: number): { click: number; tone: number }; // それぞれ 0〜1
  export function toneParams(f: number, material: AudioMaterialId): {
    frequency: number; // クランプ済み
    level: number;     // toneLevel × 材質の音量 × clickToneMix(f).tone
  };
  // 前後のフレームの角度から、歯の通過の時刻（dt の中での秒）を返す
  export function toothPassTimes(prevAngle: number, nextAngle: number, teeth: number, dt: number): number[];
  export function clickParams(material: AudioMaterialId, random: () => number): ClickParams; // ±3% の揺らぎ込み
  export const MATERIALS: Readonly<Record<AudioMaterialId, AudioMaterialParams>>;
  // かみ合いごとの音源の状態（S1-26 で位置を足す）
  export function computeMeshVoices(scene: Scene, layout: Layout, motion: MotionState): MeshVoice[];
  ```
- `src/audio/`: `AudioContext` の開始、主音量とミュート、かみ合い 1 組分の合成（クリックの予約と連続音）、毎フレームの更新
- テスト用のフィクスチャ `e2e/fixtures/scene-a.json`（S1-23 のシーン A。S1-23 が先に作っていればそれを使う）と `e2e/fixtures/chain-22.json`（小・24 枚の歯車 22 枚を一直線にかみ合わせ、先頭にモーター 小 60 rpm）
- `M` キーとツールバーのミュートボタン。ボタンは `UiShell.toolbar.button('mute')` で受け取り、動作を付けて `disabled = false` にする。ボタンは `aria-pressed` でミュート中を示す。
- 辞書のキー（日・英）: ツールバーのボタン名（`toolbar.mute`・`toolbar.mute.tooltip`）は S1-15 で足し済み。
- `__gearSim` に追加
  ```ts
  getAudio(): {
    contextState: 'none' | AudioContextState; // 作る前は 'none'
    muted: boolean;
    material: AudioMaterialId;
    voices: Array<{ key: string; frequency: number; click: number; tone: number }>;
  };
  ```

## 受け入れ条件
- [ ] ページを開いただけでは `AudioContext` を作らない。最初のクリックかキー入力で音が出始める。
- [ ] モーターで回すと、遅い組はカチカチ、速い組はうなりに聞こえる。速度を上げ下げすると途切れずに移り変わる。
- [ ] `M` キーとツールバーのボタンでミュートが切り替わる。
- [ ] 音の処理でコンソールエラーが出ない。

## テストケース
### Vitest
- [ ] `toothPassFrequency(12, 2π)` = 12（60 rpm × 12 枚）。`toothPassFrequency(36, -2π)` = 36（向きは関係しない）。
- [ ] `clickToneMix`: f = 0 → `{ click: 1, tone: 0 }`、10 → `{1, 0}`、15 → `{1, 0}`、22.5 → 両方 ≈ 0.7071、30 → `{0, 1}`、200 → `{0, 1}`。全域で `click² + tone² ≈ 1`。
- [ ] `toneParams`: f = 5000 → frequency 2000。f = 30 → level = 0.6 × 材質の連続音の音量。f = 400 と 800 → level が同じ。
- [ ] `toothPassTimes(0, 2π × 3.5 / 12, 12, 0.1)` → 3 個、昇順、すべて 0 以上 0.1 以下。1 個目 ≈ `0.1 × (1/3.5)`。
- [ ] `toothPassTimes` は逆回転（next < prev）でも同じ個数を返す。跨がない（0 → 0.1 rad、12 枚）→ `[]`。
- [ ] `clickParams` に `() => 0.5` を渡すと揺らぎ 0（部分音が表の値ちょうど）。`() => 0` / `() => 1` で −3% / +3%。
- [ ] `MATERIALS` の全周波数が 20〜20000 Hz、全減衰時間が正。
- [ ] `computeMeshVoices`: S1-23 のシーン A（12 枚 60 rpm → 36 枚 → 24 枚）で 2 組、f はともに 12 Hz（`g1|g2` は 12×1 回転/秒、`g2|g3` は 36 × 1/3 回転/秒）。モーター OFF で f はともに 0。
- [ ] `meshKey('gear_b', 'gear_a') === 'gear_a|gear_b'`。

### Playwright
- [ ] 起動直後 `getAudio().contextState === 'none'`。キャンバスをクリック → `'running'` になる（`expect.poll`）。
- [ ] シーン A のモーターを 120 rpm にしたシーンを読み込み、クリック → `voices` が 2 件。`g1|g2` の frequency 24、click ≈ 0.588、tone ≈ 0.809（24 Hz はクロスフェードの範囲）。
- [ ] `M` → `muted === true`、ツールバーのボタンが `aria-pressed="true"`。もう一度 `M` → false。
- [ ] 21 組のかみ合いが回るシーン（`e2e/fixtures/chain-22.json`、歯車 22 枚の列）→ `voices.length === 16`。
- [ ] 上のすべてでコンソールエラー 0 件。

## 人が手で確かめる項目
- 真鍮で金属らしいカチカチとうなり、`setMaterial('wood')` で木のコトコトに聞こえるか。
- 15〜30 Hz の境目で音量が凹んだり膨らんだりしないか。
- 回転数を変えたとき、ミュートを切り替えたときに、プツッという雑音が出ないか。

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`settings.muted`、`__gearSim.getAudio` を design.md §7・§10 に書く）
- [ ] `status: done` にしてコミットした
