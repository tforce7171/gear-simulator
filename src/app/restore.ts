// 起動時の自動保存からの復元（S1-27、design.md §9）。最初の描画の前に呼ぶ
import { parseSaveFileObject } from '../core/io/save-file';
import { emptyScene } from '../core/scene/scene';
import type { Scene } from '../core/scene/types';

// restored: 自動保存のシーン。none: 自動保存が無い。failed: 壊れていて読めない（トーストで知らせる）。
// unavailable: IndexedDB を使えない（保存と一覧のボタンで知らせ、自動保存は止める）
export type RestoreStatus = 'restored' | 'none' | 'failed' | 'unavailable';

export async function restoreScene(
  load: () => Promise<unknown>,
): Promise<{ scene: Scene; status: RestoreStatus }> {
  let raw: unknown;
  try {
    raw = await load();
  } catch (error) {
    console.warn('IndexedDB を使えないので、自動保存を止める', error);
    return { scene: emptyScene(), status: 'unavailable' };
  }
  if (raw === undefined) return { scene: emptyScene(), status: 'none' };
  const parsed = parseSaveFileObject(raw);
  if (!parsed.ok) {
    console.warn('自動保存を復元できなかった', parsed.error);
    return { scene: emptyScene(), status: 'failed' };
  }
  return { scene: parsed.file.scene, status: 'restored' };
}
