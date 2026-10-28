// ピッキングの優先順位（S1-16）。純粋関数のみで、three・DOM に触れない

// handle: S1-17・S1-19 のハンドル、candidate: S1-18 の生やす候補、carrier: S3-03 の遊星歯車のキャリア
export type PickKind = 'handle' | 'candidate' | 'gear' | 'carrier' | 'motor' | 'shaft';

// 優先順位の高い順。レイの当たりが複数あれば、手前かどうかより種類を優先する
export const PICK_PRIORITY: readonly PickKind[] = [
  'handle',
  'candidate',
  'gear',
  'carrier',
  'motor',
  'shaft',
];

const RANK: Readonly<Record<PickKind, number>> = {
  handle: 0,
  candidate: 1,
  gear: 2,
  carrier: 3,
  motor: 4,
  shaft: 5,
};

// レイの当たり（距離順とは限らない）から、優先順位に従って 1 つ選ぶ。
// 同じ種類の中では手前（distance が小さい）を選ぶ。当たりが無ければ null
export function choosePick(
  hits: ReadonlyArray<{ kind: PickKind; id: string; distance: number }>,
): { kind: PickKind; id: string } | null {
  let best: { kind: PickKind; id: string; distance: number } | null = null;
  for (const hit of hits) {
    if (
      best === null ||
      RANK[hit.kind] < RANK[best.kind] ||
      (RANK[hit.kind] === RANK[best.kind] && hit.distance < best.distance)
    ) {
      best = hit;
    }
  }
  return best === null ? null : { kind: best.kind, id: best.id };
}
