import { describe, expect, it } from 'vitest';
import { createWheelClassifier, decideWheelAction, type WheelSample } from './wheel';

function sample(patch: Partial<WheelSample>): WheelSample {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, timeStamp: 0, ...patch };
}

describe('createWheelClassifier', () => {
  it('{ deltaX: 0, deltaY: 100, deltaMode: 0 } を 5 回 → すべて mouse', () => {
    const classify = createWheelClassifier();
    for (let i = 0; i < 5; i++) {
      expect(classify(sample({ deltaY: 100, timeStamp: i * 50 }))).toBe('mouse');
    }
  });

  it('{ deltaX: 0, deltaY: 3, deltaMode: 1 } → mouse', () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaY: 3, deltaMode: 1 }))).toBe('mouse');
  });

  it('{ deltaX: 1.5, deltaY: 4.25, deltaMode: 0 } → trackpad', () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaX: 1.5, deltaY: 4.25 }))).toBe('trackpad');
  });

  it('トラックパッドの直後（100ms 後）の大きな整数の deltaY → trackpad のまま（慣性の途中）', () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaX: 1.5, deltaY: 4.25, timeStamp: 1000 }))).toBe('trackpad');
    expect(classify(sample({ deltaY: 60, timeStamp: 1100 }))).toBe('trackpad');
  });

  it('同じものを 600ms 空けて → mouse に戻る', () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaX: 1.5, deltaY: 4.25, timeStamp: 1000 }))).toBe('trackpad');
    expect(classify(sample({ deltaY: 60, timeStamp: 1600 }))).toBe('mouse');
  });

  it('トラックパッドの最中でも deltaMode: 1 が来たら → mouse', () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaX: 1.5, deltaY: 4.25, timeStamp: 1000 }))).toBe('trackpad');
    expect(classify(sample({ deltaY: 3, deltaMode: 1, timeStamp: 1016 }))).toBe('mouse');
  });

  it('ctrlKey 付きで deltaY が整数でない（ピンチ）→ trackpad', () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaY: -2.5, ctrlKey: true }))).toBe('trackpad');
  });

  it('小さな整数の deltaY だけ（判別の決め手が無い）→ 前の結果のまま', () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaX: 1, deltaY: 2, timeStamp: 0 }))).toBe('trackpad');
    expect(classify(sample({ deltaY: 4, timeStamp: 2000 }))).toBe('trackpad');
  });
});

describe('decideWheelAction', () => {
  function zoomFactor(s: WheelSample, device: 'mouse' | 'trackpad'): number {
    const action = decideWheelAction(s, device, 'pan');
    if (action.kind !== 'zoom') throw new Error(`zoom でない: ${action.kind}`);
    return action.factor;
  }

  it('ctrlKey 付き: deltaY −10 → factor < 1、+10 → factor > 1、その積が 1（デバイスによらない）', () => {
    for (const device of ['mouse', 'trackpad'] as const) {
      const zoomIn = zoomFactor(sample({ ctrlKey: true, deltaY: -10 }), device);
      const zoomOut = zoomFactor(sample({ ctrlKey: true, deltaY: 10 }), device);
      expect(zoomIn).toBeLessThan(1);
      expect(zoomOut).toBeGreaterThan(1);
      expect(zoomIn * zoomOut).toBeCloseTo(1, 10);
    }
  });

  it('マウス、deltaY 100 → zoom で factor > 1。deltaMode 1・deltaY 3 も factor > 1', () => {
    expect(zoomFactor(sample({ deltaY: 100 }), 'mouse')).toBeGreaterThan(1);
    expect(zoomFactor(sample({ deltaY: 3, deltaMode: 1 }), 'mouse')).toBeGreaterThan(1);
  });

  it('deltaMode 1・2 は画素に換算する（行・ページの 1 単位は 1 画素より大きく効く）', () => {
    const px = zoomFactor(sample({ deltaY: 3 }), 'mouse');
    const line = zoomFactor(sample({ deltaY: 3, deltaMode: 1 }), 'mouse');
    const page = zoomFactor(sample({ deltaY: 3, deltaMode: 2 }), 'mouse');
    expect(line).toBeGreaterThan(px);
    expect(page).toBeGreaterThan(line);
  });

  it("トラックパッド、scroll 'pan'、deltaX 5・deltaY 7 → { kind: 'pan', dx: 5, dy: 7 }", () => {
    expect(decideWheelAction(sample({ deltaX: 5, deltaY: 7 }), 'trackpad', 'pan')).toEqual({
      kind: 'pan',
      dx: 5,
      dy: 7,
    });
  });

  it("トラックパッド、scroll 'orbit' → rotate", () => {
    expect(decideWheelAction(sample({ deltaX: 5, deltaY: 7 }), 'trackpad', 'orbit')).toEqual({
      kind: 'rotate',
      dx: 5,
      dy: 7,
    });
  });
});
