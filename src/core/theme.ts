// テーマと品質（S1-24、要件 §8）。three に依存しない値だけを置く（見た目の値は render/themes.ts）

export type ThemeId = 'brass' | 'wood';
export type Quality = 'high' | 'low';
// 音の材質。S1-25 はここから import する（二重に定義しない）
export type AudioMaterialId = 'metal' | 'wood';

export const THEME_IDS: readonly ThemeId[] = ['brass', 'wood'];
export const DEFAULT_THEME: ThemeId = 'brass';
export const DEFAULT_QUALITY: Quality = 'high';

// テーマに対応する音の材質（S1-25 の合成、S1-30 で結び付ける）
export const THEME_AUDIO_MATERIAL: Readonly<Record<ThemeId, AudioMaterialId>> = {
  brass: 'metal',
  wood: 'wood',
};

export interface QualityProfile {
  readonly shadows: boolean; // 平行光源の影
  readonly shadowMapSize: number; // 影マップの一辺（shadows が false なら使わない）
  readonly pixelRatioCap: number; // 描画の解像度の上限（devicePixelRatio をこれで頭打ちにする）
  readonly envMapSize: number; // 環境マップ（PMREM）の大きさ
  readonly woodTextureSize: number; // 木目のテクスチャの一辺
  readonly anisotropy: number; // 木目のテクスチャの異方性フィルタ（1 でなし）
}

export const QUALITY_PROFILES: Readonly<Record<Quality, QualityProfile>> = {
  // 高品質の環境マップは資料の表の 256 ではなく 128（作るのに 256 は 128 の約 2.5 倍かかり、GPU の無い
  // 環境では起動が数秒遅れる。粗さ 0.25 以上の部品しか無いので、映り込みの見た目はほとんど変わらない）
  high: {
    shadows: true,
    shadowMapSize: 2048,
    pixelRatioCap: 2,
    envMapSize: 128,
    woodTextureSize: 1024,
    anisotropy: 4,
  },
  low: {
    shadows: false,
    shadowMapSize: 0,
    pixelRatioCap: 1,
    envMapSize: 64,
    woodTextureSize: 256,
    anisotropy: 1,
  },
};

// ツールバーのテーマボタンで次に移るテーマ（THEME_IDS の順に巡る）
export function nextTheme(theme: ThemeId): ThemeId {
  const index = THEME_IDS.indexOf(theme);
  return THEME_IDS[(index + 1) % THEME_IDS.length] ?? DEFAULT_THEME;
}
