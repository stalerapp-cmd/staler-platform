import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOVERNORATES, expandPlaces, governorateOf, placeKey } from './places';

describe('places of Palestine', () => {
  it('is the same list on the server and in the app', () => {
    const web = readFileSync(join(__dirname, 'places.ts'), 'utf8');
    const api = readFileSync(join(__dirname, '../../../staler-api/src/lib/places.ts'), 'utf8');
    expect(api).toBe(web);
  });
  it('has unique governorate ids and finds towns loosely', () => {
    expect(new Set(GOVERNORATES.map((g) => g.id)).size).toBe(GOVERNORATES.length);
    expect(governorateOf('حواره')?.id).toBe('nablus');
    expect(governorateOf('رام اللة')?.id).toBe('ramallah');
    expect(placeKey('أريحا')).toBe(placeKey('اريحا'));
    expect(expandPlaces(['gov:rafah'])).toContain('رفح');
  });
});
