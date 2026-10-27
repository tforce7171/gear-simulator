// ポインター入力の振り分け（S1-13）。純粋関数のみで、DOM に触れない

// 右ボタン（と各ボタン）を押した位置から、この距離以上動いたらドラッグとみなす（CSS ピクセル）
export const DRAG_THRESHOLD_PX = 4;

// camera-rotate: 注視点のまわりを周回、camera-pan: 平行移動、app: 部品・ハンドル・候補が受け取る
export type PointerRoute = 'camera-rotate' | 'camera-pan' | 'app' | 'none';

export interface PointerDownInput {
  button: number; // 0 左, 1 中, 2 右
  altKey: boolean;
  shiftKey: boolean;
  spaceHeld: boolean;
  overInteractive: boolean; // hitTest の結果
}

// 優先順位: Space+左 → pan、中 → pan、Shift+右 → pan、右 → rotate、Alt+左 → rotate、
// 左で部品の上 → app、左 → rotate、それ以外 → none
export function routePointerDown(input: PointerDownInput): PointerRoute {
  const { button } = input;
  if (button === 0 && input.spaceHeld) return 'camera-pan';
  if (button === 1) return 'camera-pan';
  if (button === 2) return input.shiftKey ? 'camera-pan' : 'camera-rotate';
  if (button === 0) {
    if (input.altKey) return 'camera-rotate';
    return input.overInteractive ? 'app' : 'camera-rotate';
  }
  return 'none';
}

// 押した位置 down から now までの移動が threshold 以上か
export function exceedsDragThreshold(
  down: { x: number; y: number },
  now: { x: number; y: number },
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(now.x - down.x, now.y - down.y) >= threshold;
}
