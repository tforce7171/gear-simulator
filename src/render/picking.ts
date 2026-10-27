import { type Camera, type Object3D, Raycaster, Vector2 } from 'three';
import type { Vec3 } from '../core/math/vec3';
import { choosePick, type PickKind } from '../input/pick-priority';

// レイキャストによるピッキング（S1-16）。render が作る Object3D の userData に
// { pickKind, pickId } を入れておき、当たった物から親をたどってそれを探す

export type { PickKind } from '../input/pick-priority';

export interface PickHit {
  kind: PickKind;
  id: string;
  point: Vec3; // 当たった点（ワールド座標）
}

interface PickUserData {
  pickKind?: PickKind;
  pickId?: string;
}

// object とその子孫に当たったら、kind・id の部品に当たったとみなす
export function setPickTarget(object: Object3D, kind: PickKind, id: string): void {
  const data = object.userData as PickUserData;
  data.pickKind = kind;
  data.pickId = id;
}

function pickTargetOf(object: Object3D): { kind: PickKind; id: string } | null {
  for (let o: Object3D | null = object; o !== null; o = o.parent) {
    const data = o.userData as PickUserData;
    if (data.pickKind !== undefined && data.pickId !== undefined) {
      return { kind: data.pickKind, id: data.pickId };
    }
  }
  return null;
}

export interface Picker {
  // 画面座標（CSS ピクセル、canvas 基準でなくページ基準）の下の部品。優先順位は choosePick。
  // kinds を渡すと、その種類だけを調べる（S1-19: 候補の陰の部品の本体を調べる）
  pick(pageX: number, pageY: number, kinds?: readonly PickKind[]): PickHit | null;
}

export interface PickerDeps {
  readonly canvas: HTMLCanvasElement;
  readonly root: Object3D; // この下の物だけを調べる
  readonly camera: () => Camera; // Renderer.activeCamera（透視投影か平行投影か）
}

export function createPicker(deps: PickerDeps): Picker {
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  return {
    pick(pageX, pageY, kinds) {
      const rect = deps.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(
        ((pageX - window.scrollX - rect.left) / rect.width) * 2 - 1,
        1 - ((pageY - window.scrollY - rect.top) / rect.height) * 2,
      );
      const camera = deps.camera();
      camera.updateMatrixWorld();
      // 描く前（sync の直後など）でも今の位置で当てる
      deps.root.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      const hits: Array<{ kind: PickKind; id: string; distance: number; point: Vec3 }> = [];
      for (const hit of raycaster.intersectObject(deps.root, true)) {
        const target = pickTargetOf(hit.object);
        if (target === null || (kinds !== undefined && !kinds.includes(target.kind))) continue;
        hits.push({
          ...target,
          distance: hit.distance,
          point: [hit.point.x, hit.point.y, hit.point.z],
        });
      }
      const chosen = choosePick(hits);
      if (chosen === null) return null;
      // 選んだ部品の中で最も手前の点（intersectObject の結果は距離順）
      const first = hits.find((h) => h.kind === chosen.kind && h.id === chosen.id);
      return first === undefined ? null : { kind: chosen.kind, id: chosen.id, point: first.point };
    },
  };
}
