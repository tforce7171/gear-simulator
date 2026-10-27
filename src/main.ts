// 仮の画面。S1-04 で描画の層（src/render/）に移す
import { Color, GridHelper, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { installGearSim } from './debug/gear-sim';

const BACKGROUND = 0x1e2126;
const GRID_SIZE = 400; // mm
const GRID_DIVISIONS = 40; // 10 mm 刻み

const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) throw new Error('canvas #app が見つからない');

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new Scene();
scene.background = new Color(BACKGROUND);
// 床のグリッド（y = 0 の XZ 平面）
scene.add(new GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x8a9099, 0x4a4f57));

const camera = new PerspectiveCamera(45, 1, 1, 5000);
camera.position.set(180, 160, 240);
camera.lookAt(0, 0, 0);

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let ready = false;
installGearSim({ isReady: () => ready });

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  ready = true;
});
