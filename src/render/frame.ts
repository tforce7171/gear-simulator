import { Matrix4, type Object3D, Vector3 } from 'three';
import { axisFrame } from '../core/math/axis';
import type { Vec3 } from '../core/math/vec3';
import type { Axis } from '../core/scene/types';

const basis = new Matrix4();

function vec(v: Vec3): Vector3 {
  return new Vector3(v[0], v[1], v[2]);
}

// ローカルの x・y・z を軸の基底 u・v・w に合わせ、position に置く（design.md §2）
export function placeOnAxis(object: Object3D, position: Vec3, axis: Axis): void {
  const { u, v, w } = axisFrame(axis);
  basis.makeBasis(vec(u), vec(v), vec(w));
  object.quaternion.setFromRotationMatrix(basis);
  object.position.set(position[0], position[1], position[2]);
}
