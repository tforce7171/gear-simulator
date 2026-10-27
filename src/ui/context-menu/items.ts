// コンテキストメニューの中身と位置（S1-29、要件 §7.1）。DOM を使わない純粋関数のみ
import type { AppState } from '../../app/store';
import type { MessageKey } from '../../core/i18n';
import type { Vec3 } from '../../core/math/vec3';
import type { MotorId, Scene, ShaftId } from '../../core/scene/types';

// 右クリックした所。部品の上なら選んだ部品（ShaftId | GearId。モーターはシャフトとして選ぶ）と、
// 当たった点（「ここに寄る」の先）
export type ContextTarget = { kind: 'part'; partId: string; point: Vec3 } | { kind: 'empty' };

export type MenuAction =
  | 'delete'
  | 'attachMotor'
  | 'detachMotor'
  | 'focusHere'
  | 'frameAll'
  | 'toggleWatch'
  | 'toggleInfo';

// checked があればチェックの項目（menuitemcheckbox）。いまの状態を表す
export interface MenuItem {
  action: MenuAction;
  labelKey: MessageKey;
  checked?: boolean;
}

// モーターを付け外しする対象のシャフト。シャフトならそれ自身、歯車なら載っているシャフト。
// シーンに無い ID（モーターの ID を含む）は null
export function targetShaftId(scene: Scene, partId: string): ShaftId | null {
  if (scene.shafts[partId] !== undefined) return partId;
  return scene.gears[partId]?.shaftId ?? null;
}

// 対象のシャフトに付いているモーター。無ければ null
export function targetMotorId(scene: Scene, partId: string): MotorId | null {
  const shaftId = targetShaftId(scene, partId);
  if (shaftId === null) return null;
  return Object.values(scene.motors).find((m) => m.shaftId === shaftId)?.id ?? null;
}

function item(action: MenuAction, checked?: boolean): MenuItem {
  const labelKey: MessageKey = `contextMenu.${action}`;
  return checked === undefined ? { action, labelKey } : { action, labelKey, checked };
}

export function buildContextMenuItems(
  target: ContextTarget,
  state: Pick<AppState, 'scene' | 'view'>,
): MenuItem[] {
  if (target.kind === 'empty') {
    return [
      item('frameAll'),
      item('toggleWatch', state.view.watchMode),
      item('toggleInfo', state.view.infoOverlay),
    ];
  }
  const items = [item('delete')];
  if (targetShaftId(state.scene, target.partId) !== null) {
    items.push(
      item(targetMotorId(state.scene, target.partId) === null ? 'attachMotor' : 'detachMotor'),
    );
  }
  items.push(item('focusHere'));
  return items;
}

// 1 方向の位置: カーソルの後ろに出し、はみ出すなら前に反転し、それでも足りなければ画面の端に寄せる
function placeAxis(cursor: number, size: number, viewport: number): number {
  if (cursor + size <= viewport) return cursor;
  if (cursor - size >= 0) return cursor - size;
  return Math.max(0, Math.min(viewport - size, cursor));
}

// メニューの左上（cursor・viewport と同じ座標系。CSS ピクセル）。カーソルの右下に出し、はみ出すなら
// 左や上に反転し、それでも足りなければ画面の端に寄せる（画面より大きければ左上をそろえる）
export function placeMenu(
  cursor: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  return {
    left: placeAxis(cursor.x, menu.width, viewport.width),
    top: placeAxis(cursor.y, menu.height, viewport.height),
  };
}
