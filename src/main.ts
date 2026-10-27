import { demoScene } from './app/demo-scene';
import { getLanguage, onLanguageChange, setLanguage, t } from './app/i18n';
import { createInteractions } from './app/interactions';
import { startLoop } from './app/loop';
import { selectionForPick } from './app/selection';
import { createLayoutMemo, createStore } from './app/store';
import { boundsOf } from './core/layout/bounds';
import { resolveLayout } from './core/layout/resolve';
import { installGearSim } from './debug/gear-sim';
import { type ContextRequest, createCameraInput } from './input/camera';
import { createKeyboard } from './input/keyboard';
import { createSelectionInput } from './input/selection-input';
import { createAxisGizmo } from './render/axis-gizmo';
import {
  createRenderer,
  INITIAL_CAMERA_POSITION,
  INITIAL_CAMERA_TARGET,
  ORTHO_FRUSTUM_HEIGHT,
} from './render/renderer';
import { createPalette } from './ui/palette';
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
// シャフトの本体なら付け直しのドラッグ（S1-19）。S1-21 の手で回すも、ここから始める
cameraInput.onAppPointerDown((e) => {
  const hit = pickAt(e.pageX, e.pageY);
  if (hit?.kind === 'handle') {
    interactions.beginHandleDrag(e, hit.id);
    return;
  }
  interactions.pressBody(e, bodyAt(e.pageX, e.pageY));
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
// Esc: ドラッグ中ならやめて元に戻す（S1-17）。それ以外は選択を外す
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
