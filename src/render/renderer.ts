import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Vec3 } from '../core/math/vec3';
import type { HandleSpec, Ray } from '../input/handle-drag';
import { type CandidateSpec, createCandidateView } from './candidates';
import { createGeometryCache } from './gear-geometry';
import { createHandleView, createReattachView, type ReattachRing } from './handles';
import { createPicker, type PickHit, type PickKind } from './picking';
import type { SceneView } from './scene-view';
import { createSceneSync, type Highlight, type PreviewStyle } from './sync';

const BACKGROUND = 0x1e2126;
const GRID_SIZE = 400; // mm
const GRID_DIVISIONS = 40; // 10 mm 刻み

// 初期の視点（部品が 1 つも無いときの全体表示もここに戻す。S1-13）
export const INITIAL_CAMERA_POSITION: Vec3 = [40, 75, 70];
export const INITIAL_CAMERA_TARGET: Vec3 = [9, 18, 0];

// 平行投影のカメラの視錐台の縦の幅（zoom 1 のとき。見える高さ = ORTHO_FRUSTUM_HEIGHT / zoom。S1-14）
export const ORTHO_FRUSTUM_HEIGHT = 100;
// 平行投影は注視点の手前の部品も写すように、near をカメラの後ろまで広げる
const ORTHO_NEAR = -5000;
const ORTHO_FAR = 10000;

export type Projection = 'perspective' | 'orthographic';

export interface Renderer extends SceneView {
  readonly camera: PerspectiveCamera; // 透視投影のカメラ
  readonly orthoCamera: OrthographicCamera; // 平行投影のカメラ（S1-14）
  // 描く・写す・ピッキングに使うカメラを切り替える（S1-14）
  setProjection(projection: Projection): void;
  activeCamera(): PerspectiveCamera | OrthographicCamera;
  readonly canvas: HTMLCanvasElement;
  // ページ座標の点の下にあるもの: 部品に当たればその点、なければ床（y = 0）との交点、どちらも無ければ null
  pickPoint(pageX: number, pageY: number): Vec3 | null;
  // ページ座標の点の下の部品（優先順位つき。S1-16）。activeCamera() でレイを飛ばす。
  // kinds を渡すと、その種類だけを調べる（S1-19）
  pick(pageX: number, pageY: number, kinds?: readonly PickKind[]): PickHit | null;
  // ピッキングの対象を入れる Group。ハンドル（S1-17・S1-19）・候補（S1-18）もここに足す
  readonly pickRoot: Group;
  // 選択とマウスを乗せた部品のハイライト（S1-16）
  setHighlight(highlight: Highlight): void;
  // 編集中の仮の部品の見た目（半透明・赤。S1-17）。null で戻す
  setPreviewStyle(style: PreviewStyle | null): void;
  // 出すハンドルと、ドラッグ中のハンドルのピッキングの ID（S1-17）
  setHandles(handles: readonly HandleSpec[], activeId: string | null): void;
  // 出す生やす候補と、マウスを乗せた候補の番号（S1-18）。同じ一覧の参照なら作り直さない
  setCandidates(candidates: readonly CandidateSpec[], hovered: number | null): void;
  // 付け直しのドラッグ（S1-19）の候補の輪と、強調する輪の番号。空の一覧で消す
  setReattachRings(rings: readonly ReattachRing[], highlighted: number | null): void;
  // ページ座標の点を通る、activeCamera() からのレイ（向きは単位ベクトル）。canvas が大きさ 0 なら null
  rayAt(pageX: number, pageY: number): Ray | null;
}

// キャンバスに描く SceneView を作る。canvas の大きさ（ResizeObserver）に追従する。
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
  const half = ORTHO_FRUSTUM_HEIGHT / 2;
  const orthoCamera = new OrthographicCamera(-half, half, half, -half, ORTHO_NEAR, ORTHO_FAR);
  orthoCamera.position.copy(camera.position);
  orthoCamera.quaternion.copy(camera.quaternion);
  let active: PerspectiveCamera | OrthographicCamera = camera;

  // 歯車の形状データは本物の部品と候補（S1-18）で共有する
  const geometries = createGeometryCache();
  const objects = createSceneSync(geometries);
  const candidates = createCandidateView(geometries);
  const pickRoot = new Group();
  pickRoot.add(objects.root);
  pickRoot.add(candidates.root);
  const handles = createHandleView();
  pickRoot.add(handles.root);
  scene.add(pickRoot);
  // 付け直しの候補の輪はピッキングの対象にしない
  const reattach = createReattachView();
  scene.add(reattach.root);
  const picker = createPicker({ canvas, root: pickRoot, camera: () => active });

  // 描画バッファとカメラの縦横比を、canvas の表示の大きさに合わせる（S1-15。パネルを除いた描画領域）
  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    orthoCamera.left = (-ORTHO_FRUSTUM_HEIGHT * camera.aspect) / 2;
    orthoCamera.right = (ORTHO_FRUSTUM_HEIGHT * camera.aspect) / 2;
    orthoCamera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const projected = new Vector3();
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const floor = new Plane(new Vector3(0, 1, 0), 0);
  const floorHit = new Vector3();
  // ページ座標から active のカメラのレイを raycaster に入れる。canvas が大きさ 0 なら false
  function setRay(pageX: number, pageY: number): boolean {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    ndc.set(
      ((pageX - window.scrollX - rect.left) / rect.width) * 2 - 1,
      1 - ((pageY - window.scrollY - rect.top) / rect.height) * 2,
    );
    active.updateMatrixWorld();
    raycaster.setFromCamera(ndc, active);
    return true;
  }
  return {
    camera,
    orthoCamera,
    setProjection(projection) {
      active = projection === 'perspective' ? camera : orthoCamera;
    },
    activeCamera: () => active,
    canvas,
    pickPoint(pageX, pageY) {
      const hit = picker.pick(pageX, pageY);
      if (hit !== null) return hit.point;
      if (!setRay(pageX, pageY)) return null;
      if (raycaster.ray.intersectPlane(floor, floorHit) === null) return null;
      return [floorHit.x, floorHit.y, floorHit.z];
    },
    pick: picker.pick,
    pickRoot,
    setHighlight: objects.setHighlight,
    setPreviewStyle: objects.setPreviewStyle,
    setHandles: handles.set,
    setCandidates: candidates.set,
    setReattachRings: reattach.set,
    rayAt(pageX, pageY) {
      if (!setRay(pageX, pageY)) return null;
      const { origin, direction } = raycaster.ray;
      return {
        origin: [origin.x, origin.y, origin.z],
        direction: [direction.x, direction.y, direction.z],
      };
    },
    sync: objects.sync,
    update(motion, layout) {
      objects.update(motion, layout);
      candidates.update(motion);
    },
    render() {
      renderer.render(scene, active);
    },
    projectToScreen(world) {
      // 描く前（setCamera の直後など）でも今のカメラで写す
      active.updateMatrixWorld();
      projected.set(world[0], world[1], world[2]).project(active);
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + window.scrollX + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + window.scrollY + ((1 - projected.y) / 2) * rect.height,
      };
    },
  };
}
