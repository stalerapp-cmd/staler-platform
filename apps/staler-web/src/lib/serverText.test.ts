import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverTextAr } from './serverText';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('every server message has Arabic', () => {
  it('covers all error messages in both APIs', () => {
    const missing = new Set<string>();
    for (const root of ['../staler-api/src', '../bank-api/src']) {
      for (const f of files(join(__dirname, '../..', root))) {
        const s = readFileSync(f, 'utf8');
        const res = [
          /\b(?:badRequest|conflict)\(\s*'[A-Z_0-9]+',\s*[`']([^`']+)[`']/g,
          /\b(?:forbidden|notFound|unauthorized|tooMany)\(\s*[`']([^`']+)[`']/g,
          /new AppError\(\s*\d+,\s*[^,]+,\s*[`']([^`']+)[`']/g,
          /new Bank(?:Unreachable|Rejected)\((?:\d+,\s*'[A-Z_]+',\s*)?[`']([^`']+)[`']/g,
          /message: '([A-Z][^']+)'/g,
        ];
        for (const re of res)
          for (const m of s.matchAll(re)) {
            const sample = m[1]!.replace(/\$\{[^}]+\}/g, 'X1');
            if (!serverTextAr(sample) && !serverTextAr(m[1]!)) missing.add(m[1]!);
          }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
