import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Vec3 } from '../core/math/vec3';
import type { SceneView } from './scene-view';
import { createSceneSync } from './sync';

const BACKGROUND = 0x1e2126;
const GRID_SIZE = 400; // mm
const GRID_DIVISIONS = 40; // 10 mm 刻み

// 初期の視点（部品が 1 つも無いときの全体表示もここに戻す。S1-13）
export const INITIAL_CAMERA_POSITION: Vec3 = [40, 75, 70];
export const INITIAL_CAMERA_TARGET: Vec3 = [9, 18, 0];

export interface Renderer extends SceneView {
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  // ページ座標の点の下にあるもの: 部品に当たればその点、なければ床（y = 0）との交点、どちらも無ければ null
  pickPoint(pageX: number, pageY: number): Vec3 | null;
}

// キャンバスに描く SceneView を作る。ウィンドウの大きさに追従する。
// カメラの位置と向きは input/camera.ts が動かす
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
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
  camera.position.set(...INITIAL_CAMERA_POSITION);
  camera.lookAt(...INITIAL_CAMERA_TARGET);

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
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const floor = new Plane(new Vector3(0, 1, 0), 0);
  const floorHit = new Vector3();
  return {
    camera,
    canvas,
    pickPoint(pageX, pageY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(
        ((pageX - window.scrollX - rect.left) / rect.width) * 2 - 1,
        1 - ((pageY - window.scrollY - rect.top) / rect.height) * 2,
      );
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(objects.root, true)[0];
      if (hit !== undefined) return [hit.point.x, hit.point.y, hit.point.z];
      if (raycaster.ray.intersectPlane(floor, floorHit) === null) return null;
      return [floorHit.x, floorHit.y, floorHit.z];
    },
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
