import { describe, expect, it } from 'vitest';
import { GEAR_KIND_LIST } from '../core/scene/gear-shape';
import type { GearKind } from '../core/scene/types';
import { THEME_IDS, type ThemeId } from '../core/theme';
import {
  GEAR_KIND_MATERIALS,
  GEAR_MATERIAL_LOOKS,
  type GearMaterialId,
  gearLook,
  usesWoodGrain,
} from './themes';

// S2-05: 歯車の種類ごとの材質

describe('歯車の種類ごとの材質の表', () => {
  it('型: すべての GearKind に、両テーマの材質がある（Record<GearKind, Record<ThemeId, …>>）', () => {
    const table: Readonly<Record<GearKind, Readonly<Record<ThemeId, GearMaterialId>>>> =
      GEAR_KIND_MATERIALS;
    expect(table).toBe(GEAR_KIND_MATERIALS);
  });

  it('実行時: すべての GearKind に、両テーマの材質と見た目がある', () => {
    expect(Object.keys(GEAR_KIND_MATERIALS).sort()).toEqual([...GEAR_KIND_LIST].sort());
    for (const kind of GEAR_KIND_LIST) {
      for (const theme of THEME_IDS) {
        const id = GEAR_KIND_MATERIALS[kind][theme];
        expect(id, `${kind}/${theme}`).toBeDefined();
        expect(GEAR_MATERIAL_LOOKS[id], `${kind}/${theme}`).toBeDefined();
        expect(gearLook(theme, kind)).toBe(GEAR_MATERIAL_LOOKS[id]);
      }
    }
  });

  it('資料の表: 平歯車・ハスバ・かさ・ねじは真鍮／明るい木、ウォームは鋼／濃い木、ホイールは青銅／明るい木', () => {
    for (const kind of ['spur', 'helical', 'bevel', 'crossedHelical'] as const) {
      expect(GEAR_KIND_MATERIALS[kind]).toEqual({ brass: 'brass', wood: 'lightWood' });
    }
    expect(GEAR_KIND_MATERIALS.worm).toEqual({ brass: 'steel', wood: 'darkWood' });
    expect(GEAR_KIND_MATERIALS.wormWheel).toEqual({ brass: 'bronze', wood: 'lightWood' });
  });

  it('ウォームとホイールは、両テーマで平歯車と違う色（ホイールは真鍮テーマだけ）', () => {
    for (const theme of THEME_IDS) {
      expect(gearLook(theme, 'worm').color).not.toBe(gearLook(theme, 'spur').color);
    }
    expect(gearLook('brass', 'wormWheel').color).not.toBe(gearLook('brass', 'spur').color);
  });

  it('青銅は真鍮より赤みが強い（赤 − 緑 が大きい）', () => {
    const redness = (hex: number): number => ((hex >> 16) & 0xff) - ((hex >> 8) & 0xff);
    expect(redness(GEAR_MATERIAL_LOOKS.bronze.color)).toBeGreaterThan(
      redness(GEAR_MATERIAL_LOOKS.brass.color),
    );
  });

  it('木製のテーマの歯車は木目、真鍮のテーマの歯車は金属', () => {
    for (const kind of GEAR_KIND_LIST) {
      expect(gearLook('wood', kind).woodGrain).toBe(true);
      expect(gearLook('brass', kind).metalness).toBe(1);
    }
    expect(usesWoodGrain('wood')).toBe(true);
    expect(usesWoodGrain('brass')).toBe(false);
  });
});
