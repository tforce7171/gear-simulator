// 範囲を画面に収めるカメラの距離（S1-13）。純粋関数のみ

// 全体表示で、球のまわりに残す余白の倍率
export const FIT_MARGIN = 1.15;

// 半径 radius の球が、縦の視野角 fovY（rad）・縦横比 aspect（幅 / 高さ）の透視カメラに、
// 余白 margin 込みで収まる、球の中心からカメラまでの距離。縦と横の狭いほうの視野で決まる
export function fitDistance(
  radius: number,
  fovY: number,
  aspect: number,
  margin: number = FIT_MARGIN,
): number {
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  const fov = Math.min(fovY, fovX);
  return (Math.max(radius, 0) * margin) / Math.sin(fov / 2);
}
