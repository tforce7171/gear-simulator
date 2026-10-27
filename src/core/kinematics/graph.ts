import type { Mesh } from '../layout/types';
import type { GearId, Scene, ShaftId } from '../scene/types';
import { type Matrix, nullSpaceWithFreeColumns } from './linalg';

// かみ合いのグラフと、シャフトの角速度の拘束の零空間（design.md §6）

export interface KinematicComponent {
  readonly shaftIds: ShaftId[]; // ID の昇順
  readonly gearIds: GearId[]; // この成分のシャフトに載った歯車。ID の昇順
  readonly meshes: Mesh[]; // この成分の中のかみ合い（入力の順）
  readonly basis: Matrix; // shaftIds.length 行 × dof 列。ω = basis · q
  readonly dof: number; // 0 なら回転条件の矛盾
  readonly referenceShaftIds: ShaftId[]; // 長さ dof。basis のこの行が単位行列
}

export interface MeshGraph {
  readonly components: KinematicComponent[]; // 先頭のシャフトの ID の昇順
  readonly componentOfShaft: Readonly<Record<ShaftId, number>>; // components の添字
}

// 文字列の比較はロケールに依らない符号単位の順にする（決定的にするため）
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 1 つのかみ合いの拘束の行の係数（ω_shaft(a) と ω_shaft(b) にかかる係数）。
// 段階 2・3 で内歯車（z_a·ω_a − z_b·ω_b = 0）などを足すときはここを分ける
function meshConstraint(teethA: number, teethB: number): readonly [number, number] {
  return [teethA, teethB]; // 外歯車どうし: z_a·ω_a + z_b·ω_b = 0
}

interface ResolvedMesh {
  readonly mesh: Mesh;
  readonly shaftA: ShaftId;
  readonly shaftB: ShaftId;
  readonly coefA: number;
  readonly coefB: number;
}

function resolveMesh(scene: Scene, mesh: Mesh): ResolvedMesh {
  const a = scene.gears[mesh.a];
  const b = scene.gears[mesh.b];
  if (a === undefined || b === undefined) {
    throw new Error(`かみ合いの歯車がシーンに無い: ${mesh.a}, ${mesh.b}`);
  }
  if (scene.shafts[a.shaftId] === undefined || scene.shafts[b.shaftId] === undefined) {
    throw new Error(`かみ合いの歯車のシャフトがシーンに無い: ${mesh.a}, ${mesh.b}`);
  }
  if (a.shaftId === b.shaftId) {
    throw new Error(`同じシャフトの歯車どうしのかみ合い: ${mesh.a}, ${mesh.b}`);
  }
  const [coefA, coefB] = meshConstraint(a.teeth, b.teeth);
  return { mesh, shaftA: a.shaftId, shaftB: b.shaftId, coefA, coefB };
}

// 基準シャフトに選ぶ順: root か detached を先に、次に ID の昇順
function referencePriority(scene: Scene, shaftIds: readonly ShaftId[]): ShaftId[] {
  const preferred = (id: ShaftId): number => (scene.shafts[id]?.placement.kind === 'mesh' ? 1 : 0);
  return [...shaftIds].sort((x, y) => preferred(x) - preferred(y) || compareIds(x, y));
}

function buildComponent(
  scene: Scene,
  shaftIds: ShaftId[],
  gearIds: GearId[],
  meshes: readonly ResolvedMesh[],
): KinematicComponent {
  // 列の並びを基準シャフトの優先の逆にする。消去のピボットは左から貪欲に取られ、
  // 自由な列（＝基底の単位行列の行）は右から貪欲に取られる（行列の双対）。
  // これで「優先の順に見て、それまでに選んだ行と独立なものを取る」と同じ選び方になる
  const order = referencePriority(scene, shaftIds).reverse();
  const columnOf = new Map(order.map((id, j) => [id, j]));
  const rows: Matrix = meshes.map(({ shaftA, shaftB, coefA, coefB }) => {
    const row = new Array<number>(order.length).fill(0);
    const ja = columnOf.get(shaftA) as number;
    const jb = columnOf.get(shaftB) as number;
    row[ja] = (row[ja] as number) + coefA;
    row[jb] = (row[jb] as number) + coefB;
    return row;
  });
  const { basis: permuted, freeColumns } = nullSpaceWithFreeColumns(rows, order.length);
  // 自由な列を、優先の高い順（列の右から）に並べて q の順にする
  const freeByPriority = [...freeColumns].reverse();
  const basis: Matrix = shaftIds.map((id) => {
    const row = permuted[columnOf.get(id) as number] as number[];
    return freeByPriority.map((_, k) => row[freeColumns.length - 1 - k] as number);
  });
  return {
    shaftIds,
    gearIds,
    meshes: meshes.map((m) => m.mesh),
    basis,
    dof: freeColumns.length,
    referenceShaftIds: freeByPriority.map((j) => order[j] as ShaftId),
  };
}

export function buildMeshGraph(scene: Scene, meshes: readonly Mesh[]): MeshGraph {
  const resolved = meshes.map((mesh) => resolveMesh(scene, mesh));

  // 連結成分（Union-Find）。代表は ID の最も小さいシャフト
  const parent = new Map<ShaftId, ShaftId>();
  for (const id of Object.keys(scene.shafts)) parent.set(id, id);
  const find = (id: ShaftId): ShaftId => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) as ShaftId;
    let cur = id;
    while (cur !== root) {
      const next = parent.get(cur) as ShaftId;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const { shaftA, shaftB } of resolved) {
    const ra = find(shaftA);
    const rb = find(shaftB);
    if (ra === rb) continue;
    if (compareIds(ra, rb) < 0) parent.set(rb, ra);
    else parent.set(ra, rb);
  }

  const groups = new Map<ShaftId, ShaftId[]>();
  for (const id of Object.keys(scene.shafts).sort(compareIds)) {
    const root = find(id);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [id]);
    else group.push(id);
  }
  const roots = [...groups.keys()].sort(compareIds);
  const componentOfShaft: Record<ShaftId, number> = {};
  roots.forEach((root, index) => {
    for (const id of groups.get(root) as ShaftId[]) componentOfShaft[id] = index;
  });

  const gearsOf: GearId[][] = roots.map(() => []);
  for (const gearId of Object.keys(scene.gears).sort(compareIds)) {
    const shaftId = scene.gears[gearId]?.shaftId;
    const index = shaftId === undefined ? undefined : componentOfShaft[shaftId];
    if (index !== undefined) gearsOf[index]?.push(gearId);
  }
  const meshesOf: ResolvedMesh[][] = roots.map(() => []);
  for (const m of resolved) meshesOf[componentOfShaft[m.shaftA] as number]?.push(m);

  const components = roots.map((root, index) =>
    buildComponent(
      scene,
      groups.get(root) as ShaftId[],
      gearsOf[index] as GearId[],
      meshesOf[index] as ResolvedMesh[],
    ),
  );
  return { components, componentOfShaft };
}

// ω_to / ω_from。成分が違う、自由度が 1 でない、from の行が 0 のときは null
export function speedRatio(graph: MeshGraph, from: ShaftId, to: ShaftId): number | null {
  const index = graph.componentOfShaft[from];
  if (index === undefined || graph.componentOfShaft[to] !== index) return null;
  const component = graph.components[index];
  if (component === undefined || component.dof !== 1) return null;
  const fromRow = component.basis[component.shaftIds.indexOf(from)]?.[0];
  const toRow = component.basis[component.shaftIds.indexOf(to)]?.[0];
  if (fromRow === undefined || toRow === undefined || fromRow === 0) return null;
  return toRow / fromRow;
}
