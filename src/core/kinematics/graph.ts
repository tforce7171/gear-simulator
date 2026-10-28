import type { Mesh, RackMesh } from '../layout/types';
import {
  type GearId,
  isChildPlacement,
  type RackId,
  type Scene,
  type ShaftId,
} from '../scene/types';
import { type Matrix, nullSpaceWithFreeColumns } from './linalg';
import { meshTerms, rackMeshTerms } from './mesh-coefficients';

// かみ合いのグラフと、シャフトの角速度の拘束の零空間（design.md §6）

// 未知数はシャフトの ω と、ラックの速度 v（S3-04。direction の正の向き、mm/s）。basis の行はシャフト（shaftIds）、
// 続けてラック（rackIds）の順。ラックの行の「角度」はラックの変位 s（θ = N q で一緒に積分する）
export interface KinematicComponent {
  readonly shaftIds: ShaftId[]; // ID の昇順
  readonly rackIds: RackId[]; // この成分のラック（S3-04）。ID の昇順。basis の shaftIds の後の行
  readonly gearIds: GearId[]; // この成分のシャフトに載った歯車。ID の昇順
  readonly meshes: Mesh[]; // この成分の中のかみ合い（入力の順）
  readonly rackMeshes: RackMesh[]; // この成分の中のラックとピニオンのかみ合い（S3-04。入力の順）
  readonly basis: Matrix; // (shaftIds + rackIds).length 行 × dof 列。ω = basis · q
  readonly dof: number; // 0 なら回転条件の矛盾
  // 長さ dof。basis のこの行が単位行列（シャフトを先に選び、ラックは最後。ラックだけの成分ではラック）
  readonly referenceShaftIds: Array<ShaftId | RackId>;
  readonly anchoredShaftIds: ShaftId[]; // 固定具の拘束 ω = 0 を入れたシャフト（S3-01）。ID の昇順
  readonly anchoredRackIds: RackId[]; // 固定具の拘束 v = 0 を入れたラック（S3-04）。ID の昇順
}

// basis の行の順の ID（シャフト、続けてラック。S3-04）
export function bodyIdsOf(component: KinematicComponent): Array<ShaftId | RackId> {
  return [...component.shaftIds, ...component.rackIds];
}

export interface MeshGraph {
  readonly components: KinematicComponent[]; // 先頭のシャフトの ID の昇順
  readonly componentOfShaft: Readonly<Record<ShaftId, number>>; // components の添字
}

// 文字列の比較はロケールに依らない符号単位の順にする（決定的にするため）
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface ResolvedMesh {
  readonly mesh: Mesh | null;
  readonly rackMesh: RackMesh | null; // ラックとピニオンのかみ合い（S3-04）
  readonly shaftA: ShaftId;
  // 拘束の行の項（かみ合う 2 本のシャフトと、遊星のかみ合いならキャリアのシャフト。S3-03）
  readonly terms: ReadonlyArray<{ readonly shaftId: ShaftId; readonly coef: number }>;
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
  // 拘束の行の係数（ω_shaft(a) と ω_shaft(b) にかかる係数）は、種類ごとに meshCoefficients の 1 か所で決める。
  // 遊星のかみ合い（S3-03）はキャリアのシャフトの ω を引いた相対値（meshTerms）
  return { mesh, rackMesh: null, shaftA: a.shaftId, terms: meshTerms(mesh, scene) };
}

function resolveRackMesh(scene: Scene, rackMesh: RackMesh): ResolvedMesh {
  return {
    mesh: null,
    rackMesh,
    shaftA: rackMesh.rack,
    terms: rackMeshTerms(rackMesh, scene),
  };
}

// 基準シャフトに選ぶ順: root か detached を先に、次に ID の昇順。ラックの ピニオンのシャフト（'rack'）は子と同じ、
// ラック（S3-04）は最後
function referencePriority(scene: Scene, shaftIds: readonly ShaftId[]): ShaftId[] {
  const preferred = (id: ShaftId): number => {
    if (scene.shafts[id] === undefined) return 2;
    const p = scene.shafts[id]?.placement;
    return p !== undefined && (isChildPlacement(p) || p.kind === 'rack') ? 1 : 0;
  };
  return [...shaftIds].sort((x, y) => preferred(x) - preferred(y) || compareIds(x, y));
}

function buildComponent(
  scene: Scene,
  shaftIds: ShaftId[],
  rackIds: RackId[],
  gearIds: GearId[],
  meshes: readonly ResolvedMesh[],
  anchored: ReadonlySet<ShaftId | RackId>,
): KinematicComponent {
  const bodyIds = [...shaftIds, ...rackIds];
  // 列の並びを基準シャフトの優先の逆にする。消去のピボットは左から貪欲に取られ、
  // 自由な列（＝基底の単位行列の行）は右から貪欲に取られる（行列の双対）。
  // これで「優先の順に見て、それまでに選んだ行と独立なものを取る」と同じ選び方になる
  const order = referencePriority(scene, bodyIds).reverse();
  const columnOf = new Map(order.map((id, j) => [id, j]));
  const rows: Matrix = meshes.map(({ terms }) => {
    const row = new Array<number>(order.length).fill(0);
    for (const { shaftId, coef } of terms) {
      const j = columnOf.get(shaftId) as number;
      row[j] = (row[j] as number) + coef;
    }
    return row;
  });
  // 固定具（S3-01）: 固定されたシャフトは ω = 0、ラック（S3-04）は v = 0（拘束行列 C に 1 行足す）
  const anchoredShaftIds = shaftIds.filter((id) => anchored.has(id));
  const anchoredRackIds = rackIds.filter((id) => anchored.has(id));
  for (const id of [...anchoredShaftIds, ...anchoredRackIds]) {
    const row = new Array<number>(order.length).fill(0);
    row[columnOf.get(id) as number] = 1;
    rows.push(row);
  }
  const { basis: permuted, freeColumns } = nullSpaceWithFreeColumns(rows, order.length);
  // 自由な列を、優先の高い順（列の右から）に並べて q の順にする
  const freeByPriority = [...freeColumns].reverse();
  const basis: Matrix = bodyIds.map((id) => {
    const row = permuted[columnOf.get(id) as number] as number[];
    return freeByPriority.map((_, k) => row[freeColumns.length - 1 - k] as number);
  });
  return {
    shaftIds,
    rackIds,
    gearIds,
    meshes: meshes.flatMap((m) => (m.mesh === null ? [] : [m.mesh])),
    rackMeshes: meshes.flatMap((m) => (m.rackMesh === null ? [] : [m.rackMesh])),
    basis,
    dof: freeColumns.length,
    referenceShaftIds: freeByPriority.map((j) => order[j] as ShaftId),
    anchoredShaftIds,
    anchoredRackIds,
  };
}

// anchored: 固定具で ω = 0（ラックは v = 0）に拘束するシャフトとラック（S3-01、S3-04）。省くと固定具の拘束を入れない
// （ロックの理由 'anchor' の判定で、固定具を外して解き直すときに使う）。
// rackMeshes: ラックとピニオンのかみ合い（S3-04。Layout.rackMeshes）。シーンの全てのラックが頂点になる
export function buildMeshGraph(
  scene: Scene,
  meshes: readonly Mesh[],
  anchored: ReadonlySet<ShaftId | RackId> = new Set(),
  rackMeshes: readonly RackMesh[] = [],
): MeshGraph {
  const resolved = [
    ...meshes.map((mesh) => resolveMesh(scene, mesh)),
    ...rackMeshes.map((m) => resolveRackMesh(scene, m)),
  ];
  const rackSet = new Set(Object.keys(scene.racks));

  // 連結成分（Union-Find）。代表は ID の最も小さいシャフト（ラックも頂点。S3-04）
  const parent = new Map<ShaftId, ShaftId>();
  for (const id of Object.keys(scene.shafts)) parent.set(id, id);
  for (const id of rackSet) parent.set(id, id);
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
  for (const { shaftA, terms } of resolved) {
    for (const { shaftId } of terms) {
      const ra = find(shaftA);
      const rb = find(shaftId);
      if (ra === rb) continue;
      if (compareIds(ra, rb) < 0) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  }

  const groups = new Map<ShaftId, ShaftId[]>();
  for (const id of [...Object.keys(scene.shafts), ...rackSet].sort(compareIds)) {
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
      (groups.get(root) as ShaftId[]).filter((id) => !rackSet.has(id)),
      (groups.get(root) as ShaftId[]).filter((id) => rackSet.has(id)),
      gearsOf[index] as GearId[],
      meshesOf[index] as ResolvedMesh[],
      anchored,
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
