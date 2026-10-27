import type { Camera, Material, Mesh, Object3D } from 'three';

// 描き直しが要るかの判定（S1-24）。PBR・環境マップ・影で 1 フレームの描画が重くなったので、
// 見た目が前のフレームと変わらないときは描かない（GPU の無い環境のソフトウェア描画や、
// ノート PC の電池のため）。WebGL の canvas は描かなければ前のフレームの絵を出し続ける。
//
// 前のフレームと比べるもの: 描くオブジェクトの並び・見えるか・ワールド行列・材質（参照と version）、
// カメラの行列と投影、描画バッファの大きさ、呼び出し側が渡す数（部品の材質の発光などの版）。
// 材質の色などを直接書き換える変更（テーマの切り替えなど）は、呼び出し側が invalidate する

export interface RedrawDetector {
  // 今のフレームを描く必要があるか。呼ぶたびに今の状態を覚える
  needsRedraw(root: Object3D, camera: Camera, extra: readonly number[]): boolean;
  // 次のフレームを必ず描かせる
  invalidate(): void;
}

// 材質を見分ける番号（three の型に Material.id が無いので、ここで振る）
const materialIds = new WeakMap<Material, number>();
let nextMaterialId = 1;

function materialId(material: Material): number {
  let id = materialIds.get(material);
  if (id === undefined) {
    id = nextMaterialId++;
    materialIds.set(material, id);
  }
  return id;
}

function pushMaterial(out: number[], material: Material | Material[] | undefined): void {
  if (material === undefined) return;
  if (Array.isArray(material)) {
    for (const m of material) pushMaterial(out, m);
    return;
  }
  out.push(materialId(material), material.version, material.visible ? 1 : 0);
}

export function createRedrawDetector(): RedrawDetector {
  let previous: number[] = [];
  let current: number[] = [];
  let forced = true;

  function collect(object: Object3D, out: number[]): void {
    out.push(object.id, object.visible ? 1 : 0, object.children.length);
    if (!object.visible) return;
    for (const e of object.matrixWorld.elements) out.push(e);
    pushMaterial(out, (object as Partial<Mesh>).material);
    for (const child of object.children) collect(child, out);
  }

  return {
    needsRedraw(root, camera, extra) {
      current.length = 0;
      root.updateMatrixWorld();
      camera.updateMatrixWorld();
      collect(root, current);
      current.push(camera.id);
      for (const e of camera.matrixWorld.elements) current.push(e);
      for (const e of camera.projectionMatrix.elements) current.push(e);
      for (const v of extra) current.push(v);
      let changed = forced || current.length !== previous.length;
      for (let i = 0; !changed && i < current.length; i++) {
        if (current[i] !== previous[i]) changed = true;
      }
      forced = false;
      [previous, current] = [current, previous];
      return changed;
    },
    invalidate() {
      forced = true;
    },
  };
}
