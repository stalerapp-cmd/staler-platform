import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { ApiError, del, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { useAccounts } from '../lib/accounts';
import { date, relative } from '../lib/format';
import { useSecureAction } from '../components/SecureAction';
import { useToast } from '../components/Toast';
import { Badge, Button, CopyButton, EmptyState, ErrorNote, PageHeader, Sheet } from '../components/ui';

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);
  const s = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return <span className="num">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>;
}

export default function Apps() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const { primary } = useAccounts();
  const apps = useData<{ apps: any[] }>('/api/linked-apps');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<any>(null);
  const secure = useSecureAction();
  return (
    <div className="mx-auto max-w-3xl">
      {secure.element}
      <PageHeader title={t.apps.title} lead={t.apps.lead} />
      <section className="card engraved p-6">
        {code ? (
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <p className="text-sm text-muted">{t.apps.codeLead}</p>
            <p className="num mt-4 font-display text-5xl tracking-[0.25em] text-gold">{code.code}</p>
            <div className="mt-3 flex items-center justify-center gap-3 text-sm text-muted">
              <span>
                {t.apps.expiresIn} <Countdown until={code.expiresAt} />
              </span>
              <CopyButton text={code.code} />
            </div>
          </motion.div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-gold/15 text-gold">
              <KeyRound className="h-6 w-6" />
            </span>
            <p className="min-w-0 flex-1 text-muted">{t.apps.codeLead}</p>
            <Button
              loading={busy}
              disabled={!primary}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  setCode(await secure.run((totp) => post('/api/link-codes', { accountId: primary!.id, ...(totp ? { totp } : {}) })));
                } catch (e) {
                  if (!(e instanceof ApiError && e.code === 'CANCELLED')) setError(err(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.apps.code}
            </Button>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </section>
      <section className="mt-6">
        {!apps.data?.apps.length ? (
          <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title={t.apps.none} />
        ) : (
          <ul className="space-y-3">
            {apps.data.apps.map((a) => (
              <li key={a.id} className="card flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl">{a.client_name}</p>
                  <p className="text-sm text-muted">
                    {t.apps.lastUsed}: {a.last_used_at ? relative(a.last_used_at, lang) : t.apps.never} · {t.apps.expiresIn} {date(a.expires_at, lang, false)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.scopes.map((s: string) => (
                      <Badge key={s} tone="info">
                        {t.apps.scope[s] ?? s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button variant="danger" size="sm" onClick={() => setRevoke(a)}>
                  {t.common.revoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Sheet open={!!revoke} onClose={() => setRevoke(null)} title={t.common.revoke}>
        <p className="text-muted">{t.apps.revokeQ}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setRevoke(null)}>
            {t.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await del(`/api/linked-apps/${revoke.id}`);
                void apps.reload();
              } catch (e) {
                toast(err(e), 'error');
              }
              setRevoke(null);
            }}
          >
            {t.common.revoke}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
