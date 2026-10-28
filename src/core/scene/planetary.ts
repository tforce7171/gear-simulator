import { CARRIER_GAP, GEAR_SIZES } from '../constants';
import { makeGear } from './gear-shape';
import type { Carrier, CarrierId, Gear, GearId, Scene, Shaft, ShaftId } from './types';

// 太陽歯車 sun の遊星歯車機構の部品（S3-03。編集コマンド growGear（planetary）と、生やす候補が使う）

export interface PlanetaryIds {
  readonly carrierShaftId: ShaftId;
  readonly carrierId: CarrierId;
  readonly planets: ReadonlyArray<{ readonly shaftId: ShaftId; readonly gearId: GearId }>; // 遊星の数だけ
  readonly ringShaftId: ShaftId;
  readonly ringId: GearId;
}

// 部品を足したシーン:
// - キャリアのシャフト（太陽と同じ線上の concentric）とキャリア。板はリングのウェブの反対側（太陽の軸の正の側）に、
//   太陽の歯幅の正側の面から CARRIER_GAP 離して置く
// - 遊星のシャフト（planet、angle = 2πk/n）と遊星歯車（太陽と同じ大きさ、z_p 歯、offset 0）
// - リングのシャフト（concentric）と内歯車（webSide −1、z_r 歯）。原点が太陽のシャフトと同じなので、offset を太陽と
//   同じにすれば同じ面にそろう
export function withPlanetary(
  scene: Scene,
  sun: Gear,
  ids: PlanetaryIds,
  teeth: { readonly zp: number; readonly zr: number },
): Scene {
  const shafts: Record<ShaftId, Shaft> = { ...scene.shafts };
  const gears: Record<GearId, Gear> = { ...scene.gears };
  shafts[ids.carrierShaftId] = {
    id: ids.carrierShaftId,
    placement: { kind: 'concentric', parentShaftId: sun.shaftId },
  };
  const carrier: Carrier = {
    id: ids.carrierId,
    shaftId: ids.carrierShaftId,
    offset: sun.offset + GEAR_SIZES[sun.size].faceWidth + CARRIER_GAP,
    size: sun.size,
  };
  const n = ids.planets.length;
  ids.planets.forEach(({ shaftId, gearId }, k) => {
    shafts[shaftId] = {
      id: shaftId,
      placement: {
        kind: 'planet',
        carrierId: ids.carrierId,
        parentGearId: sun.id,
        childGearId: gearId,
        angle: (2 * Math.PI * k) / n,
      },
    };
    gears[gearId] = makeGear(
      { id: gearId, shaftId, size: sun.size, teeth: teeth.zp, offset: 0 },
      { kind: 'spur' },
    );
  });
  shafts[ids.ringShaftId] = {
    id: ids.ringShaftId,
    placement: { kind: 'concentric', parentShaftId: sun.shaftId },
  };
  gears[ids.ringId] = makeGear(
    {
      id: ids.ringId,
      shaftId: ids.ringShaftId,
      size: sun.size,
      teeth: teeth.zr,
      offset: sun.offset,
    },
    { kind: 'internal', webSide: -1 },
  );
  return { ...scene, shafts, gears, carriers: { ...scene.carriers, [ids.carrierId]: carrier } };
}
