import type { Anchor, Scene, ShaftId } from './types';

export function emptyScene(): Scene {
  return { shafts: {}, gears: {}, motors: {}, anchors: {} };
}

// シャフトを固定している固定具（S3-01）。無ければ null
export function anchorOfShaft(scene: Scene, shaftId: ShaftId): Anchor | null {
  for (const anchor of Object.values(scene.anchors)) {
    if (anchor.target.kind === 'shaft' && anchor.target.id === shaftId) return anchor;
  }
  return null;
}

// 固定されているシャフト（シーンにあるものだけ）の ID の集合（S3-01）
export function anchoredShaftIds(scene: Scene): Set<ShaftId> {
  const ids = new Set<ShaftId>();
  for (const anchor of Object.values(scene.anchors)) {
    if (anchor.target.kind === 'shaft' && scene.shafts[anchor.target.id] !== undefined) {
      ids.add(anchor.target.id);
    }
  }
  return ids;
}
