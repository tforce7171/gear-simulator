// 日本語の辞書（design.md §8）。このキーを正とし、en.ts は同じキーをちょうど持つ。
// キーは「領域.名前」のドット区切りの平らな文字列にする。差し込みは {name} の形で書く
export const ja = {
  'app.title': '歯車シミュレーター',
  // ツールバー（S1-15）。`toolbar.<id>` がボタンの文字と aria-label、`.tooltip` が title
  'toolbar.label': 'ツールバー',
  'toolbar.works': '作品一覧',
  'toolbar.works.tooltip': '保存した作品の一覧を開く',
  'toolbar.save': '保存',
  'toolbar.save.tooltip': '作品として保存する',
  'toolbar.export': 'エクスポート',
  'toolbar.export.tooltip': 'JSON ファイルに書き出す',
  'toolbar.import': 'インポート',
  'toolbar.import.tooltip': 'JSON ファイルを読み込む',
  'toolbar.theme': 'テーマ',
  'toolbar.theme.tooltip': '真鍮と木製を切り替える',
  'toolbar.info': '情報表示',
  'toolbar.info.tooltip': '回転数・ギア比・回転方向の表示を切り替える',
  'toolbar.mute': 'ミュート',
  'toolbar.mute.tooltip': '音を消す・戻す（M）',
  'toolbar.settings': '設定',
  'toolbar.settings.tooltip': '設定を開く',
  // パネル（S1-15）
  'palette.title': '部品',
  'properties.title': 'プロパティ',
  'properties.empty': '部品を選ぶと、ここに設定が出ます',
  // トースト（S1-15）
  'toast.close': '閉じる',
} as const;

export type MessageKey = keyof typeof ja;
