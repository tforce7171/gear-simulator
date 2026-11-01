import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { centerSquareCrop } from '../core/io/thumbnail';
import { boundsOf } from '../core/layout/bounds';
import type { Layout } from '../core/layout/types';
import type { Vec3 } from '../core/math/vec3';
import type { Quality, ThemeId } from '../core/theme';
import type { HandleSpec, Ray } from '../input/handle-drag';
import { type CandidateSpec, createCandidateView } from './candidates';
import { createGeometryCache } from './gear-geometry';
import { createHandleView, createReattachView, type ReattachRing } from './handles';
import { createInfoArrowView, type InfoArrowSpec } from './info-arrows';
import { createPicker, type PickHit, type PickKind } from './picking';
import { createRedrawDetector } from './redraw';
import type { SceneView } from './scene-view';
import { createSceneSync, type Highlight, type PreviewStyle } from './sync';
import { createThemeController } from './themes';

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
  // 情報表示の回転方向の矢印（S1-23）。空の一覧で消す
  setInfoArrows(arrows: readonly InfoArrowSpec[]): void;
  // ワールド座標の点の、canvas の左上からの位置（CSS ピクセル）。カメラの後ろ・視野の外なら
  // visible: false（S1-23 のラベル）
  projectToCanvas(world: Vec3): { x: number; y: number; visible: boolean };
  // テーマと品質を適用する（S1-24）。同じ値なら何もしない
  applyTheme(theme: ThemeId, quality: Quality): void;
  // 今の描画の状態（S1-24。__gearSim.getRenderInfo）
  renderInfo(): RenderInfo;
  // 部品の今の材質の色（S5-04。__gearSim.getPartMaterialColor。SceneSync.partMaterialColor）
  partMaterialColor(id: string): number | null;
  // 描画の負荷の数（S1-31。__gearSim.getRenderStats。scripts/perf.ts が使う）
  renderStats(): RenderStats;
  // 作品のサムネイル（S1-27）。選択とマウスの強調・候補・ハンドル・付け直しの輪・情報表示の矢印を
  // 隠して今のカメラで描き、描画バッファの中央の正方形を size×size に縮めた 2D の canvas を返す。
  // 描いた後は隠したものを元に戻す（情報表示のラベルは DOM なので画に入らない）
  captureThumbnail(size: number): HTMLCanvasElement;
}

export interface RenderInfo {
  readonly theme: ThemeId;
  readonly quality: Quality;
  readonly shadowMapEnabled: boolean;
  readonly pixelRatio: number;
  readonly textures: number; // renderer.info.memory.textures
}

export interface RenderStats {
  readonly frame: number; // renderer.info.render.frame（実際に描いた回数。影・サムネイルを含む）
  readonly calls: number; // 最後に描いたフレームの renderer.info.render.calls
  readonly triangles: number; // 同じく renderer.info.render.triangles
  readonly redrawChecks: number; // 描き直しの判定（redraw.needsRedraw）を呼んだ回数
  readonly redrawCheckMs: number; // その判定にかかった時間の合計（ms）
}

// キャンバスに描く SceneView を作る。canvas の大きさ（ResizeObserver）に追従する。
// カメラの位置と向きは input/camera.ts が動かす。テーマと品質は applyTheme で決める（S1-24。
// 最初は initial のテーマと品質）
export function createRenderer(
  canvas: HTMLCanvasElement,
  initial: { theme: ThemeId; quality: Quality },
): Renderer {
  // アンチエイリアスは作るときにしか変えられないので、品質によらず ON
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  // three r18x では PCFSoftShadowMap が無くなり PCFShadowMap（radius でぼかす）に統合された
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new ThreeScene();
  // 床・グリッド・背景・環境マップはテーマ（render/themes.ts）が置く
  const ambient = new AmbientLight(0xffffff, 0.2);
  scene.add(ambient);
  // 光源の位置と影の範囲はテーマのコントローラが部品の範囲に合わせて決める
  const sun = new DirectionalLight(0xffffff, 2);
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
  // 情報表示の矢印もピッキングの対象にしない（S1-23）
  const infoArrows = createInfoArrowView();
  scene.add(infoArrows.root);
  const picker = createPicker({ canvas, root: pickRoot, camera: () => active });
  const themes = createThemeController({
    renderer,
    scene,
    sun,
    ambient,
    setBaseMaterials: objects.setBaseMaterials,
    devicePixelRatio: () => window.devicePixelRatio,
  });
  themes.apply(initial.theme, initial.quality);
  // 影マップは部品が動いた・変わったとき（とテーマ・品質の切り替え）だけ描き直す。止まっている
  // シーンでは影の深度の描画（2048×2048）を毎フレーム繰り返さない
  renderer.shadowMap.autoUpdate = false;
  let shadowVersion = -1;
  let fittedLayout: Layout | null = null;
  let warmed = false;
  // 見た目が前のフレームと同じなら描かない（render/redraw.ts）
  const redraw = createRedrawDetector();
  let redrawChecks = 0;
  let redrawCheckMs = 0;
  // サムネイルを撮った後に戻すため、最後に受けた強調を覚えておく
  let highlight: Highlight = { selected: null, hovered: null };

  // 描画バッファとカメラの縦横比を、canvas の表示の大きさに合わせる（S1-15。パネルを除いた描画領域）
  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    redraw.invalidate(); // 描画バッファの大きさを変えると中身が消える
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
    setHighlight(next) {
      highlight = next;
      objects.setHighlight(next);
    },
    setPreviewStyle: objects.setPreviewStyle,
    setWarnings: objects.setWarnings,
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
    setInfoArrows: infoArrows.set,
    projectToCanvas(world) {
      active.updateMatrixWorld();
      projected.set(world[0], world[1], world[2]).project(active);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const visible =
        Math.abs(projected.x) <= 1 &&
        Math.abs(projected.y) <= 1 &&
        projected.z >= -1 &&
        projected.z <= 1;
      return {
        x: ((projected.x + 1) / 2) * width,
        y: ((1 - projected.y) / 2) * height,
        visible,
      };
    },
    applyTheme(theme, quality) {
      themes.apply(theme, quality);
      shadowVersion = -1;
      redraw.invalidate();
    },
    partMaterialColor: (id) => objects.partMaterialColor(id),
    renderInfo() {
      return {
        ...themes.current(),
        shadowMapEnabled: renderer.shadowMap.enabled,
        pixelRatio: renderer.getPixelRatio(),
        textures: renderer.info.memory.textures,
      };
    },
    sync(sceneData, layout) {
      objects.sync(sceneData, layout);
      if (layout === fittedLayout) return;
      fittedLayout = layout;
      themes.fitShadows(boundsOf(sceneData, layout));
    },
    update(motion, layout, timeSec) {
      objects.update(motion, layout, timeSec);
      candidates.update(motion);
    },
    renderStats() {
      return {
        frame: renderer.info.render.frame,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        redrawChecks,
        redrawCheckMs,
      };
    },
    render() {
      const version = objects.version();
      const checkStart = performance.now();
      const needed = redraw.needsRedraw(scene, active, [version, renderer.getPixelRatio()]);
      redrawCheckMs += performance.now() - checkStart;
      redrawChecks += 1;
      if (!needed) return;
      if (version !== shadowVersion) {
        renderer.shadowMap.needsUpdate = true;
        shadowVersion = version;
      }
      renderer.render(scene, active);
      if (!warmed) {
        // 最初のフレームは描き終わるまで待つ（1 画素を読み戻す）。GPU の無い環境のソフトウェア描画では、
        // 影・環境マップのシェーダーの準備がここで済み、起動直後の操作のフレームが止まらない
        warmed = true;
        const gl = renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      }
    },
    captureThumbnail(size) {
      const overlays = [candidates.root, handles.root, reattach.root, infoArrows.root];
      const visible = overlays.map((o) => o.visible);
      for (const o of overlays) o.visible = false;
      const kept = highlight;
      objects.setHighlight({ selected: null, hovered: null });
      renderer.shadowMap.needsUpdate = true;
      shadowVersion = objects.version();
      renderer.render(scene, active);
      // 描いた直後（同じタスクの中）なら、preserveDrawingBuffer なしでも描画バッファを写せる
      const out = document.createElement('canvas');
      out.width = size;
      out.height = size;
      const ctx = out.getContext('2d');
      if (ctx !== null) {
        const crop = centerSquareCrop(canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, crop.sx, crop.sy, crop.size, crop.size, 0, 0, size, size);
      }
      overlays.forEach((o, i) => {
        o.visible = visible[i] ?? true;
      });
      objects.setHighlight(kept);
      redraw.invalidate();
      return out;
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
