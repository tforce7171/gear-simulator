import { demoScene } from './app/demo-scene';
import { getLanguage, onLanguageChange, setLanguage, t } from './app/i18n';
import { startLoop } from './app/loop';
import { selectionForPick } from './app/selection';
import { createLayoutMemo, createStore } from './app/store';
import { boundsOf } from './core/layout/bounds';
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
// ピッキング（S1-16）。描く前（loadScene や編集の直後）でも今のシーンで当てるように、先に同期する
const pickAt = (x: number, y: number) => {
  const { scene } = store.getState();
  renderer.sync(scene, layoutOf(scene));
  return renderer.pick(x, y);
};
// 部品（ハンドル・候補を含む）の上の左ボタンはカメラを回さない
cameraInput.setHitTest((x, y) => pickAt(x, y) !== null);

// 選択（S1-16）。左クリックで当たった部品を選び（モーターはそのシャフト）、何もない所なら外す
const selectAt = (x: number, y: number): void => {
  const { scene } = store.getState();
  store.dispatch({ type: 'select', id: selectionForPick(pickAt(x, y), scene) });
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
const unselect = (): void => store.dispatch({ type: 'select', id: null });
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
    const hovered =
      hoverPoint === null
        ? null
        : selectionForPick(renderer.pick(hoverPoint.x, hoverPoint.y), scene);
    renderer.setHighlight({ selected: selection, hovered });
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
});

startLoop({
  store,
  view,
  layoutOf,
  onFrame: () => {
    ready = true;
  },
});
