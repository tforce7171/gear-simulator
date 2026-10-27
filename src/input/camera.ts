import CameraControls from 'camera-controls';
import {
  Box3,
  MathUtils,
  Matrix4,
  type PerspectiveCamera,
  Quaternion,
  Raycaster,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Aabb } from '../core/layout/bounds';
import { length, scale, sub, type Vec3 } from '../core/math/vec3';
import { fitDistance } from './camera-fit';
import type { Keyboard } from './keyboard';
import { exceedsDragThreshold, type PointerRoute, routePointerDown } from './pointer-route';

// カメラ操作（S1-13）。camera-controls を包み、マウスのボタンの割り当て（要件 §7.1）は自前の
// ポインター入力から rotate / truck を呼んで作る。ホイールのズームは camera-controls の dollyToCursor に任せる

CameraControls.install({
  THREE: {
    Vector2,
    Vector3,
    Vector4,
    Quaternion,
    Matrix4,
    Spherical,
    Box3,
    Sphere,
    Raycaster,
  },
});

// カメラと注視点の距離の範囲（mm）
const MIN_DISTANCE = 5;
const MAX_DISTANCE = 3000;

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  projection: 'perspective' | 'orthographic';
}

// ページ座標の点が部品（歯車・ハンドル・候補）の上か。S1-16 が本物のピッキングに差し替える
export type HitTest = (pageX: number, pageY: number) => boolean;

export interface ContextRequest {
  x: number; // ページ座標（CSS ピクセル）
  y: number;
}

export interface CameraInputDeps {
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly keyboard: Keyboard;
  // 部品の範囲（ids を省略すると全部品。core/layout/bounds.ts の boundsOf を今のシーンで呼ぶ）
  readonly boundsOf: (ids?: readonly string[]) => Aabb | null;
  // ページ座標の点の下にある点（部品、無ければ床）。何にも当たらなければ null
  readonly pickPoint: (pageX: number, pageY: number) => Vec3 | null;
  // 選択中の部品（F で寄る先）。S1-16 で AppState.selection を渡す。省略すると常に未選択
  readonly getSelection?: () => string | null;
  readonly initialPose: Pick<CameraPose, 'position' | 'target'>;
}

export interface CameraInput {
  setHitTest(hitTest: HitTest): void;
  // 右クリック（ドラッグなし）でのコンテキストメニューの要求。解除する関数を返す
  onContextRequest(listener: (e: ContextRequest) => void): () => void;
  fitAll(): void; // 全体表示。部品が無ければ初期の視点に戻す
  fitTo(ids: readonly string[]): void; // 指定した部品に寄る。範囲が無ければ全体表示
  dollyToPoint(world: Vec3): void; // その点を注視点にし、距離を半分にして寄る
  getPose(): CameraPose; // 今の（移っている途中ならその時点の）視点
  setPose(pose: Pick<CameraPose, 'position' | 'target'>, animate?: boolean): void;
  update(): void; // 毎フレーム、描く前に呼ぶ
  dispose(): void;
}

const noHit: HitTest = () => false;

interface Drag {
  pointerId: number;
  button: number;
  route: Exclude<PointerRoute, 'none' | 'app'>;
  down: { x: number; y: number };
  last: { x: number; y: number };
  dragging: boolean; // DRAG_THRESHOLD_PX 以上動いた
}

function toVec3(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

export function createCameraInput(deps: CameraInputDeps): CameraInput {
  const { camera, canvas, keyboard } = deps;
  const controls = new CameraControls(camera, canvas);
  const { ACTION } = CameraControls;
  // ボタンとタッチは自前で振り分けるので camera-controls には渡さない。ホイールだけ任せる
  controls.mouseButtons.left = ACTION.NONE;
  controls.mouseButtons.middle = ACTION.NONE;
  controls.mouseButtons.right = ACTION.NONE;
  controls.mouseButtons.wheel = ACTION.DOLLY;
  controls.touches.one = ACTION.NONE;
  controls.touches.two = ACTION.NONE;
  controls.touches.three = ACTION.NONE;
  controls.dollyToCursor = true;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;

  let hitTest: HitTest = noHit;
  const contextListeners = new Set<(e: ContextRequest) => void>();
  let drag: Drag | null = null;
  let spaceHeld = false;
  let lastTime: number | null = null;

  const tmpPosition = new Vector3();
  const tmpTarget = new Vector3();

  function setPose(pose: Pick<CameraPose, 'position' | 'target'>, animate = false): void {
    const [px, py, pz] = pose.position;
    const [tx, ty, tz] = pose.target;
    void controls.setLookAt(px, py, pz, tx, ty, tz, animate);
    if (!animate) controls.update(0);
  }
  setPose(deps.initialPose);

  // 移り先（移っている途中なら最後の値）の視点
  function endPose(): { position: Vec3; target: Vec3 } {
    return {
      position: toVec3(controls.getPosition(tmpPosition, true)),
      target: toVec3(controls.getTarget(tmpTarget, true)),
    };
  }

  // 注視点 → カメラの向き（単位ベクトル）。ちょうど重なっていれば斜め上から
  function viewDirection(): Vec3 {
    const { position, target } = endPose();
    const offset = sub(position, target);
    const len = length(offset);
    return len > 0 ? scale(offset, 1 / len) : [0, Math.SQRT1_2, Math.SQRT1_2];
  }

  // 注視点を point にし、今の向きのまま distance だけ離れた所へなめらかに移る
  function lookFrom(point: Vec3, distance: number): void {
    const dir = viewDirection();
    setPose(
      {
        position: [
          point[0] + dir[0] * distance,
          point[1] + dir[1] * distance,
          point[2] + dir[2] * distance,
        ],
        target: point,
      },
      true,
    );
  }

  function fitBox(box: Aabb): void {
    const center: Vec3 = [
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    ];
    const radius = length(sub(box.max, box.min)) / 2;
    const fovY = MathUtils.degToRad(camera.getEffectiveFOV());
    lookFrom(center, Math.max(fitDistance(radius, fovY, camera.aspect), MIN_DISTANCE));
  }

  function fitAll(): void {
    const box = deps.boundsOf();
    if (box === null) setPose(deps.initialPose, true);
    else fitBox(box);
  }

  function fitTo(ids: readonly string[]): void {
    const box = deps.boundsOf(ids);
    if (box === null) fitAll();
    else fitBox(box);
  }

  function dollyToPoint(world: Vec3): void {
    const { position, target } = endPose();
    lookFrom(world, Math.max(length(sub(position, target)) / 2, MIN_DISTANCE));
  }

  // 注視点までの距離で、画面の縦 1 ピクセルが何 mm にあたるか
  function worldPerPixel(): number {
    const distance = camera.position.distanceTo(controls.getTarget(tmpTarget, false));
    const fovY = MathUtils.degToRad(camera.getEffectiveFOV());
    const height = Math.max(canvas.clientHeight, 1);
    return (2 * distance * Math.tan(fovY / 2)) / height;
  }

  function applyDrag(route: Drag['route'], dx: number, dy: number): void {
    if (route === 'camera-rotate') {
      const height = Math.max(canvas.clientHeight, 1);
      // camera-controls の既定のドラッグと同じ向きと速さ（画面の高さぶんで 1 周）
      void controls.rotate((-2 * Math.PI * dx) / height, (-2 * Math.PI * dy) / height, false);
    } else {
      // つかんだ点がカーソルについてくる向き
      const s = worldPerPixel();
      void controls.truck(-dx * s, -dy * s, false);
    }
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (drag !== null) return;
    const route = routePointerDown({
      button: e.button,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      spaceHeld,
      overInteractive: e.button === 0 ? hitTest(e.pageX, e.pageY) : false,
    });
    // 'app' は部品の側が受け取る（受け取り手は S1-16 以降）。カメラは動かさない
    if (route === 'none' || route === 'app') return;
    // 中ボタンの自動スクロールを止める
    if (e.button === 1) e.preventDefault();
    drag = {
      pointerId: e.pointerId,
      button: e.button,
      route,
      down: { x: e.pageX, y: e.pageY },
      last: { x: e.pageX, y: e.pageY },
      dragging: false,
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 捕捉できなくても、キャンバスの上でのドラッグは動く
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (drag === null || e.pointerId !== drag.pointerId) return;
    const now = { x: e.pageX, y: e.pageY };
    if (!drag.dragging) {
      if (!exceedsDragThreshold(drag.down, now)) return;
      // しきい値を超えるまでの分も含めて動かす（drag.last はまだ押した位置）
      drag.dragging = true;
    }
    applyDrag(drag.route, now.x - drag.last.x, now.y - drag.last.y);
    drag.last = now;
  };

  const endDrag = (e: PointerEvent, canceled: boolean): void => {
    if (drag === null || e.pointerId !== drag.pointerId) return;
    const ended = drag;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    // 右ボタンを DRAG_THRESHOLD_PX 未満の移動で離した → コンテキストメニューの要求
    if (!canceled && ended.button === 2 && !ended.dragging) {
      const request: ContextRequest = { x: e.pageX, y: e.pageY };
      for (const listener of contextListeners) listener(request);
    }
  };
  const onPointerUp = (e: PointerEvent): void => endDrag(e, false);
  const onPointerCancel = (e: PointerEvent): void => endDrag(e, true);

  // ブラウザ標準のメニューは出さない（環境によって押したときと離したときのどちらで来るかが違うので、
  // 右クリックかどうかは pointerup で決める）
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  const onDoubleClick = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const point = deps.pickPoint(e.pageX, e.pageY);
    if (point !== null) dollyToPoint(point);
  };

  const onBlur = (): void => {
    spaceHeld = false;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('blur', onBlur);

  const unbind = [
    // Space は押している間だけ平行移動の修飾キー（押して離すでの一時停止は S1-22）
    keyboard.bind(
      { key: ' ' },
      {
        onDown: () => {
          spaceHeld = true;
        },
        onUp: () => {
          spaceHeld = false;
        },
      },
    ),
    keyboard.bind(
      { key: 'f' },
      {
        onDown: () => {
          const selection = deps.getSelection?.() ?? null;
          if (selection === null) fitAll();
          else fitTo([selection]);
        },
      },
    ),
    keyboard.bind({ key: 'Home' }, { onDown: fitAll }),
  ];

  return {
    setHitTest(next) {
      hitTest = next;
    },
    onContextRequest(listener) {
      contextListeners.add(listener);
      return () => {
        contextListeners.delete(listener);
      };
    },
    fitAll,
    fitTo,
    dollyToPoint,
    getPose() {
      return {
        position: toVec3(controls.getPosition(tmpPosition, false)),
        target: toVec3(controls.getTarget(tmpTarget, false)),
        projection: 'perspective',
      };
    },
    setPose,
    update() {
      const now = performance.now();
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      controls.update(dt);
    },
    dispose() {
      for (const off of unbind) off();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('blur', onBlur);
      controls.dispose();
    },
  };
}
