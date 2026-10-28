import { useEffect, useState } from 'react';
import { Download, ShieldCheck, Smartphone } from 'lucide-react';
import { get, isNative } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { date } from '../lib/format';
import { cx } from './ui';

type AppKey = 'staler' | 'bank';
interface Release {
  version: string | null;
  publishedAt: string | null;
  apps: Record<AppKey, { url: string; size: number | null; available: boolean }>;
}

const REPO = 'https://github.com/stalerapp-cmd/staler-platform/releases/latest/download';
const FALLBACK: Release = {
  version: null,
  publishedAt: null,
  apps: { staler: { url: `${REPO}/s-taler.apk`, size: null, available: true }, bank: { url: `${REPO}/talerbank.apk`, size: null, available: true } },
};
const mb = (n: number | null) => (n ? `${(n / 1_048_576).toFixed(1)} MB` : null);

/**
 * Android downloads that always point at the newest build: the links use
 * GitHub's /releases/latest/download/ path (so they never go stale) and the
 * version, size and date come from /api/app-release.
 */
export function AppDownloads({ self, tone = 'dark' }: { self: AppKey; tone?: 'dark' | 'light' }) {
  const { t, lang } = useI18n();
  const [rel, setRel] = useState<Release>(FALLBACK);
  useEffect(() => {
    let alive = true;
    get('/api/app-release')
      .then((r: Release) => {
        if (alive && r?.apps) setRel(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (isNative) return null;
  const order: AppKey[] = self === 'staler' ? ['staler', 'bank'] : ['bank', 'staler'];
  const info = {
    staler: { name: 'S-Taler', role: t.dl.wallet, desc: t.dl.walletD, icon: '/apps/s-taler.png' },
    bank: { name: 'TalerBank', role: t.dl.bank, desc: t.dl.bankD, icon: '/apps/talerbank.png' },
  };
  const dark = tone === 'dark';
  return (
    <div id="download" className="scroll-mt-24">
      <div className="max-w-2xl">
        <h2 className="font-display text-3xl sm:text-4xl">{t.dl.title}</h2>
        <p className={cx('mt-3 text-base sm:text-lg', dark ? 'text-white/70' : 'text-muted')}>{t.dl.lead}</p>
      </div>
      <ul className="mt-8 grid gap-4 md:grid-cols-2">
        {order.map((k) => {
          const a = rel.apps[k];
          const i = info[k];
          const main = k === self;
          const meta = [rel.version ? `v${rel.version}` : null, mb(a.size), rel.publishedAt ? `${t.dl.updated} ${date(rel.publishedAt, lang, false)}` : null].filter(Boolean);
          return (
            <li
              key={k}
              className={cx(
                'group relative flex flex-col gap-5 overflow-hidden rounded-3xl border p-5 transition sm:flex-row sm:items-center sm:p-6',
                dark ? 'border-white/10 bg-white/[0.06] hover:bg-white/[0.09]' : 'border-line bg-surface hover:shadow-card',
                main && (dark ? 'ring-1 ring-white/25' : 'ring-1 ring-ink/10'),
              )}
            >
              <img src={i.icon} alt="" width={64} height={64} loading="lazy" className="h-16 w-16 shrink-0 rounded-2xl shadow-lg transition duration-300 group-hover:-rotate-3 group-hover:scale-105" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
                  {i.name}
                  <span className={cx('text-sm font-normal', dark ? 'text-white/60' : 'text-muted')}>{i.role}</span>
                </p>
                <p className={cx('mt-1 text-sm', dark ? 'text-white/70' : 'text-muted')}>{i.desc}</p>
                {!!meta.length && <p className={cx('num mt-2 text-xs', dark ? 'text-white/50' : 'text-muted')}>{meta.join('  ·  ')}</p>}
              </div>
              <a
                href={a.url}
                rel="noopener"
                download
                className={cx(
                  'inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition active:scale-[0.97]',
                  main ? 'bg-stitch text-white hover:brightness-110' : dark ? 'bg-white text-night hover:bg-white/90' : 'bg-night text-white hover:bg-night/90',
                )}
                aria-label={`${t.dl.download} ${i.name}`}
              >
                <Download className="h-4 w-4" />
                {t.dl.download}
              </a>
            </li>
          );
        })}
      </ul>
      <div className={cx('mt-5 grid gap-3 text-sm sm:grid-cols-2', dark ? 'text-white/65' : 'text-muted')}>
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> {t.dl.android}
        </p>
        <p className="flex items-start gap-2">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" /> {t.dl.iphone}
        </p>
      </div>
    </div>
  );
}
