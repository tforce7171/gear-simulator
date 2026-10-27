// 日本語の辞書（design.md §8）。このキーを正とし、en.ts は同じキーをちょうど持つ。
// キーは「領域.名前」のドット区切りの平らな文字列にする。差し込みは {name} の形で書く
export const ja = {
  'app.title': '歯車シミュレーター',
} as const;

export type MessageKey = keyof typeof ja;
