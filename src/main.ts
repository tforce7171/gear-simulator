import { demoScene } from './app/demo-scene';
import { getLanguage, onLanguageChange, setLanguage, t } from './app/i18n';
import { createInfoOverlay } from './app/info-overlay';
import { createInteractions } from './app/interactions';
import { startLoop } from './app/loop';
import { selectionForPick } from './app/selection';
import { createLayoutMemo, createStore } from './app/store';
import { boundsOf } from './core/layout/bounds';
import { resolveLayout } from './core/layout/resolve';
import { installGearSim } from './debug/gear-sim';
import { type ContextRequest, createCameraInput } from './input/camera';
import { createKeyboard, isTypingTarget } from './input/keyboard';
import { createSelectionInput } from './input/selection-input';
import { createSpaceTapDetector } from './input/space-tap';
import { createAxisGizmo } from './render/axis-gizmo';
import { infoArrowSpec } from './render/info-arrows';
import {
  createRenderer,
  INITIAL_CAMERA_POSITION,
  INITIAL_CAMERA_TARGET,
  ORTHO_FRUSTUM_HEIGHT,
} from './render/renderer';
import { warningParts } from './render/warning-effects';
import { createInfoLabels } from './ui/info-labels';
import { createPalette } from './ui/palette';
import { createPauseIndicator } from './ui/pause-indicator';
import { createProperties } from './ui/properties';
import { createUiShell } from './ui/shell';

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('#root が見つからない');

// 画面の骨組み（S1-15）。canvas は中央の描画領域に入れる
const shell = createUiShell(root);
const canvas = document.createElement('canvas');
canvas.id = 'app';
shell.canvasHost.append(canvas);

// タブの題名と <html lang> を現在の言語に合わせる（design.md §8）
function applyLanguage(): void {
  document.title = t('app.title');
  document.documentElement.lang = getLanguage();
}
applyLanguage();
onLanguageChange(applyLanguage);

const store = createStore(demoScene);
const layoutOf = createLayoutMemo();
const renderer = createRenderer(canvas);
const keyboard = createKeyboard(window);
const cameraInput = createCameraInput({
  camera: renderer.camera,
  orthoCamera: renderer.orthoCamera,
  orthoFrustumHeight: ORTHO_FRUSTUM_HEIGHT,
  setProjection: renderer.setProjection,
  canvas,
  keyboard,
  boundsOf: (ids) => {
    const { scene } = store.getState();
    return boundsOf(scene, layoutOf(scene), ids);
  },
  pickPoint: renderer.pickPoint,
  initialPose: { position: INITIAL_CAMERA_POSITION, target: INITIAL_CAMERA_TARGET },
  getSettings: () => store.getState().settings,
  isWatching: () => store.getState().view.watchMode,
  // F で寄る先（S1-16）
  getSelection: () => store.getState().selection,
});
// 編集の操作（S1-17）: パレットから起点を置く、ハンドルのドラッグ、R
const interactions = createInteractions({
  store,
  canvas,
  rayAt: renderer.rayAt,
  // パネル・軸の目印の上は描画領域の外として扱う
  isOverViewport: (x, y) =>
    document.elementFromPoint(x - window.scrollX, y - window.scrollY) === canvas,
  setPreviewStyle: renderer.setPreviewStyle,
  setHandles: renderer.setHandles,
  setCandidates: renderer.setCandidates,
  setReattachRings: renderer.setReattachRings,
  projectToScreen: (world) => renderer.projectToScreen(world),
});
// 描くシーン（ドラッグ中は仮のシーン）と、そのハンドルを描画に渡す
const syncDisplay = (): void => {
  const scene = interactions.displayScene();
  const { scene: stored } = store.getState();
  renderer.sync(scene, scene === stored ? layoutOf(scene) : resolveLayout(scene));
  interactions.beforeRender();
};
// ピッキング（S1-16）。描く前（loadScene や編集の直後）でも今のシーンで当てるように、先に同期する
const pickAt = (x: number, y: number) => {
  syncDisplay();
  return renderer.pick(x, y);
};
// 部品の本体（候補・ハンドルを除く）。候補の陰にある本体を調べる（S1-19）
const BODY_KINDS = ['gear', 'motor', 'shaft'] as const;
const bodyAt = (x: number, y: number) => {
  syncDisplay();
  return renderer.pick(x, y, BODY_KINDS);
};
// 部品・ハンドルの上の左ボタンはカメラを回さない。候補の上は左クリックだけアプリが受け取り、
// 左ドラッグはカメラの回転にする（候補は手で回せないため。S1-18）。ただし、選んでいる detached の
// シャフトの本体が候補の陰にあれば、左ドラッグは付け直しにする（S1-19）
cameraInput.setHitTest((x, y) => {
  const hit = pickAt(x, y);
  if (hit === null) return 'none';
  if (hit.kind !== 'candidate') return 'app';
  return interactions.isReattachBody(bodyAt(x, y)) ? 'app' : 'click-only';
});

// 経路 'app' の左ボタン: ハンドルの上ならハンドルのドラッグ（S1-17・S1-19）、選んでいる detached の
// シャフトの本体なら付け直しのドラッグ（S1-19）、それ以外の部品の本体なら手で回す（S1-21）
cameraInput.onAppPointerDown((e) => {
  const hit = pickAt(e.pageX, e.pageY);
  if (hit?.kind === 'handle') {
    interactions.beginHandleDrag(e, hit.id);
    return;
  }
  const body = bodyAt(e.pageX, e.pageY);
  if (interactions.pressBody(e, body)) return;
  interactions.pressHand(e, body);
});

// 選択（S1-16）。左クリックで当たった部品を選び（モーターはそのシャフト）、何もない所なら外す。
// ハンドルのクリックでは選択を変えない（S1-17）。候補のクリックでは歯車を生やして選ぶ（S1-18）
const selectAt = (x: number, y: number): void => {
  const { scene } = store.getState();
  const hit = pickAt(x, y);
  if (hit?.kind === 'handle') return;
  if (hit?.kind === 'candidate') {
    interactions.grow(Number(hit.id));
    return;
  }
  store.dispatch({ type: 'select', id: selectionForPick(hit, scene) });
};
// マウスを乗せた位置。ハイライトする部品は描く前に求め直す（シーンやカメラが動いても追従する）
let hoverPoint: { x: number; y: number } | null = null;
createSelectionInput({
  canvas,
  onClick: selectAt,
  onHover: (point) => {
    hoverPoint = point;
  },
});
// Esc: ドラッグ中ならやめて元に戻す（S1-17）。手で回している最中なら回すのを終える（S1-21）。
// それ以外は選択を外す
const unselect = (): void => {
  if (interactions.cancel()) return;
  store.dispatch({ type: 'select', id: null });
};
const deleteSelection = (): void => {
  const { selection } = store.getState();
  if (selection === null) return;
  store.dispatch({ type: 'command', command: { type: 'deleteParts', ids: [selection] } });
};
keyboard.bind({ key: 'Escape' }, { onDown: unselect });
keyboard.bind({ key: 'Delete' }, { onDown: deleteSelection });
// Mac のキーボードの delete キーは Backspace
keyboard.bind({ key: 'Backspace' }, { onDown: deleteSelection });
// Ctrl は Mac の Cmd も含む（keyboard.ts）
keyboard.bind(
  { key: 'z', ctrl: true, shift: false },
  { onDown: () => store.dispatch({ type: 'undo' }), allowRepeat: true },
);
keyboard.bind(
  { key: 'z', ctrl: true, shift: true },
  { onDown: () => store.dispatch({ type: 'redo' }), allowRepeat: true },
);
// Space の押して離す: 全モーターの一時停止を切り替える（S1-22）。押している間にカメラのドラッグ
// （Space+ドラッグの平行移動）があった、または長く押していたときは切り替えない。押している間の
// 平行移動は camera.ts が同じキーで受け取る
const spaceTap = createSpaceTapDetector();
keyboard.bind(
  { key: ' ' },
  {
    onDown: (e) => {
      spaceTap({ type: 'keydown', repeat: e.repeat, timeMs: e.timeStamp });
    },
    onUp: (e) => {
      // テキストの入力中は文字の入力に任せる。それ以外（ボタンにフォーカスがあるときなど）は、
      // 離したときのボタンの押下も止める（押したときは keyboard.ts が止める）
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (spaceTap({ type: 'keyup', timeMs: e.timeStamp }) === 'tap') {
        store.dispatch({ type: 'togglePause' });
      }
    },
    allowRepeat: true,
  },
);
cameraInput.onDragStart(() => {
  spaceTap({ type: 'drag' });
});
// R: 起点を置くドラッグ中は仮の部品の向き、それ以外は選んだ起点（detached）のシャフトの向き（S1-17）
keyboard.bind({ key: 'r' }, { onDown: () => interactions.rotate() });
// 部品パレット（S1-17）: 歯車の大きさと、床へドラッグして置く起点のシャフト
const palette = createPalette({
  body: shell.palette.body,
  getSize: () => store.getState().palette.size,
  setSize: (size) => store.dispatch({ type: 'setPaletteSize', size }),
  onRootDragStart: (x, y) => interactions.beginRootDrag(x, y),
  onRootDragMove: (x, y) => interactions.moveRootDrag(x, y),
  onRootDragEnd: (x, y) => interactions.endRootDrag(x, y),
  onRootDragCancel: () => interactions.cancelRootDrag(),
});
store.subscribe(() => palette.refresh());
// 一時停止中の表示（S1-22）。描画領域の上部中央
const pauseIndicator = createPauseIndicator(shell.canvasHost);
store.subscribe((state) => pauseIndicator.setPaused(state.sim.paused));
// 情報表示（S1-23）: 歯車ごとの rpm・ギア比のラベルと回転方向の矢印。ツールバーのボタンで
// 全歯車に出す（ON）・選択中の歯車だけ（OFF）を切り替える
const infoOverlay = createInfoOverlay({
  getState: () => store.getState(),
  layoutOf,
  getLanguage,
  labels: createInfoLabels(shell.canvasHost),
  setArrows: renderer.setInfoArrows,
  arrowSpec: infoArrowSpec,
  project: renderer.projectToCanvas,
});
const infoButton = shell.toolbar.button('info');
infoButton.disabled = false;
const applyInfoButton = (on: boolean): void => {
  infoButton.setAttribute('aria-pressed', String(on));
};
applyInfoButton(store.getState().view.infoOverlay);
infoButton.addEventListener('click', () => {
  store.dispatch({ type: 'setInfoOverlay', on: !store.getState().view.infoOverlay });
});
store.subscribe((state) => applyInfoButton(state.view.infoOverlay));
// プロパティパネル（S1-20）: 選択・シーン（Undo を含む）・言語が変わるたびに作り直す
const properties = createProperties({
  setContent: shell.properties.setContent,
  getState: () => store.getState(),
  getLayout: layoutOf,
  dispatch: (action) => store.dispatch(action),
});
store.subscribe(() => properties.refresh());
// 右下の軸の目印（S1-14）。球をクリックすると、その軸の側から見る
const gizmo = createAxisGizmo(shell.gizmoSlot, (v) => cameraInput.setView(v));
// コンテキストメニューの中身は S1-29。それまではテスト用に最後の要求だけ覚えておく
let lastContextRequest: ContextRequest | null = null;
cameraInput.onContextRequest((request) => {
  lastContextRequest = request;
});
// 描く前にカメラを進める
const view = {
  ...renderer,
  render() {
    cameraInput.update();
    const active = cameraInput.activeCamera();
    active.updateMatrixWorld();
    gizmo.update(active);
    const { scene, selection } = store.getState();
    const hit =
      hoverPoint === null || interactions.isDragging()
        ? null
        : renderer.pick(hoverPoint.x, hoverPoint.y);
    // マウスを乗せた候補は濃く表示する（S1-18）
    interactions.setHoveredCandidate(hit?.kind === 'candidate' ? Number(hit.id) : null);
    interactions.beforeRender();
    renderer.setHighlight({ selected: selection, hovered: selectionForPick(hit, scene) });
    // ラベルの位置は今のカメラで毎フレーム、文字と矢印は 10 Hz で書き換える（S1-23）
    infoOverlay.frame(performance.now());
    renderer.render();
  },
};

let ready = false;
installGearSim({
  isReady: () => ready,
  getScene: () => store.getState().scene,
  getLayout: () => layoutOf(store.getState().scene),
  getMotion: () => store.getState().motion,
  loadScene: (scene) => store.dispatch({ type: 'loadScene', scene }),
  dispatch: (command) => store.dispatch({ type: 'command', command }),
  undo: () => store.dispatch({ type: 'undo' }),
  redo: () => store.dispatch({ type: 'redo' }),
  projectToScreen: (world) => view.projectToScreen(world),
  getLanguage,
  setLanguage,
  getCamera: () => cameraInput.getPose(),
  setCamera: (pose) => cameraInput.setPose(pose, false),
  getLastContextRequest: () => lastContextRequest,
  getInputDevice: () => cameraInput.getInputDevice(),
  updateSettings: (patch) => store.dispatch({ type: 'updateSettings', patch }),
  setWatchMode: (on) => store.dispatch({ type: 'setWatchMode', on }),
  getGizmoTargets: () => gizmo.targets(),
  getSelection: () => {
    const { selection } = store.getState();
    return selection === null ? [] : [selection];
  },
  pick: pickAt,
  select: (id) => store.dispatch({ type: 'select', id }),
  getHandles: () =>
    interactions
      .handles()
      .map((h) => ({ kind: h.kind, targetId: h.targetId, position: h.position })),
  getCandidates: () =>
    interactions.candidates().map((c, index) => ({ index, kind: c.kind, center: c.center })),
  getHand: () => store.getState().sim.hand,
  isPaused: () => store.getState().sim.paused,
  getWarningParts: () => {
    const { scene, motion } = store.getState();
    const { locked, interfering } = warningParts(scene, layoutOf(scene), motion);
    return { locked: [...locked].sort(), interfering: [...interfering].sort() };
  },
  getInfoOverlay: () => ({
    enabled: store.getState().view.infoOverlay,
    arrows: infoOverlay.arrows(),
  }),
});

startLoop({
  store,
  view,
  layoutOf,
  displayScene: () => interactions.displayScene(),
  onFrame: () => {
    ready = true;
  },
});
