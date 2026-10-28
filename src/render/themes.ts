import {
  type AmbientLight,
  CanvasTexture,
  Color,
  type DirectionalLight,
  GridHelper,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  ShadowMaterial,
  SRGBColorSpace,
  type Texture,
  type Scene as ThreeScene,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Aabb } from '../core/layout/bounds';
import { GEAR_KIND_LIST } from '../core/scene/gear-shape';
import type { GearKind } from '../core/scene/types';
import { QUALITY_PROFILES, type Quality, type ThemeId } from '../core/theme';
import type { BaseMaterials } from './sync';

// テーマと品質（S1-24、要件 §8）。テーマごとの見た目の値と、テーマ・品質の適用
// （マテリアルの差し替え、影・解像度・環境マップの切り替え）。歯車の形状データは変えない

export interface PartLook {
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly woodGrain?: boolean; // 木目のテクスチャを貼る
}

// 歯車の材質（S2-05）。テーマと歯車の種類で決まる（GEAR_KIND_MATERIALS）
export type GearMaterialId = 'brass' | 'steel' | 'bronze' | 'lightWood' | 'darkWood';

export const GEAR_MATERIAL_LOOKS: Readonly<Record<GearMaterialId, PartLook>> = {
  brass: { color: 0xc9a24a, metalness: 1, roughness: 0.32 }, // 真鍮
  steel: { color: 0xb9bec4, metalness: 1, roughness: 0.28 }, // 鋼（銀色。シャフトより明るく磨いた面）
  bronze: { color: 0xc07840, metalness: 1, roughness: 0.36 }, // 青銅（真鍮より赤み）
  lightWood: { color: 0xb07a45, metalness: 0, roughness: 0.75, woodGrain: true }, // 明るい木
  darkWood: { color: 0x7a4a28, metalness: 0, roughness: 0.78, woodGrain: true }, // 濃い木
};

// 歯車の種類ごとの材質（S2-05）。Record<GearKind, …> なので、種類を足すと書き忘れが型で分かる
export const GEAR_KIND_MATERIALS: Readonly<
  Record<GearKind, Readonly<Record<ThemeId, GearMaterialId>>>
> = {
  spur: { brass: 'brass', wood: 'lightWood' },
  helical: { brass: 'brass', wood: 'lightWood' },
  bevel: { brass: 'brass', wood: 'lightWood' },
  crossedHelical: { brass: 'brass', wood: 'lightWood' },
  worm: { brass: 'steel', wood: 'darkWood' },
  wormWheel: { brass: 'bronze', wood: 'lightWood' },
};

export function gearLook(theme: ThemeId, kind: GearKind): PartLook {
  return GEAR_MATERIAL_LOOKS[GEAR_KIND_MATERIALS[kind][theme]];
}

export interface ThemeLook {
  // 歯車の見た目は種類ごとに gearLook（S2-05）
  readonly shaft: PartLook;
  readonly motor: PartLook;
  readonly floor: number;
  readonly gridLine: number;
  readonly gridCenterLine: number; // x = 0・z = 0 の線
  readonly background: number;
  readonly envIntensity: number; // 環境マップの強さ
  readonly sun: { readonly color: number; readonly intensity: number };
  readonly ambient: { readonly color: number; readonly intensity: number };
}

export const THEME_LOOKS: Readonly<Record<ThemeId, ThemeLook>> = {
  brass: {
    shaft: { color: 0x9aa0a6, metalness: 1, roughness: 0.25 }, // 鋼
    motor: { color: 0x2b2b2e, metalness: 0.3, roughness: 0.5 }, // 黒い塗装
    floor: 0x2a2c30,
    gridLine: 0x3a3d42,
    gridCenterLine: 0x4a4e55,
    background: 0x1d1f23,
    envIntensity: 1,
    sun: { color: 0xfff4e0, intensity: 2.2 },
    ambient: { color: 0xffffff, intensity: 0.15 },
  },
  wood: {
    shaft: { color: 0x6b4426, metalness: 0, roughness: 0.8 }, // 濃い木
    motor: { color: 0x3d4a3a, metalness: 0, roughness: 0.7 }, // 濃い緑の塗装
    floor: 0xe8dcc6,
    gridLine: 0xcdbd9f,
    gridCenterLine: 0xb9a783,
    background: 0xf3ece0,
    envIntensity: 0.4,
    sun: { color: 0xfff0d8, intensity: 2.4 },
    ambient: { color: 0xfff8ee, intensity: 0.35 },
  },
};

// 床のグリッド（y = 0 の XZ 平面）。床の面と影を受ける面はグリッドの少し下に置き、重なりのちらつきを避ける。
// 床は画面の広い範囲を覆うので、照明の計算をしない色だけの面にし、影は影だけを描く面（ShadowMaterial）で
// 重ねる（GPU の無い環境のソフトウェア描画でも重くならないように）
const GRID_SIZE = 400; // mm
const GRID_DIVISIONS = 40; // 10 mm 刻み
const FLOOR_SIZE = 4000; // mm
const FLOOR_Y = -0.2; // mm
const FLOOR_SHADOW_Y = -0.1; // mm
const FLOOR_SHADOW_OPACITY = 0.35;

// 平行光源の向き（光源のある側。真上から少し傾ける）。影のカメラと影を受ける面は、部品の範囲に合わせて
// 置き直す（fitShadows）。範囲が狭いほど影マップの解像度が上がり、影を描く画素も減る
const SUN_DIRECTION = new Vector3(100, 200, 150).normalize();
const SHADOW_MARGIN = 10; // mm。部品の範囲の外に足す
const SHADOW_DISTANCE = 100; // mm。影のカメラを、範囲の球の外からさらに離す
// 歯の面のちらつき（シャドウアクネ）を抑えるずらし
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.25; // mm
const SHADOW_RADIUS = 3; // PCF のぼかし

// 木目のテクスチャが 1 回で覆う長さ（mm）。歯車の UV は mm 単位の x・y（ExtrudeGeometry）
const WOOD_TILE_MM = 96;

// 0〜1 の決まった値の擬似乱数（スクリーンショットが毎回同じになるように）
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// 木目の明るさ（0〜1。1 が地の色）。u・v は 0〜1 で、縦横どちらも継ぎ目なく繰り返す
export function woodGrainShade(u: number, v: number): number {
  const twoPi = Math.PI * 2;
  // 年輪の筋（v の向きに 26 本。u に沿ってわずかに波打つ）
  const t = 26 * v + 0.22 * Math.sin(twoPi * (2 * u + v)) + 0.06 * Math.sin(twoPi * 5 * u);
  const ring = (0.5 + 0.5 * Math.sin(twoPi * t)) ** 4;
  // 細い繊維の線
  const fiber = 0.5 + 0.5 * Math.sin(twoPi * (180 * v + 1.5 * Math.sin(twoPi * 3 * u)));
  return 1 - 0.22 * ring - 0.06 * fiber;
}

// 木目を Canvas に描く（画像ファイルは使わない）。地は明るい生成りにし、材質の color と掛け合わせる
function drawWoodGrain(canvas: HTMLCanvasElement, size: number): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const image = ctx.createImageData(size, size);
  const { data } = image;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const shade = woodGrainShade(x / size, y / size) - 0.04 * hash(x, y);
      const i = (y * size + x) * 4;
      data[i] = 255 * shade;
      data[i + 1] = 236 * shade;
      data[i + 2] = 210 * shade;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function createWoodTexture(size: number, anisotropy: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  drawWoodGrain(canvas, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / WOOD_TILE_MM, 1 / WOOD_TILE_MM);
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = anisotropy;
  return texture;
}

// テーマに木目のテクスチャを使う部品があるか
export function usesWoodGrain(theme: ThemeId): boolean {
  const { shaft, motor } = THEME_LOOKS[theme];
  const gears = GEAR_KIND_LIST.map((kind) => gearLook(theme, kind));
  return [...gears, shaft, motor].some((part) => part.woodGrain === true);
}

// 種類ごとの歯車の基の材質。同じ材質の種類は同じ MeshStandardMaterial を共有する
function gearMaterialsOf(
  theme: ThemeId,
  woodTexture: Texture | null,
): Record<GearKind, MeshStandardMaterial> {
  const byId = new Map<GearMaterialId, MeshStandardMaterial>();
  const result = {} as Record<GearKind, MeshStandardMaterial>;
  for (const kind of GEAR_KIND_LIST) {
    const id = GEAR_KIND_MATERIALS[kind][theme];
    let material = byId.get(id);
    if (material === undefined) {
      material = materialOf(GEAR_MATERIAL_LOOKS[id], woodTexture);
      byId.set(id, material);
    }
    result[kind] = material;
  }
  return result;
}

function materialOf(look: PartLook, woodTexture: Texture | null): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: look.color,
    metalness: look.metalness,
    roughness: look.roughness,
  });
  if (look.woodGrain === true && woodTexture !== null) material.map = woodTexture;
  return material;
}

export interface ThemeTargets {
  readonly renderer: WebGLRenderer;
  readonly scene: ThreeScene;
  readonly sun: DirectionalLight;
  readonly ambient: AmbientLight;
  // 部品の基の材質を差し替える（SceneSync.setBaseMaterials。古い材質は向こうで dispose する）
  setBaseMaterials(materials: BaseMaterials): void;
  devicePixelRatio(): number;
}

export interface ThemeController {
  // テーマと品質を適用する。前と同じなら何もしない。再読み込みはしない
  apply(theme: ThemeId, quality: Quality): void;
  // 影のカメラと影を受ける面を、部品の範囲（null は部品なし）に合わせる
  fitShadows(bounds: Aabb | null): void;
  current(): { theme: ThemeId; quality: Quality };
}

// 床・グリッド・環境マップ・影・木目のテクスチャを持ち、テーマと品質に合わせて差し替える。
// 差し替えた古いもの（材質・テクスチャ・影マップ・環境マップ・グリッド）は dispose する
export function createThemeController(targets: ThemeTargets): ThemeController {
  const { renderer, scene, sun, ambient } = targets;

  const floorGeometry = new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE);
  floorGeometry.rotateX(-Math.PI / 2);
  // 床の色は背景と同じくトーンマッピングしない（テーマの色のまま見せる）
  const floorMaterial = new MeshBasicMaterial({ toneMapped: false });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.position.y = FLOOR_Y;
  scene.add(floor);
  // 影を受ける面は、影を落とす範囲（影のカメラ）だけに置く
  // 影を受ける面は、部品の影が落ちる範囲だけに置く（fitShadows で位置と大きさを決める）
  const floorShadowGeometry = new PlaneGeometry(1, 1);
  floorShadowGeometry.rotateX(-Math.PI / 2);
  const floorShadow = new Mesh(
    floorShadowGeometry,
    new ShadowMaterial({ opacity: FLOOR_SHADOW_OPACITY, depthWrite: false }),
  );
  floorShadow.position.y = FLOOR_SHADOW_Y;
  floorShadow.receiveShadow = true;
  scene.add(floorShadow);
  let grid: GridHelper | null = null;

  scene.add(sun.target);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(300); // 部品が無いときの向き（fitShadows で置き直す）
  let hasParts = false;
  sun.shadow.bias = SHADOW_BIAS;
  sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
  sun.shadow.radius = SHADOW_RADIUS;

  let applied: { theme: ThemeId; quality: Quality } | null = null;
  let envTarget: WebGLRenderTarget | null = null;
  let envSize = 0;
  let woodTexture: CanvasTexture | null = null;
  let woodKey = '';

  function applyEnvironment(size: number): void {
    if (envTarget !== null && envSize === size) return;
    // 画像ファイルを使わず、RoomEnvironment を PMREM に変換する
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const next = pmrem.fromScene(room, 0.04, 0.1, 100, { size });
    room.dispose();
    pmrem.dispose();
    envTarget?.dispose();
    envTarget = next;
    envSize = size;
    scene.environment = next.texture;
  }

  function applyShadows(enabled: boolean, mapSize: number): void {
    const resized = sun.shadow.mapSize.x !== mapSize || sun.shadow.mapSize.y !== mapSize;
    if (!enabled || resized) {
      // 影マップ（深度のテクスチャを含む）を捨てる。次に影を描くときに今の mapSize で作り直される
      sun.shadow.dispose();
      sun.shadow.map = null;
    }
    if (enabled) sun.shadow.mapSize.set(mapSize, mapSize);
    renderer.shadowMap.enabled = enabled;
    floorShadow.visible = enabled && hasParts;
    // 光源の影の有無が変わると、材質のシェーダーが影の計算の有無に合わせて作り直される
    sun.castShadow = enabled;
  }

  // 木目のテクスチャ（使うテーマのときだけ持つ）。品質で大きさが変わったら作り直す。変わったら true
  function applyWoodTexture(theme: ThemeId, size: number, anisotropy: number): boolean {
    const key = usesWoodGrain(theme) ? `${size}:${anisotropy}` : '';
    if (key === woodKey) return false;
    woodTexture?.dispose();
    woodTexture = key === '' ? null : createWoodTexture(size, anisotropy);
    woodKey = key;
    return true;
  }

  function applyStage(look: ThemeLook): void {
    scene.background = new Color(look.background);
    scene.environmentIntensity = look.envIntensity;
    floorMaterial.color.setHex(look.floor);
    if (grid !== null) {
      scene.remove(grid);
      grid.dispose();
    }
    grid = new GridHelper(GRID_SIZE, GRID_DIVISIONS, look.gridCenterLine, look.gridLine);
    scene.add(grid);
    sun.color.setHex(look.sun.color);
    sun.intensity = look.sun.intensity;
    ambient.color.setHex(look.ambient.color);
    ambient.intensity = look.ambient.intensity;
  }

  function fitShadows(bounds: Aabb | null): void {
    hasParts = bounds !== null;
    floorShadow.visible = renderer.shadowMap.enabled && hasParts;
    if (bounds === null) return;
    const { min, max } = bounds;
    const top = Math.max(max[1], 0);
    // 床に落ちる影は、高さ h の点で光と反対の向きに h × (水平 / 垂直) だけずれる
    const slant = Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.z) / SUN_DIRECTION.y;
    const reach = top * slant + SHADOW_MARGIN;
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const half = Math.max(max[0] - min[0], max[2] - min[2]) / 2 + reach;
    floorShadow.position.set(cx, FLOOR_SHADOW_Y, cz);
    floorShadow.scale.set(half * 2, 1, half * 2);
    // 影のカメラは、影を受ける面と部品をすべて含む球を写す
    const center = new Vector3(cx, top / 2, cz);
    const radius = Math.hypot(half, half, top / 2) + SHADOW_MARGIN;
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius + SHADOW_DISTANCE);
    const camera = sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = SHADOW_DISTANCE / 2;
    camera.far = SHADOW_DISTANCE + radius * 2;
    camera.updateProjectionMatrix();
  }

  return {
    fitShadows,
    apply(theme, quality) {
      if (applied !== null && applied.theme === theme && applied.quality === quality) return;
      const profile = QUALITY_PROFILES[quality];
      const look = THEME_LOOKS[theme];
      renderer.setPixelRatio(Math.min(targets.devicePixelRatio(), profile.pixelRatioCap));
      applyShadows(profile.shadows, profile.shadowMapSize);
      applyEnvironment(profile.envMapSize);
      const woodChanged = applyWoodTexture(theme, profile.woodTextureSize, profile.anisotropy);
      if (applied === null || applied.theme !== theme || woodChanged) {
        targets.setBaseMaterials({
          gear: gearMaterialsOf(theme, woodTexture),
          shaft: materialOf(look.shaft, woodTexture),
          motor: materialOf(look.motor, woodTexture),
        });
      }
      if (applied === null || applied.theme !== theme) applyStage(look);
      applied = { theme, quality };
    },
    current() {
      if (applied === null) throw new Error('テーマがまだ適用されていない');
      return applied;
    },
  };
}
