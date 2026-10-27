import type { Scene } from './types';

export function emptyScene(): Scene {
  return { shafts: {}, gears: {}, motors: {} };
}
