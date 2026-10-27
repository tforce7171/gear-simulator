import { type BufferGeometry, ExtrudeGeometry, Shape, Vector2 } from 'three';
import { GEAR_SIZES } from '../core/constants';
import { spurOutline } from '../core/geometry/involute';
import { type GearKind, gearShapeKey } from '../core/geometry/shape-key';
import type { SizeKey } from '../core/scene/types';

// 2D 輪郭を、ローカルの z 方向に歯幅の分だけ押し出す。z は −faceWidth/2 〜 +faceWidth/2
// ローカルの x・y は 2D 輪郭の x・y と同じ
export function buildSpurGeometry(size: SizeKey, teeth: number): BufferGeometry {
  const { module, faceWidth } = GEAR_SIZES[size];
  const outline = spurOutline(module, teeth);
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: faceWidth,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.translate(0, 0, -faceWidth / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface GeometryCache {
  acquire(kind: GearKind, size: SizeKey, teeth: number): BufferGeometry; // 同じキーなら同じインスタンス
  release(kind: GearKind, size: SizeKey, teeth: number): void; // 使う所が 0 になったら dispose
  size(): number; // 保持しているキーの数（テスト用）
}

function buildGeometry(kind: GearKind, size: SizeKey, teeth: number): BufferGeometry {
  switch (kind) {
    case 'spur':
      return buildSpurGeometry(size, teeth);
  }
}

export function createGeometryCache(): GeometryCache {
  const entries = new Map<string, { geometry: BufferGeometry; refs: number }>();
  return {
    acquire(kind, size, teeth) {
      const key = gearShapeKey(kind, size, teeth);
      const entry = entries.get(key);
      if (entry !== undefined) {
        entry.refs++;
        return entry.geometry;
      }
      const geometry = buildGeometry(kind, size, teeth);
      entries.set(key, { geometry, refs: 1 });
      return geometry;
    },
    release(kind, size, teeth) {
      const key = gearShapeKey(kind, size, teeth);
      const entry = entries.get(key);
      if (entry === undefined) return; // 持っていないキーは何もしない
      entry.refs--;
      if (entry.refs <= 0) {
        entries.delete(key);
        entry.geometry.dispose();
      }
    },
    size() {
      return entries.size;
    },
  };
}
