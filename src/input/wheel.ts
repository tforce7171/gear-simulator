// ホイールの入力の判別と解釈（S1-14）。純粋関数のみ（DOM に触れない）
import type { TrackpadScroll } from '../core/settings';

export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number; // 0: pixel, 1: line, 2: page
  ctrlKey: boolean;
  timeStamp: number; // ms
}
export type InputDevice = 'mouse' | 'trackpad';

// 設定の型は core/settings.ts が持つ（S1-30。core は input を import できないため）
export type { InputDeviceSetting, TrackpadScroll } from '../core/settings';

// マウスの弱い証拠とみなす |deltaY| の下限（1 目盛りぶんの画素）
export const MOUSE_NOTCH_MIN_PX = 50;
// 前の wheel からこれ以上空いたら、新しい操作の始まりとみなす
export const WHEEL_GESTURE_GAP_MS = 500;
// deltaMode 1（行）・2（ページ）を画素に換算する量
export const WHEEL_LINE_PX = 16;
export const WHEEL_PAGE_PX = 800;
// ズームの速さ。距離に掛ける倍率 = exp(画素 × 速さ)
export const WHEEL_ZOOM_SPEED = 0.002; // マウスのホイール（1 目盛り 100px で約 1.22 倍）
export const PINCH_ZOOM_SPEED = 0.01; // トラックパッドのピンチ（ctrlKey 付きの wheel）

function isTrackpadEvidence(s: WheelSample): boolean {
  if (s.deltaMode !== 0) return false;
  // ctrlKey で deltaY が整数でない（ピンチ）も、deltaY が整数でない、に含まれる
  return s.deltaX !== 0 || !Number.isInteger(s.deltaY);
}

function isWeakMouseEvidence(s: WheelSample): boolean {
  return (
    s.deltaMode === 0 &&
    s.deltaX === 0 &&
    Number.isInteger(s.deltaY) &&
    Math.abs(s.deltaY) >= MOUSE_NOTCH_MIN_PX
  );
}

// 状態を持つ判別器。サンプルを順に入れると、その時点の判別結果を返す（初期値は 'mouse'）。
// トラックパッドの証拠が来たらすぐトラックパッドにし、マウスへ戻すのは強い証拠（deltaMode ≠ 0）か、
// 新しい操作の始まり（前の wheel から WHEEL_GESTURE_GAP_MS 以上）の弱い証拠だけ（慣性の途中で揺れないように）
export function createWheelClassifier(): (sample: WheelSample) => InputDevice {
  let device: InputDevice = 'mouse';
  let lastTime: number | null = null;
  return (sample) => {
    const gap = lastTime === null ? Number.POSITIVE_INFINITY : sample.timeStamp - lastTime;
    lastTime = sample.timeStamp;
    if (sample.deltaMode !== 0) device = 'mouse';
    else if (isTrackpadEvidence(sample)) device = 'trackpad';
    else if (isWeakMouseEvidence(sample) && gap >= WHEEL_GESTURE_GAP_MS) device = 'mouse';
    return device;
  };
}

export type WheelAction =
  | { kind: 'zoom'; factor: number } // 距離に掛ける倍率。>1 で遠ざかる
  | { kind: 'pan'; dx: number; dy: number } // 画面のピクセル
  | { kind: 'rotate'; dx: number; dy: number }; // 画面のピクセル

function toPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_PAGE_PX;
  return delta;
}

// wheel 1 回ぶんの動作。ctrlKey 付き（ピンチ・Ctrl+ホイール）はデバイスによらずズーム、
// マウスはズーム、トラックパッドの 2 本指スクロールは割り当て（scroll）に従う。
// pan・rotate の dx・dy は deltaX・deltaY（画素）そのまま。正の向きは「内容がスクロールのように
// 逆へ動く」向き（カメラを (dx, dy) だけ画面上で動かす。dy は画面の下が正）
export function decideWheelAction(
  sample: WheelSample,
  device: InputDevice,
  scroll: TrackpadScroll,
): WheelAction {
  const dx = toPixels(sample.deltaX, sample.deltaMode);
  const dy = toPixels(sample.deltaY, sample.deltaMode);
  if (sample.ctrlKey || device === 'mouse') {
    const speed = sample.ctrlKey && device === 'trackpad' ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
    return { kind: 'zoom', factor: Math.exp(dy * speed) };
  }
  return scroll === 'pan' ? { kind: 'pan', dx, dy } : { kind: 'rotate', dx, dy };
}
