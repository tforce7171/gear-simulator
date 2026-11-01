import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../core/layout/resolve';
import { validateScene } from '../core/scene/validate';
import { rackReciprocationScene, SAMPLES } from './samples';

describe('見本（S5-05）', () => {
  it('ラック往復は e2e/fixtures/rack-reciprocation.json と同じ', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../../e2e/fixtures/rack-reciprocation.json', import.meta.url), 'utf8'),
    );
    expect(fixture).toEqual(rackReciprocationScene);
  });

  it('どの見本もシーンの検証を通り、干渉がない', () => {
    for (const sample of SAMPLES) {
      expect(validateScene(sample.scene)).toEqual({ ok: true });
      expect(resolveLayout(sample.scene).interferences).toEqual([]);
    }
  });
});
