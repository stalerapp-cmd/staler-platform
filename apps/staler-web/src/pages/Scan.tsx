import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { Scanner } from '../components/Scanner';
import { Button, ErrorNote, Field, PageHeader } from '../components/ui';

/** Turns any supported QR payload into an in-app route. */
export function routeForCode(raw: string): string | null {
  const s = raw.trim();
  if (/^taler:\/\/withdraw\//i.test(s) || /\/withdraw\/[0-9a-f-]{36}\/?$/i.test(s)) return `/app/bank/qr?uri=${encodeURIComponent(s)}`;
  if (/^taler:\/\/exchange-claim\?/i.test(s)) {
    const v = new URL(s.replace(/^taler:\/\//i, 'https://x/')).searchParams.get('v');
    return v ? `/app/claim?v=${encodeURIComponent(v)}` : null;
  }
  if (/^taler:\/\/pay\?/i.test(s)) {
    const u = new URL(s.replace(/^taler:\/\//i, 'https://x/'));
    const to = u.searchParams.get('to');
    if (!to) return null;
    const amount = (u.searchParams.get('amount') ?? '').replace(/^[A-Z]{2,11}:/, '');
    const p = new URLSearchParams({ kind: 'payment', to });
    if (/^\d+(\.\d{1,2})?$/.test(amount)) p.set('amount', amount);
    const desc = u.searchParams.get('desc');
    if (desc) p.set('desc', desc.slice(0, 140));
    return `/app/send?${p.toString()}`;
  }
  if (/^[a-z_]*[a-z0-9_]{6,40}$/i.test(s) && !s.includes(':')) return `/app/send?to=${encodeURIComponent(s)}`;
  return null;
}

export default function Scan() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handle = (text: string) => {
    const r = routeForCode(text);
    if (r) nav(r);
    else setError(t.scan.unknown);
  };
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t.scan.title} lead={t.scan.lead} />
      <Scanner onResult={handle} />
      <form
        className="mt-8 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          handle(paste);
        }}
      >
        <Field label={t.scan.paste} placeholder={t.scan.pastePh} value={paste} onChange={(e) => setPaste(e.target.value)} dir="ltr" />
        <ErrorNote>{error}</ErrorNote>
        <Button block variant="secondary" disabled={!paste.trim()}>
          {t.scan.use}
        </Button>
      </form>
    </div>
  );
}
