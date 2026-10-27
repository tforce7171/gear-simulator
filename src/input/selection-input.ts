import { exceedsDragThreshold } from './pointer-route';

// 部品のクリックとマウスを乗せた位置（S1-16）。カメラの経路（pointer-route）とは別に、
// 左ボタンを DRAG_THRESHOLD_PX 未満の移動で離したらクリックとして知らせる。
// 何もない所のクリックも知らせる（選択を外す）。ドラッグ（カメラ回転など）では知らせない

export interface SelectionInputDeps {
  readonly canvas: HTMLCanvasElement;
  // 左クリックした位置（ページ座標）
  readonly onClick: (pageX: number, pageY: number) => void;
  // ボタンを押していない間のマウスの位置。canvas から出たら null
  readonly onHover: (point: { x: number; y: number } | null) => void;
}

export interface SelectionInput {
  dispose(): void;
}

export function createSelectionInput(deps: SelectionInputDeps): SelectionInput {
  const { canvas } = deps;
  let press: { pointerId: number; x: number; y: number; moved: boolean } | null = null;

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) {
      // 左ボタンを押している間に別のボタンが押されたら、クリックにしない
      if (press !== null) press.moved = true;
      return;
    }
    press = { pointerId: e.pointerId, x: e.pageX, y: e.pageY, moved: false };
    deps.onHover(null);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (press !== null && e.pointerId === press.pointerId) {
      if (!press.moved && exceedsDragThreshold(press, { x: e.pageX, y: e.pageY })) {
        press.moved = true;
      }
      return;
    }
    if (e.buttons === 0) deps.onHover({ x: e.pageX, y: e.pageY });
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0 || press === null || e.pointerId !== press.pointerId) return;
    const ended = press;
    press = null;
    if (!ended.moved && !exceedsDragThreshold(ended, { x: e.pageX, y: e.pageY })) {
      deps.onClick(e.pageX, e.pageY);
    }
    deps.onHover({ x: e.pageX, y: e.pageY });
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (press !== null && e.pointerId === press.pointerId) press = null;
  };
  const onPointerLeave = (): void => {
    if (press === null) deps.onHover(null);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  return {
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}
