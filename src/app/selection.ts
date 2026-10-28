import type { Scene } from '../core/scene/types';
import type { PickKind } from '../input/pick-priority';

// 選択の規則（S1-16）。純粋関数のみ。選べるのは歯車とシャフト（S3-03 からキャリア、S3-04 からラックも）で、選択は 1 つだけ（design.md §7）

// クリックで当たった物から、選ぶ部品の ID を決める。モーターはそのシャフトを選ぶ。
// 歯車・モーター・シャフト以外（ハンドル・候補）と、シーンに無い部品は null
export function selectionForPick(
  hit: { kind: PickKind; id: string } | null,
  scene: Scene,
): string | null {
  if (hit === null) return null;
  switch (hit.kind) {
    case 'gear':
      return scene.gears[hit.id] === undefined ? null : hit.id;
    case 'shaft':
      return scene.shafts[hit.id] === undefined ? null : hit.id;
    case 'motor':
      return scene.motors[hit.id]?.shaftId ?? null;
    case 'carrier':
      // キャリア（S3-03）はキャリアそのものを選ぶ（プロパティパネルで、そのシャフトを固定できる）
      return scene.carriers[hit.id] === undefined ? null : hit.id;
    case 'rack':
      // ラック（S3-04）はラックそのものを選ぶ（2 つ目のピニオンの候補・固定具）
      return scene.racks[hit.id] === undefined ? null : hit.id;
    case 'handle':
    case 'candidate':
      return null;
  }
}

// シーンが変わって選択中の部品が無くなったら（削除、Undo など）、選択を外す
export function pruneSelection(selection: string | null, scene: Scene): string | null {
  if (selection === null) return null;
  return scene.gears[selection] !== undefined ||
    scene.shafts[selection] !== undefined ||
    scene.carriers[selection] !== undefined ||
    scene.racks[selection] !== undefined
    ? selection
    : null;
}
