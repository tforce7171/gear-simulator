import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene as ThreeScene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { SceneView } from './scene-view';
import { createSceneSync } from './sync';

const BACKGROUND = 0x1e2126;
const GRID_SIZE = 400; // mm
const GRID_DIVISIONS = 40; // 10 mm 刻み

// 固定のカメラ（S1-13 で操作できるようにする）。全体が入る位置から原点付近を見る
const CAMERA_POSITION = [40, 75, 70] as const;
const CAMERA_TARGET = [9, 18, 0] as const;

// キャンバスに描く SceneView を作る。ウィンドウの大きさに追従する
export function createRenderer(canvas: HTMLCanvasElement): SceneView {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  const scene = new ThreeScene();
  scene.background = new Color(BACKGROUND);
  // 床のグリッド（y = 0 の XZ 平面）
  scene.add(new GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x8a9099, 0x4a4f57));
  scene.add(new AmbientLight(0xffffff, 0.6));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(100, 200, 150);
  scene.add(sun);

  const camera = new PerspectiveCamera(45, 1, 1, 5000);
  camera.position.set(...CAMERA_POSITION);
  camera.lookAt(...CAMERA_TARGET);

  const objects = createSceneSync();
  scene.add(objects.root);

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const projected = new Vector3();
  return {
    sync: objects.sync,
    update: objects.update,
    render() {
      renderer.render(scene, camera);
    },
    projectToScreen(world) {
      projected.set(world[0], world[1], world[2]).project(camera);
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + window.scrollX + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + window.scrollY + ((1 - projected.y) / 2) * rect.height,
      };
    },
  };
}
