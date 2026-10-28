import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { MotionState } from '../../src/core/kinematics/types';
import type { Layout } from '../../src/core/layout/types';
import type { Vec3 } from '../../src/core/math/vec3';
import type { Scene } from '../../src/core/scene/types';
import type { GearSimDebug } from '../../src/debug/gear-sim';
import type { CameraPose } from '../../src/input/camera';
import { expect } from './test';

// 通しテスト（e2e/flows）と見た目の確認（e2e/visual）で共有する操作と、__gearSim の読み出し（S1-31）

export type Point = { x: number; y: number };
export type Candidate = ReturnType<GearSimDebug['getCandidates']>[number];
export type Handle = ReturnType<GearSimDebug['getHandles']>[number];

export const EMPTY: Scene = { shafts: {}, gears: {}, motors: {} };

/** e2e/fixtures/<name>.json のシーン（SaveFile ではなく Scene の形のもの） */
export function fixtureScene(name: string): Scene {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8')) as Scene;
}

export function fixturePath(name: string): string {
  return new URL(`./${name}.json`, import.meta.url).pathname;
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
}

/** 開いて、最初のフレームを待つ。scene を渡すと読み込み、camera を渡すとその視点にする */
export async function openApp(
  page: Page,
  options: { scene?: Scene; camera?: Pick<CameraPose, 'position' | 'target'> } = {},
): Promise<void> {
  await page.goto('/');
  await waitReady(page);
  if (options.scene !== undefined) await loadScene(page, options.scene);
  if (options.camera !== undefined) await setCamera(page, options.camera);
}

export async function loadScene(page: Page, scene: Scene): Promise<void> {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), scene);
}

export async function setCamera(
  page: Page,
  pose: Pick<CameraPose, 'position' | 'target'>,
): Promise<void> {
  await page.evaluate((p) => window.__gearSim?.setCamera(p), pose);
}

// 引数の無い __gearSim の読み出しを呼ぶ（無ければ例外）
type Getter = {
  [K in keyof GearSimDebug]: GearSimDebug[K] extends () => unknown ? K : never;
}[keyof GearSimDebug];

async function read<K extends Getter>(page: Page, name: K): Promise<ReturnType<GearSimDebug[K]>> {
  const result = await page.evaluate((n) => {
    const sim = window.__gearSim;
    return sim === undefined ? null : { value: (sim[n] as () => unknown)() };
  }, name);
  if (result === null) throw new Error('__gearSim が無い');
  return result.value as ReturnType<GearSimDebug[K]>;
}

export const getScene = (page: Page): Promise<Scene> => read(page, 'getScene');
export const getLayout = (page: Page): Promise<Layout> => read(page, 'getLayout');
export const getMotion = (page: Page): Promise<MotionState> => read(page, 'getMotion');
export const getSelection = (page: Page): Promise<string[]> => read(page, 'getSelection');
export const getCandidates = (page: Page): Promise<Candidate[]> => read(page, 'getCandidates');
export const getHandles = (page: Page): Promise<Handle[]> => read(page, 'getHandles');
export const isPaused = (page: Page): Promise<boolean> => read(page, 'isPaused');

export async function project(page: Page, world: Vec3): Promise<Point> {
  const point = await page.evaluate((w) => window.__gearSim?.projectToScreen(w), world);
  if (point === undefined) throw new Error('__gearSim が無い');
  return point;
}

export function centerOf(layout: Layout, gearId: string): Vec3 {
  const center = layout.gears[gearId]?.center;
  if (center === undefined) throw new Error(`${gearId} がレイアウトに無い`);
  return center;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 描画領域の内側（端から margin px）か */
async function insideCanvas(page: Page, p: Point, margin = 10): Promise<boolean> {
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('canvas が無い');
  return (
    p.x > box.x + margin &&
    p.x < box.x + box.width - margin &&
    p.y > box.y + margin &&
    p.y < box.y + box.height - margin
  );
}

/**
 * 歯車 gearId の本体の上で、pick がその歯車を返す画面上の点。中心から始めて、ピッチ円の半分の
 * 半径の 8 方向を順に試す（ハンドルや候補の陰を避けるため）
 */
export async function gearPoint(page: Page, gearId: string): Promise<Point> {
  const layout = await getLayout(page);
  const gear = layout.gears[gearId];
  if (gear === undefined) throw new Error(`${gearId} がレイアウトに無い`);
  const [cx, cy, cz] = gear.center;
  const r = gear.pitchRadius / 2;
  const tries: Vec3[] = [gear.center];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    // 段階 1 の歯車の軸は縦（y）を前提にしない。軸に垂直な 2 方向に広げる
    const [du, dv]: [Vec3, Vec3] =
      gear.axis === 'y'
        ? [
            [0, 0, 1],
            [1, 0, 0],
          ]
        : gear.axis === 'x'
          ? [
              [0, 1, 0],
              [0, 0, 1],
            ]
          : [
              [1, 0, 0],
              [0, 1, 0],
            ];
    tries.push([
      cx + r * (Math.cos(a) * du[0] + Math.sin(a) * dv[0]),
      cy + r * (Math.cos(a) * du[1] + Math.sin(a) * dv[1]),
      cz + r * (Math.cos(a) * du[2] + Math.sin(a) * dv[2]),
    ]);
  }
  for (const world of tries) {
    const p = await project(page, world);
    if (!(await insideCanvas(page, p))) continue;
    const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
    if (hit?.kind === 'gear' && hit.id === gearId) return p;
  }
  throw new Error(`${gearId} を押せる点が無い`);
}

/** 歯車をクリックして選び、選ばれたことを確かめる */
export async function clickGear(page: Page, gearId: string): Promise<void> {
  const p = await gearPoint(page, gearId);
  await page.mouse.click(p.x, p.y);
  expect(await getSelection(page)).toEqual([gearId]);
}

/** 入力欄などのフォーカスを外す（アプリのショートカットを効かせる・Space でボタンを押さないため） */
export async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
}

/** 選択を Esc で外す */
export async function deselect(page: Page): Promise<void> {
  await blur(page);
  await page.keyboard.press('Escape');
  expect(await getSelection(page)).toEqual([]);
}

/**
 * 外周の候補のうち、仮の歯車の中心が near に最も近いものをクリックする（押す点で pick がその候補に
 * 当たることを確かめる）。生やした歯車の ID を返す
 */
export async function clickPerimeterCandidate(page: Page, near: Vec3): Promise<string> {
  const list = (await getCandidates(page)).filter((c) => c.kind === 'perimeter');
  const candidate = list.sort((a, b) => distance(a.center, near) - distance(b.center, near))[0];
  if (candidate === undefined) throw new Error('外周の候補が無い');
  expect(distance(candidate.center, near)).toBeLessThan(1e-6);
  const p = await project(page, candidate.center);
  const hit = await page.evaluate(({ x, y }) => window.__gearSim?.pick(x, y), p);
  expect(hit).toMatchObject({ kind: 'candidate', id: String(candidate.index) });
  const before = new Set(Object.keys((await getScene(page)).gears));
  await page.mouse.click(p.x, p.y);
  const added = Object.keys((await getScene(page)).gears).filter((id) => !before.has(id));
  expect(added).toHaveLength(1);
  return added[0] ?? '';
}

/** 最後に自動保存を書き終え、書いていない変更が無い */
export async function waitAutosaved(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__gearSim?.getStorageStatus();
    return s !== undefined && !s.pendingAutosave && s.lastAutosaveAt !== null;
  });
}

/** 描画のフレームを n 回待つ */
export async function nextFrames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/**
 * カメラの移動が終わるのを待つ。時間ではなく描画のフレームで数え、3 フレーム続けて位置も注視点も
 * 動かなかったら止まったとみなす（S1-29 の context-menu.spec.ts と同じ）
 */
export async function settleCamera(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const sim = window.__gearSim;
        if (sim === undefined) {
          reject(new Error('__gearSim が無い'));
          return;
        }
        const flat = (c: CameraPose) => [...c.position, ...c.target];
        let last = flat(sim.getCamera());
        let still = 0;
        const tick = () => {
          const now = flat(sim.getCamera());
          const moved = now.reduce((sum, v, i) => sum + Math.abs(v - (last[i] ?? 0)), 0);
          last = now;
          still = moved < 1e-6 ? still + 1 : 0;
          if (still >= 3) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Space の押して離すで一時停止を切り替え、on になったことを確かめる */
export async function setPaused(page: Page, on: boolean): Promise<void> {
  if ((await isPaused(page)) === on) return;
  await blur(page);
  await page.keyboard.press('Space');
  expect(await isPaused(page)).toBe(on);
}
