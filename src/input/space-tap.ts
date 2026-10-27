// Space の「押して離す」の判定（S1-22、要件 §7.2）。全モーターの一時停止の切り替えに使う。
// 押している間にドラッグした（Space+ドラッグの平行移動。S1-13）、または長く押していたときは切り替えない

// これより長く押していたら「押して離す」とみなさない（ms）
export const SPACE_TAP_MAX_MS = 500;

export type SpaceTapEvent =
  | { type: 'keydown'; repeat: boolean; timeMs: number }
  | { type: 'keyup'; timeMs: number }
  | { type: 'drag' }; // Space を押している間にドラッグが始まった

// 状態を持つ判定器を作る。keyup で「押して離す」が成り立ったら 'tap'、それ以外は null を返す
export function createSpaceTapDetector(): (e: SpaceTapEvent) => 'tap' | null {
  let downAt: number | null = null; // 押した時刻。押していなければ null
  let dragged = false;
  return (e) => {
    switch (e.type) {
      case 'keydown':
        // 自動の繰り返しは無視する（最初に押した時刻を保つ）
        if (e.repeat && downAt !== null) return null;
        downAt = e.timeMs;
        dragged = false;
        return null;
      case 'drag':
        if (downAt !== null) dragged = true;
        return null;
      case 'keyup': {
        const start = downAt;
        downAt = null;
        if (start === null || dragged) return null;
        return e.timeMs - start <= SPACE_TAP_MAX_MS ? 'tap' : null;
      }
    }
  };
}
