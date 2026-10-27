import { demoScene } from './app/demo-scene';
import { getLanguage, onLanguageChange, setLanguage, t } from './app/i18n';
import { startLoop } from './app/loop';
import { createLayoutMemo, createStore } from './app/store';
import { boundsOf } from './core/layout/bounds';
import { installGearSim } from './debug/gear-sim';
import { type ContextRequest, createCameraInput } from './input/camera';
import { createKeyboard } from './input/keyboard';
import { createRenderer, INITIAL_CAMERA_POSITION, INITIAL_CAMERA_TARGET } from './render/renderer';
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
  canvas,
  keyboard,
  boundsOf: (ids) => {
    const { scene } = store.getState();
    return boundsOf(scene, layoutOf(scene), ids);
  },
  pickPoint: renderer.pickPoint,
  initialPose: { position: INITIAL_CAMERA_POSITION, target: INITIAL_CAMERA_TARGET },
});
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
});

startLoop({
  store,
  view,
  layoutOf,
  onFrame: () => {
    ready = true;
  },
});
