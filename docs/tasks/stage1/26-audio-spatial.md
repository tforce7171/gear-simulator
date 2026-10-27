---
id: S1-26
title: 音（空間）
status: doing
depends: [S1-13, S1-25]
---

# S1-26 音（空間）

## 目的
かみ合いの音を 3D 空間に置き、カメラを近づけた箇所の音がよく聞こえるようにする（要件 §9）。同時に鳴らす数を抑えつつ、遠くの多数の歯車は背景のうなりとして残す。ロック、モーターが逆に回されている状態、モーターのうなりに専用の音を付ける。

## 範囲
- かみ合い 1 組ごとの音源を `PannerNode` で 3D に置く。位置はかみ合いの接点（下記）。
- `AudioListener` をカメラに合わせる（位置・前方向・上方向）。毎フレーム更新する。
- カメラに近い最大 `MAX_AUDIO_VOICES`（16）組だけ個別に鳴らし、残りを 1 つの背景のうなりにまとめる。S1-25 の「`Layout.meshes` の順で 16 組」をこれで置き換える。
- 専用音: ロック、逆に回されるモーター（`MotionState.backDriven`）、モーターのうなり。
- 選択・まとめ・専用音のパラメータの計算は `src/core/audio-model/` の純粋関数にし、Vitest で確かめる。

### 3D 配置
- 接点: 歯車 a の中心から b の中心へ向かう線分上で、a の中心からピッチ円半径 `r_a` の点。
- `PannerNode`: `panningModel: 'HRTF'`、`distanceModel: 'inverse'`、`refDistance: 150`（mm）、`rolloffFactor: 1`、`maxDistance: 10000`。音量は 150 mm で 1、600 mm で 0.25 になる。
- 長さの単位は mm のまま `AudioListener` と `PannerNode` に渡す。

### 鳴らす組の選び方
- 候補: 動いている（`f > 0`）かみ合い。
- 距離 = 接点とカメラの位置の距離。近い順に 16 組。距離が同じなら `meshKey` の文字列順。
- ちらつき防止のヒステリシス: 前のフレームで鳴っていた組は、距離を 0.9 倍して比べる（新しい組は 10% 以上近くないと入れ替わらない）。
- 入れ替わる音源は 100 ms でフェードアウト／フェードインする。

### 背景のうなり
- 選ばれなかった組をまとめて 1 つの非空間（パンなし）の音源にする。
- 各組の推定音量 `g_i = S1-25 の連続音の level × 距離の減衰（上の inverse の式）`。クリックの範囲（`f < 15 Hz`）の組も、連続音とみなして含める（遠くの多数のカチカチはざわめきに聞こえるため）。
- 背景の音量 = `min(0.5, sqrt(Σ g_i²))`。周波数 = `g_i` で重み付けした `log2(f_i)` の平均を戻した値（30〜2000 Hz にクランプ）。
- 音色は、その周波数の連続音（材質の倍音）＋ その周波数を中心にした帯域ノイズ（Q = 1、音量は連続音の 0.5 倍）。
- 選ばれなかった組がなければ鳴らさない。

### 専用音
- **ロック**
  - 連結成分が新しくロックした瞬間（`MotionState.locks` に前のフレームになかった組が現れた）に 1 回だけ衝撃音を鳴らす。位置はロックしている歯車の中心の平均。金属: 120 Hz の減衰する低音（150 ms）＋ 材質のクリックを 3 倍の音量で。木: 90 Hz の低音（80 ms）＋ 材質のクリック。
  - ロックが続く間は、震えの表示に合わせて、ノイズを 18 Hz で振幅変調した小さな「ガタガタ」音（音量 0.1）を同じ位置で鳴らす。ロックが解けたら 100 ms で止める。
  - 衝撃音は 1 秒に 4 回まで（編集で何度もロックしても連打にならないように）。
- **モーターのうなり**: ON のモーターごとに、そのシャフトの位置（モーターの描画位置）で鳴らす。
  - 負荷率 `strain = d − ω/ω0`（モーターのトルク ÷ 停動トルク。d は向き、ω0 は無負荷角速度）。無負荷で 0、停動で 1、逆に回されると 1 より大きい。
  - 周波数 = 大きさごとの基準（小 220 Hz、中 140 Hz、大 90 Hz）× `(0.6 + 0.4 × clamp(|ω|/ω0, 0, 1.5))`。
  - 音量 = `0.08 + 0.07 × clamp(strain, 0, 1)`。音色はのこぎり波をローパス（基準の 6 倍）に通したもの。
  - 同時に鳴らすのはカメラに近い 4 個まで（`MAX_MOTOR_VOICES = 4`）。かみ合いの 16 個とは別に数える。
  - 一時停止中（Space、`sim.paused`）とモーター OFF では鳴らさない。
- **逆に回される（backDriven）**: モーターのうなりに、きしみを足す。`grind = clamp(strain − 1, 0, 1)`。帯域ノイズ（中心 = うなりの周波数 × 3、Q = 4）を 7 Hz の不規則な振幅変調で鳴らし、音量 `0.15 × grind`。`backDriven` に入っているモーターだけ。

### S1-25 で決まったこと（前提）
- `computeMeshVoices` は `Layout.meshes` の順に全組（止まっている組も）を返す。`MeshVoice` は `{ key, gearId, shaftId, teeth, frequency, click, tone }`（`gearId` は key の先頭の歯車で、クリックの時刻をそのシャフトの角度と歯数で求める。`frequency` はクランプしない歯の通過頻度）。ここに `position` を足す。
- 鳴らす組の選び方は `activeVoices(voices, max)`（f > 0 を並びの順に最初の max 組）で、`src/audio/engine.ts` の `AudioEngine.update(voices, angles, dt)` の中で呼んでいる。これを `selectVoices` に置き換える（リスナーの位置を `update` に渡すか、選んだ結果を渡す形にする）。
- 音源の出し入れは `engine.ts` が key ごとに `createMeshVoiceSynth`（`src/audio/mesh-voice.ts`）を作り、外れたら 100 ms でフェードアウトして捨てる。かみ合い 1 組の出力はその `GainNode`（`destination` に主音量を渡している）で、`PannerNode` はここに挟む。
- 主音量（`MASTER_GAIN` 0.5、ミュートで 50 ms の直線で 0）の後にリミッター（`DynamicsCompressorNode`）がある。背景のうなり・専用音も主音量につなげばミュートが効く。
- `e2e/fixtures/chain-22.json` は `shaft_c01`（root、原点 (0, 20, 0)、軸 y、モーター 小 60 rpm）から `gear_c01`〜`gear_c22`（小・24 枚）を角度 π/2（+X の向き）で一直線に生やしたもの。中心は x = 0, 24, 48, …, 504。

## 範囲外
- 品質（S1-24）に合わせた `panningModel` の切り替え（`HRTF` 固定でよい。重ければ S1-31 の計測で見直す）
- テーマに合わせた材質の切り替え（S1-30）
- 段階 2 のウォームの逆駆動のロック音など、段階 2・3 の専用音（S2-05、S3-05）

## 作るもの
- `src/core/audio-model/`
  ```ts
  export const MAX_MOTOR_VOICES = 4;
  export const VOICE_HYSTERESIS = 0.9;

  export function meshContactPoint(layout: Layout, mesh: Mesh): Vec3;
  export function distanceGain(distance: number): number; // inverse、refDistance 150、rolloff 1
  export interface VoiceCandidate { key: string; position: Vec3; frequency: number; level: number }
  export function selectVoices(
    candidates: VoiceCandidate[],
    listener: Vec3,
    previous: ReadonlySet<string>,
    max: number,
  ): { selected: VoiceCandidate[]; rest: VoiceCandidate[] };
  export function summarizeBackground(
    rest: VoiceCandidate[],
    listener: Vec3,
  ): { level: number; frequency: number } | null; // rest が空なら null
  export function diffLocks(prev: LockInfo[], next: LockInfo[]): { entered: string[]; exited: string[] }; // ロックのキー（`reason` と `shaftIds` をつないだ文字列）の差分
  export function motorHumParams(
    size: SizeKey, rpm: number, direction: 1 | -1, omega: number,
  ): { frequency: number; level: number; strain: number; grind: number };
  ```
- テスト用のフィクスチャ `e2e/fixtures/lock-opposed.json`（S1-21・S1-22 が先に作っていればそれを使う）と `e2e/fixtures/back-driven.json`（ここで作る）
- `src/audio/`: `PannerNode` 付きの音源、背景のうなり、専用音、リスナーの更新
- `__gearSim.getAudio()` を拡張
  ```ts
  voices: Array<{ key: string; frequency: number; click: number; tone: number; position: Vec3 }>;
  background: { level: number; frequency: number } | null;
  motors: Array<{ motorId: MotorId; frequency: number; strain: number; grind: number }>;
  lockSounds: { impacts: number; rattling: string[] }; // 起動からの衝撃音の回数、ガタガタ中のロックのキー
  ```

## 受け入れ条件
- [ ] 多数の歯車が回るシーンで、カメラを寄せた箇所の音が大きく、左右の位置に応じて聞こえる。
- [ ] 個別の音源は常に 16 個以下で、残りは背景のうなりとして聞こえる。
- [ ] 同じ強さのモーター 2 つを互いに逆に回そうとするようにつないでロックさせると衝撃音が 1 回鳴り、ロック中はガタガタ鳴る。
- [ ] 負けて逆に回されているモーターから、きしむ音が聞こえる。

## テストケース
### Vitest
- [ ] `meshContactPoint`: a（中心 (0,0,0)、r 12）と b（中心 (36,0,0)、r 24）→ (12, 0, 0)。
- [ ] `distanceGain`: 150 → 1、600 → 0.25、50 → 1（Web Audio の `inverse` と同じく、refDistance 未満の距離は refDistance として扱う）。
- [ ] `selectVoices`: x = 0, 10, 20, …, 200 に 21 個の候補、リスナー (0,0,0)、previous 空、max 16 → selected は x = 0〜150 の 16 個、rest は 5 個。
- [ ] ヒステリシス: 候補 A（距離 100、previous に含む）と B（距離 95、含まない）、max 1 → A が残る（95 > 100 × 0.9）。B が距離 85 → B に入れ替わる。
- [ ] 同じ距離の候補は key の文字列順で選ばれる。
- [ ] `summarizeBackground`: 空 → null。同じ周波数 100 Hz・同じ level・同じ距離の 4 個 → frequency 100、level は 1 個のときの 2 倍（0.5 でクランプ）。100 Hz と 400 Hz を同じ重み → frequency 200（対数の平均）。
- [ ] `diffLocks`: prev 空 → next に 1 件 → entered 1 件、exited 0。同じ内容（配列は別の参照）→ どちらも空。
- [ ] `motorHumParams`（小、60 rpm、向き +1）: ω = 2π → strain 0、frequency 220、grind 0。ω = 0 → strain 1、frequency 132。ω = −π → strain 1.5、grind 0.5、frequency 220 × (0.6 + 0.4 × 0.5) = 176。

### Playwright
- [ ] `chain-22.json`（S1-25、x 方向に一直線）を読み、クリックで音を開始 → `voices.length === 16`、`background` が null でない。
- [ ] `setCamera` で列の左端に寄せる → 選ばれた 16 組の `position` の x がすべて、選ばれなかった組の x より小さい。右端に寄せる → 逆になる。
- [ ] 小のモーター 2 つ（ともに 60 rpm、向き +1）を、同じ歯数の歯車 2 枚のシャフトにそれぞれ付けてかみ合わせたシーン（`e2e/fixtures/lock-opposed.json`。かみ合うと回る向きが逆になるので、互いに逆に回そうとしてつり合う）→ `lockSounds.impacts === 1`、`rattling.length === 1`。モーターを 1 つ OFF にする → `rattling` が空。
- [ ] 小のモーター（60 rpm、+1）と大のモーター（15 rpm、+1）を、同じ歯数の歯車 2 枚のシャフトに付けてかみ合わせたシーン（`e2e/fixtures/back-driven.json`）→ 大が勝ち、小のモーターは `backDriven` に入る。小の `strain` ≈ 1.22、`grind` ≈ 0.22、大の `grind === 0`。
- [ ] Space で一時停止 → `motors` が空、`voices` が空。
- [ ] 上のすべてでコンソールエラー 0 件。

## 人が手で確かめる項目
- ヘッドホンで、カメラを回すと音が左右に動き、寄ると大きくなるか。
- カメラを動かしたとき、音源の入れ替わりでプツプツ鳴らないか。
- 背景のうなりが、個別の音と比べて不自然に大きく・小さくないか。
- ロックの衝撃音、ガタガタ、きしみ、モーターのうなりが、それぞれ何の音か分かるか。真鍮と木製で性格が違って聞こえるか。

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`__gearSim.getAudio` の拡張を design.md §10 に書く）
- [ ] `status: done` にしてコミットした
