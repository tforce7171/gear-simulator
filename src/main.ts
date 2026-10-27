import { demoScene } from './app/demo-scene';
import { getLanguage, onLanguageChange, setLanguage, t } from './app/i18n';
import { startLoop } from './app/loop';
import { createLayoutMemo, createStore } from './app/store';
import { installGearSim } from './debug/gear-sim';
import { createRenderer } from './render/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) throw new Error('canvas #app が見つからない');

// タブの題名と <html lang> を現在の言語に合わせる（design.md §8）
function applyLanguage(): void {
  document.title = t('app.title');
  document.documentElement.lang = getLanguage();
}
applyLanguage();
onLanguageChange(applyLanguage);

const store = createStore(demoScene);
const layoutOf = createLayoutMemo();
const view = createRenderer(canvas);

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
});

startLoop({
  store,
  view,
  layoutOf,
  onFrame: () => {
    ready = true;
  },
});
