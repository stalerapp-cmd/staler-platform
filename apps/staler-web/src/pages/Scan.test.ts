import { describe, expect, it } from 'vitest';
import { routeForCode } from './Scan';

describe('routeForCode', () => {
  it('routes bank withdrawal QR codes', () => {
    const uri = 'taler://withdraw/bank.example/taler-integration/1b4e28ba-2fa1-11d2-883f-0016d3cca427';
    expect(routeForCode(uri)).toBe(`/app/bank/qr?uri=${encodeURIComponent(uri)}`);
  });
  it('routes exchange vouchers', () => {
    expect(routeForCode('taler://exchange-claim?v=abc.def')).toBe('/app/claim?v=abc.def');
  });
  it('rejects unknown or hostile payloads', () => {
    for (const s of ['javascript:alert(1)', 'https://evil.example', 'taler://pay?amount=5', '']) expect(routeForCode(s)).toBeNull();
  });
});
