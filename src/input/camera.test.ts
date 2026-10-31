import { OrthographicCamera, PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '../core/math/vec3';
import { type CameraInput, createCameraInput } from './camera';
import type { Keyboard } from './keyboard';
import { WHEEL_ZOOM_SPEED } from './wheel';

// S4-01: 方位角を何周も回したあとのアニメーション付きの移動（ホイールのズーム・全体表示など）で、
// カメラが回り込まないこと。DOM の無い node で動かすため、キャンバスと window は最小限の偽物を使う

const WIDTH = 800;
const HEIGHT = 600;
const FRAME_MS = 1000 / 60;
const INITIAL_POSITION: Vec3 = [0, 120, 200];
const INITIAL_TARGET: Vec3 = [0, 0, 0];

type Listener = (e: unknown) => void;

function fakeCanvas() {
  const listeners = new Map<string, Set<Listener>>();
  const canvas = {
    clientWidth: WIDTH,
    clientHeight: HEIGHT,
    style: {} as Record<string, string>,
    ownerDocument: { addEventListener() {}, removeEventListener() {} },
    setAttribute() {},
    removeAttribute() {},
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: WIDTH,
      bottom: HEIGHT,
      width: WIDTH,
      height: HEIGHT,
      x: 0,
      y: 0,
    }),
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  };
  const dispatch = (type: string, e: Record<string, unknown>): void => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(e);
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, dispatch };
}

const keyboard: Keyboard = {
  bind: () => () => {},
  dispose() {},
};

interface Harness {
  input: CameraInput;
  // 左ボタンで横に dx（CSS ピクセル）ドラッグする。高さぶんで方位角が 1 周回る
  dragHorizontally(dx: number): void;
  wheel(deltaY: number): void;
  // 1 フレームぶん時間を進めて update する
  step(): void;
  watching: { value: boolean };
}

let now = 0;

function setup(): Harness {
  const { canvas, dispatch } = fakeCanvas();
  const watching = { value: false };
  const input = createCameraInput({
    camera: new PerspectiveCamera(45, WIDTH / HEIGHT, 1, 20_000),
    orthoCamera: new OrthographicCamera(-200, 200, 150, -150, 1, 20_000),
    orthoFrustumHeight: 300,
    setProjection() {},
    canvas,
    keyboard,
    boundsOf: () => ({ min: [-50, -10, -50], max: [50, 10, 50] }),
    pickPoint: () => null,
    initialPose: { position: INITIAL_POSITION, target: INITIAL_TARGET },
    getSettings: () => ({ inputDevice: 'mouse', trackpadScroll: 'pan' }),
    isWatching: () => watching.value,
  });
  const center = { x: WIDTH / 2, y: HEIGHT / 2 };
  const pointer = (x: number) => ({
    pointerId: 1,
    button: 0,
    altKey: false,
    shiftKey: false,
    pageX: x,
    pageY: center.y,
    preventDefault() {},
  });
  return {
    input,
    dragHorizontally(dx) {
      dispatch('pointerdown', pointer(center.x));
      dispatch('pointermove', pointer(center.x + dx));
      dispatch('pointerup', pointer(center.x + dx));
    },
    wheel(deltaY) {
      dispatch('wheel', {
        deltaX: 0,
        deltaY,
        deltaMode: 0,
        ctrlKey: false,
        timeStamp: now,
        pageX: center.x,
        pageY: center.y,
        preventDefault() {},
      });
    },
    step() {
      now += FRAME_MS;
      input.update();
    },
    watching,
  };
}

// 注視点 → カメラの、Y 軸まわりの方位角（camera-controls と同じ: +Z が 0、+X が π/2）
function azimuthOf(input: CameraInput): number {
  const { position, target } = input.getPose();
  return Math.atan2(position[0] - target[0], position[2] - target[2]);
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// アニメーションを最後まで進め、途中の各フレームでの方位角の変化（開始時から、周をまたいで足し込んだ
// もの）の絶対値の最大を返す
function maxAzimuthChangeDuringAnimation(h: Harness, frames = 600): number {
  let previous = azimuthOf(h.input);
  let total = 0;
  let max = 0;
  for (let i = 0; i < frames; i++) {
    h.step();
    const current = azimuthOf(h.input);
    total += wrap(current - previous);
    previous = current;
    max = Math.max(max, Math.abs(total));
  }
  return max;
}

function settle(h: Harness, frames = 600): void {
  for (let i = 0; i < frames; i++) h.step();
}

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  // camera-controls が要素の範囲を入れておくのに使う
  vi.stubGlobal(
    'DOMRect',
    class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
    },
  );
  vi.stubGlobal('window', {
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('アニメーション付きの移動で回り込まない（S4-01）', () => {
  it('方位角を 4π 回した状態で zoomAt（マウスのホイール）→ 途中のどの時点でも方位角の変化が π 以内', () => {
    const h = setup();
    h.step();
    // 高さ 600px で 1 周。左へ 1200px で方位角 +4π
    h.dragHorizontally(-2 * HEIGHT);
    h.step();
    h.wheel(100);
    expect(maxAzimuthChangeDuringAnimation(h)).toBeLessThanOrEqual(Math.PI);
    h.input.dispose();
  });

  it('方位角を −5π 回した状態で fitAll（lookFrom）→ 途中のどの時点でも方位角の変化が π 以内', () => {
    const h = setup();
    h.step();
    h.dragHorizontally(2.5 * HEIGHT);
    h.step();
    h.input.fitAll();
    expect(maxAzimuthChangeDuringAnimation(h)).toBeLessThanOrEqual(Math.PI);
    h.input.dispose();
  });

  it('方位角を −5π 回した状態で fitTo・dollyToPoint（lookFrom）→ 方位角の変化が π 以内', () => {
    const h = setup();
    h.step();
    h.dragHorizontally(2.5 * HEIGHT);
    h.step();
    h.input.fitTo(['a']);
    expect(maxAzimuthChangeDuringAnimation(h)).toBeLessThanOrEqual(Math.PI);
    h.input.dollyToPoint([10, 0, 10]);
    expect(maxAzimuthChangeDuringAnimation(h)).toBeLessThanOrEqual(Math.PI);
    h.input.dispose();
  });

  it('眺めるモードで 2 周以上回したあとにホイールでズーム → 方位角の変化が π 以内', () => {
    const h = setup();
    h.watching.value = true;
    // 1 分で 1 周。1 フレームの dt は 0.25 秒で頭打ちなので、2.5 分ぶんを 0.25 秒ずつ進める
    for (let i = 0; i < 600; i++) {
      now += 250;
      h.input.update();
    }
    h.wheel(100);
    // ズームの直後は操作中なので眺めるモードの回転は止まっている（2 秒で再開する前に見る）
    let previous = azimuthOf(h.input);
    let total = 0;
    for (let i = 0; i < 100; i++) {
      h.step();
      const current = azimuthOf(h.input);
      total += wrap(current - previous);
      previous = current;
      expect(Math.abs(total)).toBeLessThanOrEqual(Math.PI);
    }
    h.input.dispose();
  });

  it('回していない状態の zoomAt の最終の位置・注視点は、修正の前と同じ', () => {
    const h = setup();
    h.step();
    // deltaY 100（ピクセル）のホイール 1 目盛り。画面の中央なので注視点はそのまま、距離だけ変わる
    h.wheel(100);
    settle(h);
    const { position, target } = h.input.getPose();
    // 修正の前の実装で得た値と同じ（カメラの位置が注視点から exp(100 × WHEEL_ZOOM_SPEED) 倍に離れる）
    const ratio = Math.exp(100 * WHEEL_ZOOM_SPEED);
    const expected: Vec3 = [0, 120 * ratio, 200 * ratio];
    for (let i = 0; i < 3; i++) {
      expect(position[i]).toBeCloseTo(expected[i] ?? Number.NaN, 3);
      expect(target[i]).toBeCloseTo(0, 3);
    }
    h.input.dispose();
  });
});
