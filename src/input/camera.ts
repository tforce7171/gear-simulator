import CameraControls from 'camera-controls';
import {
  Box3,
  MathUtils,
  Matrix4,
  type OrthographicCamera,
  type PerspectiveCamera,
  Plane,
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
import {
  exceedsDragThreshold,
  type PointerRoute,
  type PointerTarget,
  routePointerDown,
} from './pointer-route';
import {
  anglesForView,
  nearestAngle,
  orthoHeightForDistance,
  type ViewName,
  viewFromKey,
} from './views';
import { watchAzimuthDelta } from './watch';
import {
  createWheelClassifier,
  decideWheelAction,
  type InputDevice,
  type InputDeviceSetting,
  type TrackpadScroll,
} from './wheel';

// カメラ操作（S1-13）。camera-controls を包み、マウスのボタンの割り当て（要件 §7.1）は自前の
// ポインター入力から rotate / truck を呼んで作る。
// S1-14: ホイール（マウス・トラックパッドの判別、ピンチ、2 本指スクロール）、Safari の gesture、
// テンキーの視点の切り替え、透視投影と平行投影の切り替え、眺めるモードの周回も自前で行う

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

export type Projection = 'perspective' | 'orthographic';

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  projection: Projection;
}

// 入力の設定（AppState.settings のうちカメラが使う項目。S1-14）
export interface CameraInputSettings {
  readonly inputDevice: InputDeviceSetting;
  readonly trackpadScroll: TrackpadScroll;
}

const DEFAULT_INPUT_SETTINGS: CameraInputSettings = { inputDevice: 'auto', trackpadScroll: 'pan' };

// ページ座標の点の下にあるものの扱い（部品・ハンドルは 'app'、候補は 'click-only'。S1-18）。
// S1-16 が本物のピッキングに差し替える
export type HitTest = (pageX: number, pageY: number) => PointerTarget;

export interface ContextRequest {
  x: number; // ページ座標（CSS ピクセル）
  y: number;
}

export interface CameraInputDeps {
  readonly camera: PerspectiveCamera;
  // 平行投影のカメラ（S1-14）。見える高さ = orthoFrustumHeight / zoom
  readonly orthoCamera: OrthographicCamera;
  readonly orthoFrustumHeight: number;
  // 描くカメラを切り替える（render/renderer.ts の setProjection）
  readonly setProjection: (projection: Projection) => void;
  readonly canvas: HTMLCanvasElement;
  readonly keyboard: Keyboard;
  // 部品の範囲（ids を省略すると全部品。core/layout/bounds.ts の boundsOf を今のシーンで呼ぶ）
  readonly boundsOf: (ids?: readonly string[]) => Aabb | null;
  // ページ座標の点の下にある点（部品、無ければ床）。何にも当たらなければ null
  readonly pickPoint: (pageX: number, pageY: number) => Vec3 | null;
  // 選択中の部品（F で寄る先）。S1-16 で AppState.selection を渡す。省略すると常に未選択
  readonly getSelection?: () => string | null;
  readonly initialPose: Pick<CameraPose, 'position' | 'target'>;
  // 入力デバイスと 2 本指スクロールの割り当て（AppState.settings）。省略すると初期値
  readonly getSettings?: () => CameraInputSettings;
  // 眺めるモードか（AppState.view.watchMode）。省略すると常に false
  readonly isWatching?: () => boolean;
}

export interface CameraInput {
  setHitTest(hitTest: HitTest): void;
  // 右クリック（ドラッグなし）でのコンテキストメニューの要求。解除する関数を返す
  onContextRequest(listener: (e: ContextRequest) => void): () => void;
  // 経路が 'app'（左ボタンで部品・ハンドル・候補の上。Alt・Space なし）の pointerdown（S1-17）。
  // 受け取った側がドラッグを始める。解除する関数を返す
  onAppPointerDown(listener: (e: PointerEvent) => void): () => void;
  // カメラのドラッグが DRAG_THRESHOLD_PX 以上動いて始まったとき（Space の押して離すの判定に使う。
  // S1-22）。解除する関数を返す
  onDragStart(listener: () => void): () => void;
  fitAll(): void; // 全体表示。部品が無ければ初期の視点に戻す
  fitTo(ids: readonly string[]): void; // 指定した部品に寄る。範囲が無ければ全体表示
  dollyToPoint(world: Vec3): void; // その点を注視点にし、距離を半分にして寄る
  getPose(): CameraPose; // 今の（移っている途中ならその時点の）視点
  setPose(pose: Pick<CameraPose, 'position' | 'target'>, animate?: boolean): void;
  // 注視点と距離を保ったまま、決まった方向から見る（なめらかに移る。S1-14）
  setView(view: ViewName): void;
  // 透視投影と平行投影を切り替える。注視点のあたりの見かけの大きさを保つ（S1-14）
  toggleProjection(): void;
  getProjection(): Projection;
  // 今使っている（判別した、または設定で固定した）入力デバイス（S1-14）
  getInputDevice(): InputDevice;
  // 今描いているカメラ（軸の目印が向きを合わせるのに使う）
  activeCamera(): PerspectiveCamera | OrthographicCamera;
  update(): void; // 毎フレーム、描く前に呼ぶ
  dispose(): void;
}

const noHit: HitTest = () => 'none';

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
  // ホイールも自前で解釈する（マウスとトラックパッドの判別のため。S1-14）
  controls.mouseButtons.wheel = ACTION.NONE;
  controls.touches.one = ACTION.NONE;
  controls.touches.two = ACTION.NONE;
  controls.touches.three = ACTION.NONE;
  controls.dollyToCursor = false;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  // 平行投影の zoom は見える高さから決める（orthoZoomFor）。その範囲を妨げないように広げる
  controls.minZoom = 1e-4;
  controls.maxZoom = 1e4;

  let hitTest: HitTest = noHit;
  const contextListeners = new Set<(e: ContextRequest) => void>();
  const appPointerListeners = new Set<(e: PointerEvent) => void>();
  const dragStartListeners = new Set<() => void>();
  let drag: Drag | null = null;
  let spaceHeld = false;
  let lastTime: number | null = null;
  let projection: Projection = 'perspective';
  const classify = createWheelClassifier();
  let detectedDevice: InputDevice = 'mouse';
  // Safari のピンチ（gesturestart〜gestureend）の最中。前回の scale
  let gestureScale: number | null = null;
  // 最後にユーザーがカメラを操作した時刻（performance.now()）。眺めるモードを止めるのに使う
  let lastUserInputMs: number | null = null;
  const markUserInput = (): void => {
    lastUserInputMs = performance.now();
  };
  const settings = (): CameraInputSettings => deps.getSettings?.() ?? DEFAULT_INPUT_SETTINGS;
  const fovY = (): number => MathUtils.degToRad(camera.getEffectiveFOV());
  const active = (): PerspectiveCamera | OrthographicCamera =>
    projection === 'perspective' ? camera : deps.orthoCamera;
  // 平行投影で、透視投影の距離 distance と同じ見かけの大きさになる zoom
  const orthoZoomFor = (distance: number): number =>
    deps.orthoFrustumHeight / orthoHeightForDistance(distance, fovY());

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
    if (projection === 'orthographic') void controls.zoomTo(orthoZoomFor(distance), true);
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
    lookFrom(center, Math.max(fitDistance(radius, fovY(), camera.aspect), MIN_DISTANCE));
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
    const height = Math.max(canvas.clientHeight, 1);
    if (projection === 'orthographic') {
      const ortho = deps.orthoCamera;
      return (ortho.top - ortho.bottom) / ortho.zoom / height;
    }
    const distance = camera.position.distanceTo(controls.getTarget(tmpTarget, false));
    return orthoHeightForDistance(distance, fovY()) / height;
  }

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const plane = new Plane();
  const planeHit = new Vector3();
  const tmpNormal = new Vector3();

  // ページ座標の点の下にある、注視点を通って視線に垂直な平面上の点。求まらなければ注視点
  function pointOnTargetPlane(pageX: number, pageY: number, target: Vec3, dir: Vec3): Vec3 {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return target;
    ndc.set(
      ((pageX - window.scrollX - rect.left) / rect.width) * 2 - 1,
      1 - ((pageY - window.scrollY - rect.top) / rect.height) * 2,
    );
    const cam = active();
    cam.updateMatrixWorld();
    raycaster.setFromCamera(ndc, cam);
    plane.setFromNormalAndCoplanarPoint(tmpNormal.set(...dir), tmpTarget.set(...target));
    if (raycaster.ray.intersectPlane(plane, planeHit) === null) return target;
    return [planeHit.x, planeHit.y, planeHit.z];
  }

  // 距離（平行投影なら見える高さ）を factor 倍にする。カーソルの下の点は画面上で動かない
  function zoomAt(factor: number, pageX: number, pageY: number, animate: boolean): void {
    const { position, target } = endPose();
    const offset = sub(position, target);
    const distance = length(offset);
    if (distance === 0 || !Number.isFinite(factor) || factor <= 0) return;
    const nextDistance = MathUtils.clamp(distance * factor, MIN_DISTANCE, MAX_DISTANCE);
    const ratio = nextDistance / distance;
    const cursor = pointOnTargetPlane(pageX, pageY, target, scale(offset, 1 / distance));
    // cursor を中心に ratio 倍する（cursor を通る視線はそのまま）
    const nextTarget: Vec3 = [
      cursor[0] + (target[0] - cursor[0]) * ratio,
      cursor[1] + (target[1] - cursor[1]) * ratio,
      cursor[2] + (target[2] - cursor[2]) * ratio,
    ];
    if (projection === 'orthographic') void controls.zoomTo(orthoZoomFor(nextDistance), animate);
    setPose(
      {
        position: [
          nextTarget[0] + offset[0] * ratio,
          nextTarget[1] + offset[1] * ratio,
          nextTarget[2] + offset[2] * ratio,
        ],
        target: nextTarget,
      },
      animate,
    );
  }

  function setView(view: ViewName): void {
    markUserInput();
    const { azimuth, polar } = anglesForView(view);
    // 遠回りしないように、今の方位角に近い同じ向きへ回る。上・下は今の方位角によらず方位角 0
    // （画面の右が +X）にそろえる
    controls.normalizeRotations();
    void controls.rotateTo(nearestAngle(controls.azimuthAngle, azimuth), polar, true);
  }

  function setProjectionMode(next: Projection): void {
    if (next === projection) return;
    const { position, target } = endPose();
    const distance = length(sub(position, target));
    projection = next;
    controls.stop();
    // 注視点のあたりの見かけの大きさを保つ: 平行投影の見える高さ = 透視投影のその距離で見える高さ。
    // 距離は平行投影でも同じ値を保つので、戻すときは zoom を 1 にするだけ
    const nextCamera = active();
    nextCamera.position.copy(controls.camera.position);
    nextCamera.quaternion.copy(controls.camera.quaternion);
    controls.camera = nextCamera;
    void controls.zoomTo(next === 'orthographic' ? orthoZoomFor(distance) : 1, false);
    deps.setProjection(next);
    controls.update(0);
  }

  function getInputDevice(): InputDevice {
    const setting = settings().inputDevice;
    return setting === 'auto' ? detectedDevice : setting;
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
      overInteractive: e.button === 0 ? hitTest(e.pageX, e.pageY) : 'none',
    });
    // 'app' は部品の側が受け取る（ハンドルは S1-17）。カメラは動かさない
    if (route === 'app') {
      for (const listener of [...appPointerListeners]) listener(e);
      return;
    }
    if (route === 'none') return;
    // 中ボタンの自動スクロールを止める
    if (e.button === 1) e.preventDefault();
    markUserInput();
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
      for (const listener of [...dragStartListeners]) listener();
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
    if (point !== null) {
      markUserInput();
      dollyToPoint(point);
    }
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Safari のピンチは gesture* で扱う（同じ操作の ctrlKey 付きの wheel で二重にズームしない）
    if (gestureScale !== null && e.ctrlKey) return;
    const sample = {
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      timeStamp: e.timeStamp,
    };
    const { inputDevice, trackpadScroll } = settings();
    if (inputDevice === 'auto') detectedDevice = classify(sample);
    const device = getInputDevice();
    const action = decideWheelAction(sample, device, trackpadScroll);
    markUserInput();
    switch (action.kind) {
      case 'zoom':
        // マウスのホイールは 1 目盛りが大きいので、なめらかに移る。ピンチは連続なのでそのまま
        zoomAt(action.factor, e.pageX, e.pageY, device === 'mouse' && !e.ctrlKey);
        break;
      case 'pan':
        // 内容がスクロールのように逆へ動く（ドラッグで (−dx, −dy) 動かしたのと同じ）
        applyDrag('camera-pan', -action.dx, -action.dy);
        break;
      case 'rotate':
        applyDrag('camera-rotate', -action.dx, -action.dy);
        break;
    }
  };

  // Safari のピンチ。scale は gesturestart からの累積の倍率（>1 で指を広げた = 近づく）
  interface GestureLike extends UIEvent {
    scale?: number;
    pageX?: number;
    pageY?: number;
  }
  const onGestureStart = (event: Event): void => {
    event.preventDefault();
    gestureScale = (event as GestureLike).scale ?? 1;
    markUserInput();
  };
  const onGestureChange = (event: Event): void => {
    event.preventDefault();
    const e = event as GestureLike;
    const scaleNow = e.scale ?? 1;
    if (gestureScale !== null && scaleNow > 0 && gestureScale > 0) {
      const rect = canvas.getBoundingClientRect();
      const x = e.pageX ?? rect.left + window.scrollX + rect.width / 2;
      const y = e.pageY ?? rect.top + window.scrollY + rect.height / 2;
      zoomAt(gestureScale / scaleNow, x, y, false);
    }
    gestureScale = scaleNow;
    markUserInput();
  };
  const onGestureEnd = (event: Event): void => {
    event.preventDefault();
    gestureScale = null;
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
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('gesturestart', onGestureStart);
  canvas.addEventListener('gesturechange', onGestureChange);
  canvas.addEventListener('gestureend', onGestureEnd);
  window.addEventListener('blur', onBlur);

  const unbind = [
    // Space は押している間だけ平行移動の修飾キー（押して離すでの一時停止は main.ts。S1-22）
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
          markUserInput();
          const selection = deps.getSelection?.() ?? null;
          if (selection === null) fitAll();
          else fitTo([selection]);
        },
      },
    ),
    keyboard.bind(
      { key: 'Home' },
      {
        onDown: (e) => {
          // NumLock が切れているとテンキー 7 も key が 'Home' になる。テンキーは視点の切り替えに使う
          if (e.code.startsWith('Numpad')) return;
          markUserInput();
          fitAll();
        },
      },
    ),
    // テンキー 1/3/7（Ctrl・Cmd で反対側）で決まった方向から見る（S1-14）
    ...['Numpad1', 'Numpad3', 'Numpad7'].flatMap((code) =>
      [false, true].map((ctrl) =>
        keyboard.bind(
          { code, ctrl },
          {
            onDown: (e) => {
              const view = viewFromKey(e.code, e.ctrlKey || e.metaKey);
              if (view !== null) setView(view);
            },
          },
        ),
      ),
    ),
    // テンキー 5 で透視投影と平行投影を切り替える（S1-14）
    keyboard.bind(
      { code: 'Numpad5' },
      {
        onDown: () => {
          markUserInput();
          setProjectionMode(projection === 'perspective' ? 'orthographic' : 'perspective');
        },
      },
    ),
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
    onAppPointerDown(listener) {
      appPointerListeners.add(listener);
      return () => {
        appPointerListeners.delete(listener);
      };
    },
    onDragStart(listener) {
      dragStartListeners.add(listener);
      return () => {
        dragStartListeners.delete(listener);
      };
    },
    fitAll,
    fitTo,
    dollyToPoint,
    getPose() {
      return {
        position: toVec3(controls.getPosition(tmpPosition, false)),
        target: toVec3(controls.getTarget(tmpTarget, false)),
        projection,
      };
    },
    setPose,
    setView,
    toggleProjection() {
      setProjectionMode(projection === 'perspective' ? 'orthographic' : 'perspective');
    },
    getProjection: () => projection,
    getInputDevice,
    activeCamera: active,
    update() {
      const now = performance.now();
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      // ドラッグしている間は操作中（眺めるモードを止める）
      if (drag !== null) markUserInput();
      if (deps.isWatching?.() === true) {
        const delta = watchAzimuthDelta(dt, now, lastUserInputMs);
        if (delta > 0) void controls.rotate(delta, 0, false);
      }
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
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('gestureend', onGestureEnd);
      window.removeEventListener('blur', onBlur);
      controls.dispose();
    },
  };
}
