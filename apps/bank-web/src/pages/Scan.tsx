import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { Scanner } from '../components/Scanner';
import { Button, ErrorNote, Field, PageHeader } from '../components/ui';

export default function Scan() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handle = (s: string) => {
    const m = /^talerbank:\/\/pay\/([0-9a-f-]{36})$/i.exec(s.trim());
    if (m) return nav(`/app/pay/${m[1]}`);
    setError(/^taler:\/\//i.test(s.trim()) ? t.scan.stalerHint : t.scan.unknown);
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
        <Field label={t.scan.paste} value={paste} onChange={(e) => setPaste(e.target.value)} dir="ltr" placeholder="talerbank://pay/…" />
        <ErrorNote>{error}</ErrorNote>
        <Button block variant="secondary" disabled={!paste.trim()}>
          {t.scan.use}
        </Button>
      </form>
    </div>
  );
}
