import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Every English key must exist in Arabic (TypeScript enforces shape; this guards empty strings). */
describe('i18n', () => {
  it('has no empty translations', () => {
    const src = readFileSync('src/lib/i18n.tsx', 'utf8');
    expect(src).not.toMatch(/:\s*''\s*[,}]/);
  });
});
