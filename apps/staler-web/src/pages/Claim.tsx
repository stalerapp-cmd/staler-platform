import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { money } from '../lib/format';
import { Button, ErrorNote, PageHeader, Skeleton, SuccessMark } from '../components/ui';

export default function Claim() {
  const { t, lang, err } = useI18n();
  const { reload } = useAuth();
  const [params] = useSearchParams();
  const v = params.get('v') ?? '';
  const [state, setState] = useState<{ preview: any; error: string | null; loading: boolean }>({ preview: null, error: null, loading: true });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    post('/api/exchange/vouchers/preview', { voucher: v })
      .then((p) => setState({ preview: p, error: null, loading: false }))
      .catch((e) => setState({ preview: null, error: err(e), loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  if (done)
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <SuccessMark />
        <h2 className="mt-6 text-2xl">{t.scan.claimed}</h2>
        <p className="num mt-2 font-display text-3xl text-olive">+{money(done.amount, lang)}</p>
        <Link to="/app" className="mt-8 block">
          <Button block>{t.common.done}</Button>
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t.scan.voucherTitle} />
      {state.loading ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : state.error ? (
        <ErrorNote>{state.error}</ErrorNote>
      ) : (
        <div className="card p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/20 text-[rgb(150_105_10)] dark:text-gold">
              <Ticket className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm text-muted">{t.scan.voucherFrom}</p>
              <p className="font-medium">{state.preview.agent}</p>
            </div>
          </div>
          <p className="num mt-6 font-display text-5xl">{money(state.preview.amount, lang)}</p>
          {state.preview.description && <p className="mt-2 text-muted">{state.preview.description}</p>}
          <ErrorNote>{error}</ErrorNote>
          <Button
            block
            size="lg"
            variant="stitch"
            className="mt-6"
            loading={busy}
            disabled={state.preview.status !== 'active'}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setDone(await post('/api/exchange/claim', { voucher: v }));
                void reload();
              } catch (e) {
                setError(err(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {state.preview.status === 'active' ? t.scan.claim : t.vouchers.st[state.preview.status]}
          </Button>
        </div>
      )}
    </div>
  );
}
