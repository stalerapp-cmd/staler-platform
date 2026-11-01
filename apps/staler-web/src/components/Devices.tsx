import { useState } from 'react';
import { ChevronLeft, Laptop, LogOut, Smartphone, Tablet } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { parseDevice } from '../lib/device';
import { relative } from '../lib/format';
import { Badge, Button, Sheet } from './ui';

const W = {
  en: { title: 'Device details', kind: 'Device', phone: 'Phone', tablet: 'Tablet', computer: 'Computer', app: 'App', web: 'Browser', browser: 'Browser', system: 'System', via: 'Signed in through', ip: 'Network address', first: 'Signed in', last: 'Last active', until: 'Stays signed in until', current: 'This device', out: 'Sign this device out', raw: 'Technical details', on: '{b} on {o}' },
  ar: { title: 'تفاصيل الجهاز', kind: 'نوع الجهاز', phone: 'جوال', tablet: 'تابلت', computer: 'كمبيوتر', app: 'التطبيق', web: 'المتصفح', browser: 'المتصفح', system: 'النظام', via: 'دخل من', ip: 'عنوان الشبكة', first: 'دخل بتاريخ', last: 'آخر نشاط', until: 'بضل داخل لحد', current: 'هاد الجهاز', out: 'اطلع من هالجهاز', raw: 'تفاصيل تقنية', on: '{b} على {o}' },
};

const Icon = ({ kind, className }: { kind: string; className?: string }) => (kind === 'phone' ? <Smartphone className={className} /> : kind === 'tablet' ? <Tablet className={className} /> : <Laptop className={className} />);

/** Signed-in devices: a readable list, and a tap opens everything we know about one. */
export function DeviceList({ sessions, onRevoke, thisDevice, lastUsed, revoke }: { sessions: any[] | undefined; onRevoke: (s: any) => Promise<void> | void; thisDevice: string; lastUsed: string; revoke: string }) {
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [open, setOpen] = useState<any>(null);
  const full = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar-PS' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const d = open ? parseDevice(open.user_agent) : null;
  return (
    <>
      <ul className="divide-y divide-line">
        {sessions?.map((s) => {
          const p = parseDevice(s.user_agent);
          return (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s)} className="flex w-full items-center gap-3 rounded-xl py-3 text-start transition hover:bg-sunk/60 sm:px-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunk text-muted">
                  <Icon kind={p.kind} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{w.on.replace('{b}', p.app ? w.app : p.browser).replace('{o}', p.os)}</span>
                  <span className="block truncate text-xs text-muted">
                    {lastUsed} {relative(s.last_used_at ?? s.created_at, lang)}
                  </span>
                </span>
                {s.current && <Badge tone="info">{thisDevice}</Badge>}
                <ChevronLeft className="h-4 w-4 shrink-0 text-muted ltr:rotate-180" />
              </button>
            </li>
          );
        })}
      </ul>
      <Sheet
        open={!!open}
        onClose={() => setOpen(null)}
        title={w.title}
        footer={
          open && !open.current ? (
            <Button
              className="w-full"
              variant="danger"
              icon={<LogOut className="h-4 w-4 flip-rtl" />}
              onClick={async () => {
                await onRevoke(open);
                setOpen(null);
              }}
            >
              {revoke}
            </Button>
          ) : undefined
        }
      >
        {open && d && (
          <div>
            <div className="mb-5 flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-sky/10 text-sky">
                <Icon kind={d.kind} className="h-7 w-7" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-lg">{w.on.replace('{b}', d.app ? w.app : d.browser).replace('{o}', d.os)}</p>
                {open.current && <Badge tone="info">{w.current}</Badge>}
              </div>
            </div>
            <dl className="divide-y divide-line rounded-2xl bg-sunk/60 px-4 text-sm">
              {(
                [
                  [w.kind, w[d.kind]],
                  [w.via, d.app ? w.app : w.web],
                  [w.browser, d.browser],
                  [w.system, d.os],
                  [w.ip, <span dir="ltr" className="num">{open.ip_address ?? '—'}</span>],
                  [w.first, full(open.created_at)],
                  [w.last, full(open.last_used_at ?? open.created_at)],
                  [w.until, full(open.expires_at)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-muted">{k}</dt>
                  <dd className="min-w-0 truncate text-end">{v}</dd>
                </div>
              ))}
            </dl>
            <details className="mt-4 text-xs text-muted">
              <summary className="cursor-pointer select-none">{w.raw}</summary>
              <p dir="ltr" className="mt-2 break-all rounded-xl bg-sunk p-3 font-mono">
                {open.user_agent ?? '—'}
              </p>
            </details>
          </div>
        )}
      </Sheet>
    </>
  );
}
