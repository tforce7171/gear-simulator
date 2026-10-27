// 決まった方向からの視点と、平行投影の大きさ（S1-14）。純粋関数のみ
import type { Vec3 } from '../core/math/vec3';

export type ViewName = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

// テンキー 1/3/7 と Ctrl（Mac の Cmd）での反対側。キーは event.code で判定する
export function viewFromKey(code: string, ctrlOrMeta: boolean): ViewName | null {
  switch (code) {
    case 'Numpad1':
      return ctrlOrMeta ? 'back' : 'front';
    case 'Numpad3':
      return ctrlOrMeta ? 'left' : 'right';
    case 'Numpad7':
      return ctrlOrMeta ? 'bottom' : 'top';
    default:
      return null;
  }
}

// 注視点からカメラへの向き（単位ベクトル）と、画面の上の向き
const VIEW_AXES: Readonly<Record<ViewName, { dir: Vec3; up: Vec3 }>> = {
  front: { dir: [0, 0, 1], up: [0, 1, 0] },
  back: { dir: [0, 0, -1], up: [0, 1, 0] },
  right: { dir: [1, 0, 0], up: [0, 1, 0] },
  left: { dir: [-1, 0, 0], up: [0, 1, 0] },
  top: { dir: [0, 1, 0], up: [0, 0, -1] },
  bottom: { dir: [0, -1, 0], up: [0, 0, 1] },
};

// 注視点・距離を保ったカメラの位置と、画面の上の向き
export function poseForView(
  target: Vec3,
  distance: number,
  view: ViewName,
): { position: Vec3; up: Vec3 } {
  const { dir, up } = VIEW_AXES[view];
  return {
    position: [
      target[0] + dir[0] * distance,
      target[1] + dir[1] * distance,
      target[2] + dir[2] * distance,
    ],
    up,
  };
}

// 方位角（Y 軸まわり。+Z が 0、+X が π/2）と極角（+Y から測る）で表した視点の向き。
// camera-controls の球座標と同じ取り方。上・下は極角 0・π で、方位角 0（画面の上が −Z／+Z）
export function anglesForView(view: ViewName): { azimuth: number; polar: number } {
  switch (view) {
    case 'front':
      return { azimuth: 0, polar: Math.PI / 2 };
    case 'back':
      return { azimuth: Math.PI, polar: Math.PI / 2 };
    case 'right':
      return { azimuth: Math.PI / 2, polar: Math.PI / 2 };
    case 'left':
      return { azimuth: -Math.PI / 2, polar: Math.PI / 2 };
    case 'top':
      return { azimuth: 0, polar: 0 };
    case 'bottom':
      return { azimuth: 0, polar: Math.PI };
  }
}

// 今の方位角 from から、to と同じ向き（2π の整数倍の違い）のうち最も近い値（遠回りに回らないように）
export function nearestAngle(from: number, to: number): number {
  return to + 2 * Math.PI * Math.round((from - to) / (2 * Math.PI));
}

// 縦の視野角 fovY（rad）の透視カメラで、注視点まで distance のときに見える縦の幅（平行投影の高さ）
export function orthoHeightForDistance(distance: number, fovY: number): number {
  return 2 * distance * Math.tan(fovY / 2);
}

// orthoHeightForDistance の逆
export function distanceForOrthoHeight(height: number, fovY: number): number {
  return height / (2 * Math.tan(fovY / 2));
}
