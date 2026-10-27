import { demoScene } from './app/demo-scene';
import { startLoop } from './app/loop';
import { createLayoutMemo, createStore } from './app/store';
import { installGearSim } from './debug/gear-sim';
import { createRenderer } from './render/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) throw new Error('canvas #app が見つからない');

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
  projectToScreen: (world) => view.projectToScreen(world),
});

startLoop({
  store,
  view,
  layoutOf,
  onFrame: () => {
    ready = true;
  },
});
