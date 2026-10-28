import { afterEach, describe, expect, it, vi } from 'vitest';
import { toSaveFile } from '../core/io/save-file';
import type { Scene } from '../core/scene/types';
import { demoScene } from './demo-scene';
import { restoreScene } from './restore';

const empty: Scene = { shafts: {}, gears: {}, motors: {}, anchors: {}, carriers: {} };

describe('restoreScene', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('自動保存があればそのシーン', async () => {
    const result = await restoreScene(async () => toSaveFile(demoScene));
    expect(result.status).toBe('restored');
    expect(result.scene).toEqual(demoScene);
  });

  it('無ければ空のシーン（none）', async () => {
    expect(await restoreScene(async () => undefined)).toEqual({ scene: empty, status: 'none' });
  });

  it('壊れていれば空のシーン（failed）で、console.warn だけ', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    const raw = { format: 'gear-simulator', version: 1, scene: { shafts: 1 } };
    expect(await restoreScene(async () => raw)).toEqual({ scene: empty, status: 'failed' });
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('読めなければ空のシーン（unavailable）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await restoreScene(async () => {
      throw new Error('no idb');
    });
    expect(result).toEqual({ scene: empty, status: 'unavailable' });
  });
});
