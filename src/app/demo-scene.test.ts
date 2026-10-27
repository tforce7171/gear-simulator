import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateScene } from '../core/scene/validate';
import { demoScene } from './demo-scene';

describe('demoScene', () => {
  it('e2e/fixtures/two-spur.json と同じ', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../../e2e/fixtures/two-spur.json', import.meta.url), 'utf8'),
    );
    expect(fixture).toEqual(demoScene);
  });

  it('シーンの検証を通る', () => {
    expect(validateScene(demoScene)).toEqual({ ok: true });
  });
});
