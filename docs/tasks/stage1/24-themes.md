---
id: S1-24
title: テーマと質感
status: todo
depends: [S1-04]
---

# S1-24 テーマと質感

## 目的
真鍮と木製の 2 つのテーマで、PBR・環境マップ・影による本物らしい見た目を作る（要件 §8）。重い PC でも動くよう、高品質／軽量を切り替えられるようにする。テーマに対応する音の材質の値も用意し、音（S1-25）と結び付けられるようにする。

## 範囲
- テーマ `brass`（真鍮、標準）と `wood`（木製）。歯車、シャフト、モーター、床、背景、照明の見た目をテーマごとに決める。
- 質感: `MeshStandardMaterial`（PBR）、環境マップ（`RoomEnvironment` を `PMREMGenerator` で変換。画像ファイルは使わない）、平行光源の影。
- 品質 `high`（高品質、標準）と `low`（軽量）。実行中に切り替えられる（再読み込みなし）。
- ツールバーの「テーマ」ボタン（S1-15 が置き場を用意済み）で真鍮 ⇄ 木製を切り替える。
- 状態は `AppState.settings.theme: ThemeId` と `AppState.settings.quality: Quality` に持つ。localStorage への保存は S1-30。
- テーマに対応する音の材質 `THEME_AUDIO_MATERIAL` を `core` に置く（音の側の使い方は S1-25、結び付けは S1-30）。

### テーマの値（目安。見た目を見て調整してよいが、性格は変えない）
| 部品 | 真鍮 | 木製 |
|---|---|---|
| 歯車 | 色 `#c9a24a`、metalness 1.0、roughness 0.32 | 色 `#b07a45`、metalness 0、roughness 0.75、木目のテクスチャ |
| シャフト | 鋼（色 `#9aa0a6`、metalness 1.0、roughness 0.25） | 濃い木（色 `#6b4426`、metalness 0、roughness 0.8） |
| モーター | 黒い塗装（`#2b2b2e`、metalness 0.3、roughness 0.5） | 濃い緑の塗装（`#3d4a3a`、metalness 0、roughness 0.7） |
| 床・グリッド | 暗いグレー `#2a2c30`、線 `#3a3d42` | 明るい生成り `#e8dcc6`、線 `#cdbd9f` |
| 背景 | `#1d1f23` | `#f3ece0` |
| 環境マップの強さ | 1.0 | 0.4 |

- 木目は実行時に Canvas で描いたテクスチャ（`CanvasTexture`）で作る。画像ファイルは置かない。
- 歯車の形状データ（BufferGeometry）はテーマで変えない。切り替えではマテリアルだけ差し替える（design.md §7）。

### 品質ごとの違い
| 項目 | `high` | `low` |
|---|---|---|
| 影 | ON（`PCFSoftShadowMap`、影マップ 2048×2048、歯車とシャフトが影を落とし、床と歯車が受ける） | OFF（`renderer.shadowMap.enabled = false`、影の計算を一切しない） |
| 描画の解像度 | `devicePixelRatio`（上限 2） | 1 |
| 環境マップ | PMREM 256 | PMREM 64（反射は残す。消すと真鍮が真鍮に見えないため） |
| 木目のテクスチャ | 1024×1024、mipmap と異方性フィルタ 4 | 256×256、異方性フィルタなし |
| トーンマッピング | ACESFilmic | ACESFilmic（変えない） |

- アンチエイリアスは `WebGLRenderer` の作成時にしか変えられないので、両方とも ON のまま。

## 範囲外
- 設定画面での品質・テーマの選択、localStorage への保存（S1-30）
- 音の材質ごとの合成のパラメータと再生（S1-25）。テーマを音に反映する結び付け（S1-30）
- ロックの赤い表示（S1-22）、情報表示（S1-23）の色。ただし両テーマで見えることは確かめる
- 段階 2・3 の歯車の質感（S2-05、S3-05）

## 作るもの
- `src/core/theme.ts`
  ```ts
  export type ThemeId = 'brass' | 'wood';
  export type Quality = 'high' | 'low';
  export type AudioMaterialId = 'metal' | 'wood'; // 音の材質。S1-25 はここから import する（二重に定義しない）
  export const THEME_IDS: readonly ThemeId[];         // ['brass', 'wood']
  export const DEFAULT_THEME: ThemeId;                 // 'brass'
  export const DEFAULT_QUALITY: Quality;               // 'high'
  export const THEME_AUDIO_MATERIAL: Readonly<Record<ThemeId, AudioMaterialId>>; // brass → metal, wood → wood
  export interface QualityProfile {
    shadows: boolean;
    shadowMapSize: number;
    pixelRatioCap: number;
    envMapSize: number;
    woodTextureSize: number;
    anisotropy: number;
  }
  export const QUALITY_PROFILES: Readonly<Record<Quality, QualityProfile>>;
  export function nextTheme(theme: ThemeId): ThemeId; // ツールバーのボタンで使う
  ```
- `src/render/themes.ts`: テーマごとのマテリアルの値と、テーマ・品質の適用（マテリアルの差し替え、影・解像度・環境マップの切り替え）
- 辞書のキー（日・英）: テーマ名、品質名。ツールバーのボタン名（`toolbar.theme`・`toolbar.theme.tooltip`）は S1-15 で足し済み。ボタンは `UiShell.toolbar.button('theme')` で受け取り、動作を付けて `disabled = false` にする。UI の配色は `src/ui/shell.css` の `:root` の CSS 変数（`--gs-*`）にまとめてある（トーストは `src/ui/toast.css`）
- `__gearSim` に追加
  ```ts
  getRenderInfo(): { theme: ThemeId; quality: Quality; shadowMapEnabled: boolean; pixelRatio: number; textures: number };
  ```
  - 設定を UI を通さずに変えるのは S1-14 の `updateSettings(patch)`、決まった位置から撮るのは S1-13 の `setCamera({ position, target })` を使う。
- 見た目の確認用のフィクスチャ `e2e/fixtures/showcase.json`（中・大の歯車 6 枚程度、モーター 1 つで回る小さな機構）

## 受け入れ条件
- [ ] 起動直後は真鍮・高品質で、歯車に環境の映り込みと床への影がある。
- [ ] ツールバーのボタンで木製に変わり、もう一度押すと真鍮に戻る。再読み込みはしない。
- [ ] 品質を軽量にすると影が消え、描画の解像度が 1 になる。高品質に戻すと影が戻る。
- [ ] テーマや品質を何度切り替えても、マテリアルやテクスチャが増え続けない（古いものを `dispose` する）。

## テストケース
### Vitest
- [ ] `DEFAULT_THEME === 'brass'`、`DEFAULT_QUALITY === 'high'`。
- [ ] `THEME_AUDIO_MATERIAL`: brass → `metal`、wood → `wood`。全テーマにキーがある。
- [ ] `QUALITY_PROFILES.high.shadows === true`、`QUALITY_PROFILES.low.shadows === false`、`low.pixelRatioCap === 1`、`low.envMapSize < high.envMapSize`、`low.woodTextureSize < high.woodTextureSize`。
- [ ] `nextTheme('brass') === 'wood'`、`nextTheme('wood') === 'brass'`。

### Playwright
- [ ] 起動 → `getRenderInfo()` が `{ theme: 'brass', quality: 'high', shadowMapEnabled: true }`。
- [ ] ツールバーのテーマボタン → theme が `wood`。もう一度 → `brass`。
- [ ] `updateSettings({ quality: 'low' })` → `shadowMapEnabled === false`、`pixelRatio === 1`。`'high'` に戻す → `shadowMapEnabled === true`。
- [ ] テーマと品質を交互に 20 回切り替えた後、`renderer.info.memory.textures` の数が最初の 1 回目の切り替え直後と同じ。コンソールエラー 0 件。
- [ ] 見た目: `showcase.json` を読み、次の 4 枚を撮る。いずれも真っ黒・真っ白でないこと。
  - `theme-brass.png`、`theme-wood.png`（全体）
  - `theme-brass-mesh-closeup.png`、`theme-wood-mesh-closeup.png`（かみ合っている箇所に `setCamera` で寄る）

## 人が手で確かめる項目
- 真鍮が金属らしく光り、木製が木らしく見えるか。木目の向きが不自然でないか。
- 影が歯車の歯に正しく落ち、ちらつき（シャドウアクネ）がないか。
- 軽量にしたとき、見た目が大きく崩れずに軽くなるか。
- 両テーマで、選択の強調、候補、ハンドル、ロックの赤が見分けられるか。

## 完了の条件
- [ ] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [ ] design.md と後続のタスク資料に、必要な変更を反映した（`settings.theme` / `settings.quality`、`__gearSim` の追加 API を design.md §7・§10 に書く）
- [ ] `status: done` にしてコミットした
