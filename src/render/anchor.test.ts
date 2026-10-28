import { readFileSync } from 'node:fs';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../core/edit/commands';
import { resolveLayout } from '../core/layout/resolve';
import type { ShaftLayout } from '../core/layout/types';
import { createSequentialIdGenerator } from '../core/scene/ids';
import type { Scene } from '../core/scene/types';
import {
  ANCHOR_BASE_SIZE,
  ANCHOR_BASE_THICKNESS,
  ANCHOR_FLOOR_Y,
  ANCHOR_FOOT_THICKNESS,
  anchorFrame,
} from './anchor';
import { createSceneSync, MOTOR_BOX } from './sync';

// S3-01: 固定具の見た目の配置

const DIGITS = 10;

describe('anchorFrame', () => {
  const vertical: ShaftLayout = { origin: [0, 35, 0], axis: 'y', span: [-4, 12] };

  it('縦のシャフト: 台座はシャフトの負の端（下）のすぐ外、支柱は台座の下から床まで', () => {
    const frame = anchorFrame(vertical, null, 1);
    const centerY = 35 - 4 - ANCHOR_BASE_THICKNESS / 2;
    expect(frame.baseCenter).toEqual([0, centerY, 0]);
    expect(frame.pillar).toEqual({
      top: [0, centerY - ANCHOR_BASE_THICKNESS / 2, 0],
      bottom: [0, ANCHOR_FLOOR_Y, 0],
    });
  });

  it('モーターがあれば、台座はモーターの箱のさらに外', () => {
    const frame = anchorFrame(vertical, 8, 1);
    expect(frame.baseCenter[1]).toBeCloseTo(35 - 4 - 1 - 8 - 1 - ANCHOR_BASE_THICKNESS / 2, DIGITS);
  });

  it('横のシャフト（x）: 台座は負の端（−x）の外に立ち、支柱は台座の下の辺から床まで', () => {
    const frame = anchorFrame({ origin: [10, 40, 5], axis: 'x', span: [-6, 20] }, null, 1);
    const centerX = 10 - 6 - ANCHOR_BASE_THICKNESS / 2;
    expect(frame.baseCenter).toEqual([centerX, 40, 5]);
    expect(frame.pillar).toEqual({
      top: [centerX, 40 - ANCHOR_BASE_SIZE / 2, 5],
      bottom: [centerX, ANCHOR_FLOOR_Y, 5],
    });
  });

  it('台座が床より上に無ければ支柱は無い', () => {
    const low = anchorFrame({ origin: [0, 4, 0], axis: 'z', span: [-4, 12] }, null, 1);
    expect(low.pillar).toBeNull();
  });
});

describe('SceneSync の固定具', () => {
  const pair = JSON.parse(
    readFileSync(new URL('../../e2e/fixtures/anchor-pair.json', import.meta.url), 'utf8'),
  ) as Scene;
  const anchorB = (): Scene => {
    const result = applyCommand(
      pair,
      { type: 'addAnchor', shaftId: 'shaft_b' },
      { ids: createSequentialIdGenerator() },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.scene;
  };

  function anchorGroup(root: Object3D, anchorId: string): Object3D | undefined {
    return root.children.find((o) => o.userData.anchorId === anchorId);
  }

  it('固定したシャフトに台座・支柱・足を描き、外すと消える', () => {
    const sync = createSceneSync();
    const scene = anchorB();
    const layout = resolveLayout(scene);
    sync.sync(scene, layout);
    expect(sync.anchorCount()).toBe(1);
    const group = anchorGroup(sync.root, 'anchor_1');
    expect(group?.children).toHaveLength(3);
    const [base, pillar, foot] = (group?.children ?? []) as Mesh[];
    const shaft = layout.shafts.shaft_b;
    if (shaft === undefined || base === undefined || pillar === undefined || foot === undefined) {
      throw new Error('部品が無い');
    }
    const expected = anchorFrame(shaft, null, 1);
    expect(base.position.toArray()).toEqual(expected.baseCenter);
    const top = expected.pillar?.top[1] ?? 0;
    expect(pillar.scale.y).toBeCloseTo(top - ANCHOR_FLOOR_Y, DIGITS);
    expect(foot.position.y).toBeCloseTo(ANCHOR_FLOOR_Y + ANCHOR_FOOT_THICKNESS / 2, DIGITS);

    sync.sync(pair, resolveLayout(pair));
    expect(sync.anchorCount()).toBe(0);
    expect(anchorGroup(sync.root, 'anchor_1')).toBeUndefined();
  });

  it('モーターのあるシャフトでは、台座をモーターの箱の外に置く', () => {
    const result = applyCommand(
      pair,
      { type: 'addAnchor', shaftId: 'shaft_a' },
      { ids: createSequentialIdGenerator() },
    );
    if (!result.ok) throw new Error(result.error.message);
    const layout = resolveLayout(result.scene);
    const sync = createSceneSync();
    sync.sync(result.scene, layout);
    const base = anchorGroup(sync.root, 'anchor_1')?.children[0];
    const shaft = layout.shafts.shaft_a;
    if (shaft === undefined || base === undefined) throw new Error('部品が無い');
    expect(base.position.toArray()).toEqual(anchorFrame(shaft, MOTOR_BOX.M, 1).baseCenter);
  });

  it('固定したシャフトがロックしていれば、固定具もロックの材質（発光が赤）', () => {
    const sync = createSceneSync();
    const scene = anchorB();
    sync.sync(scene, resolveLayout(scene));
    const base = anchorGroup(sync.root, 'anchor_1')?.children[0] as Mesh | undefined;
    if (base === undefined) throw new Error('台座が無い');
    const normal = (base.material as MeshStandardMaterial).emissive.getHex();
    sync.setWarnings({ locked: new Set(['shaft_b']), interfering: new Set() });
    const locked = base.material as MeshStandardMaterial;
    expect(locked.emissive.getHex()).not.toBe(normal);
    expect(locked.emissive.getHex()).toBe(0xff2a1a);
  });
});
