import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * React treats whatever an effect returns as its cleanup and calls it. An
 * expression-bodied effect such as `useEffect(() => el.scrollIntoView())`
 * returns that call's result — in current Chrome a Promise — and React then
 * crashes with "n is not a function". Effects must use a block body (or
 * return an explicit cleanup arrow).
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe('effects', () => {
  it('never return a value by accident', () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, '..'))) {
      const src = readFileSync(f, 'utf8');
      const re = /use(?:Layout)?Effect\(\s*(?:async\s*)?\(\)\s*=>\s*([^{\s])/g;
      for (let m; (m = re.exec(src)); ) {
        // `() => () => cleanup()` (cleanup-only) and `() => void x()` are fine.
        const rest = src.slice(m.index + m[0].length - 1);
        if (rest.startsWith('()') || rest.startsWith('void ')) continue;
        bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
