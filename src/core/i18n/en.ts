import type { MessageKey } from './ja';

// 英語の辞書。足りないキーも余分なキーも型エラーになる（design.md §8）
export const en = {
  'app.title': 'Gear Simulator',
} satisfies Record<MessageKey, string>;
