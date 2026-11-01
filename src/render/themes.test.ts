import { describe, expect, it } from 'vitest';
import { GEAR_KIND_LIST } from '../core/scene/gear-shape';
import { PART_COLORS } from '../core/scene/part-color';
import type { GearKind } from '../core/scene/types';
import { THEME_IDS, THEME_PART_COLORS, type ThemeId } from '../core/theme';
import { MOTOR_PARTS, type MotorPart } from './motor';
import {
  colorMaterial,
  GEAR_KIND_MATERIALS,
  GEAR_MATERIAL_LOOKS,
  type GearMaterialId,
  gearLook,
  type MaterialId,
  MOTOR_PART_LOOKS,
  motorLook,
  PART_COLOR_MATERIALS,
  PART_KIND_MATERIALS,
  PART_KINDS,
  type PartKind,
  type PartLook,
  partLook,
  usesWoodGrain,
  woodGrainShade,
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

// S3-05: 歯車以外の部品（キャリア・ラック・固定具）の材質の表
describe('部品の種類ごとの材質の表（S3-05）', () => {
  it('型: すべての部品の種類に、両テーマの材質がある（Record<PartKind, Record<ThemeId, …>>）', () => {
    const table: Readonly<Record<PartKind, Readonly<Record<ThemeId, MaterialId>>>> =
      PART_KIND_MATERIALS;
    expect(table).toBe(PART_KIND_MATERIALS);
  });

  it('実行時: すべての部品の種類（歯車と、歯車以外）に、両テーマの材質と見た目がある', () => {
    expect(Object.keys(PART_KIND_MATERIALS).sort()).toEqual([...PART_KINDS].sort());
    for (const kind of PART_KINDS) {
      for (const theme of THEME_IDS) {
        const id = PART_KIND_MATERIALS[kind][theme];
        expect(GEAR_MATERIAL_LOOKS[id], `${kind}/${theme}`).toBeDefined();
        expect(partLook(theme, kind)).toBe(GEAR_MATERIAL_LOOKS[id]);
      }
    }
    for (const kind of GEAR_KIND_LIST) {
      for (const theme of THEME_IDS) expect(gearLook(theme, kind)).toBeDefined();
    }
  });

  it('資料の表: 内歯車・ラックは真鍮／明るい木、キャリアは鋼／濃い木、固定具は黒い鉄／濃い木', () => {
    expect(GEAR_KIND_MATERIALS.internal).toEqual({ brass: 'brass', wood: 'lightWood' });
    expect(PART_KIND_MATERIALS.rack).toEqual({ brass: 'brass', wood: 'lightWood' });
    expect(PART_KIND_MATERIALS.carrier).toEqual({ brass: 'steel', wood: 'darkWood' });
    expect(PART_KIND_MATERIALS.anchor).toEqual({ brass: 'blackIron', wood: 'darkWood' });
  });

  it('黒い鉄は暗い金属', () => {
    const iron = GEAR_MATERIAL_LOOKS.blackIron;
    expect(iron.color).toBeLessThan(0x404040);
    expect(iron.metalness).toBeGreaterThan(0.5);
    expect(iron.woodGrain).toBeUndefined();
  });
});

// S4-07: モーターの部分ごとの材質の表
describe('モーターの部分ごとの材質の表（S4-07）', () => {
  it('型: モーターのすべての部分に、両テーマの見た目がある（Record<MotorPart, Record<ThemeId, …>>）', () => {
    const table: Readonly<Record<MotorPart, Readonly<Record<ThemeId, PartLook>>>> =
      MOTOR_PART_LOOKS;
    expect(table).toBe(MOTOR_PART_LOOKS);
  });

  it('実行時: モーターのすべての部分（本体・端の蓋・端子・継手・線）に、両テーマの材質がある', () => {
    expect(Object.keys(MOTOR_PART_LOOKS).sort()).toEqual([...MOTOR_PARTS].sort());
    for (const part of MOTOR_PARTS) {
      for (const theme of THEME_IDS) {
        const look = motorLook(theme, part);
        expect(look, `${part}/${theme}`).toBeDefined();
        expect(look).toBe(MOTOR_PART_LOOKS[part][theme]);
      }
    }
  });

  it('真鍮のテーマは銀色の金属の本体と黒い端の蓋', () => {
    const body = motorLook('brass', 'body');
    expect(body.metalness).toBe(1);
    const channels = [(body.color >> 16) & 0xff, (body.color >> 8) & 0xff, body.color & 0xff];
    // 銀色: 明るく、色味が少ない
    expect(Math.min(...channels)).toBeGreaterThan(0xa0);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(0x18);
    expect(motorLook('brass', 'endCap').color).toBeLessThan(0x303030);
  });

  it('テーマを切り替えると、モーターの本体・端の蓋・継手の色が変わる。木製は木のおもちゃ（金属でない）', () => {
    for (const part of ['body', 'endCap', 'coupling'] as const) {
      expect(motorLook('wood', part).color, part).not.toBe(motorLook('brass', part).color);
      expect(motorLook('wood', part).metalness, part).toBe(0);
    }
  });

  it('継手の線は継手と違う色（回転が見える）', () => {
    for (const theme of THEME_IDS) {
      expect(motorLook(theme, 'mark').color).not.toBe(motorLook(theme, 'coupling').color);
    }
  });
});

// S5-04: 部品ごとの色
describe('部品の色の質感とテーマの系統（S5-04）', () => {
  it('すべての色に質感がある。真鍮・シルバー・木は今の brass・steel・lightWood と同じ', () => {
    expect(Object.keys(PART_COLOR_MATERIALS).sort()).toEqual([...PART_COLORS].sort());
    expect(PART_COLOR_MATERIALS.brass).toBe('brass');
    expect(PART_COLOR_MATERIALS.silver).toBe('steel');
    expect(PART_COLOR_MATERIALS.wood).toBe('lightWood');
    expect(GEAR_MATERIAL_LOOKS.steel.color).toBe(0xb9bec4);
  });

  it('テーマの系統: 真鍮は真鍮・シルバー・メタリックブルー、木は木・ダークオーク。どの色もどちらかの系統に入る', () => {
    expect(THEME_PART_COLORS.brass).toEqual(['brass', 'silver', 'metallicBlue']);
    expect(THEME_PART_COLORS.wood).toEqual(['wood', 'darkOak']);
    expect([...THEME_PART_COLORS.brass, ...THEME_PART_COLORS.wood].sort()).toEqual(
      [...PART_COLORS].sort(),
    );
  });

  it('真鍮 × シルバー → シルバーの質感、木 × シルバー → 自動の質感', () => {
    expect(colorMaterial('brass', 'silver')).toBe('steel');
    expect(gearLook('brass', 'spur', 'silver')).toBe(GEAR_MATERIAL_LOOKS.steel);
    expect(colorMaterial('wood', 'silver')).toBeNull();
    expect(gearLook('wood', 'spur', 'silver')).toBe(gearLook('wood', 'spur'));
    expect(gearLook('wood', 'worm', 'silver')).toBe(gearLook('wood', 'worm'));
    expect(partLook('wood', 'rack', 'silver')).toBe(partLook('wood', 'rack'));
    // 逆向き: 真鍮 × ダークオーク → 自動
    expect(gearLook('brass', 'wormWheel', 'darkOak')).toBe(gearLook('brass', 'wormWheel'));
    expect(partLook('brass', 'anchor', 'darkOak')).toBe(partLook('brass', 'anchor'));
  });

  it('色なし（自動）は種類とテーマで決まる質感のまま', () => {
    expect(colorMaterial('brass', undefined)).toBeNull();
    for (const theme of THEME_IDS) {
      for (const kind of GEAR_KIND_LIST) {
        expect(gearLook(theme, kind, undefined)).toBe(gearLook(theme, kind));
      }
      for (const kind of PART_KINDS) {
        expect(partLook(theme, kind, undefined)).toBe(partLook(theme, kind));
      }
    }
  });

  it('系統の中の色は、歯車にも部品にも同じ質感で効く', () => {
    for (const theme of THEME_IDS) {
      for (const color of THEME_PART_COLORS[theme]) {
        const look = GEAR_MATERIAL_LOOKS[PART_COLOR_MATERIALS[color]];
        expect(gearLook(theme, 'worm', color)).toBe(look);
        expect(partLook(theme, 'carrier', color)).toBe(look);
      }
    }
  });

  it('メタリックブルーは青の強い金属', () => {
    const look = GEAR_MATERIAL_LOOKS.metallicBlue;
    expect(look.metalness).toBe(1);
    const [r, g, b] = [(look.color >> 16) & 0xff, (look.color >> 8) & 0xff, look.color & 0xff];
    expect(b).toBeGreaterThan(r + 0x40);
    expect(b).toBeGreaterThan(g);
  });

  it('ダークオークは暗い木（darkWood とは別の、黄みのあるこげ茶）で、木目が lightWood より強い', () => {
    const oak = GEAR_MATERIAL_LOOKS.darkOak;
    expect(oak.woodGrain).toBe(true);
    expect(oak.metalness).toBe(0);
    expect(oak.color).not.toBe(GEAR_MATERIAL_LOOKS.darkWood.color);
    const channels = (hex: number): [number, number, number] => [
      (hex >> 16) & 0xff,
      (hex >> 8) & 0xff,
      hex & 0xff,
    ];
    const [r, g, b] = channels(oak.color);
    const [wr, wg] = channels(GEAR_MATERIAL_LOOKS.darkWood.color);
    // 黄み: 赤に対する緑の割合が darkWood より大きい。暗さ: どの成分も 0x60 未満
    expect(g / r).toBeGreaterThan(wg / wr);
    expect(Math.max(r, g, b)).toBeLessThan(0x60);
    expect(oak.grainContrast ?? 1).toBeGreaterThan(
      GEAR_MATERIAL_LOOKS.lightWood.grainContrast ?? 1,
    );
  });

  it('木目の強さ: 強くすると明るさの幅が広がる（1 は今の木目）', () => {
    const range = (contrast: number): number => {
      const values: number[] = [];
      for (let i = 0; i < 64; i++)
        for (let j = 0; j < 64; j++) {
          values.push(woodGrainShade(i / 64, j / 64, contrast));
        }
      return Math.max(...values) - Math.min(...values);
    };
    expect(woodGrainShade(0.3, 0.7, 1)).toBe(woodGrainShade(0.3, 0.7));
    expect(range(1.5)).toBeGreaterThan(range(1));
  });
});
