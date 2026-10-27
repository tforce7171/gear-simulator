import { isBlankImage } from './fixtures/blank';
import { expect, test } from './fixtures/test';

function solid(width: number, height: number, value: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function checker(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = (x + y) % 2 === 0 ? 255 : 0;
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

test.describe('isBlankImage', () => {
  test('64×64 の真っ黒は一色とみなす', () => {
    expect(isBlankImage(solid(64, 64, 0))).toBe(true);
  });

  test('64×64 の真っ白は一色とみなす', () => {
    expect(isBlankImage(solid(64, 64, 255))).toBe(true);
  });

  test('8×8 の白黒の市松模様は一色ではない', () => {
    expect(isBlankImage(checker(8))).toBe(false);
  });
});
