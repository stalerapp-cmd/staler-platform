import { useState } from 'react';
import { Laptop, LogOut, MapPin, MonitorSmartphone, ShieldOff, Smartphone, Tablet } from 'lucide-react';
import { post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { fill, relative } from '../lib/format';
import { parseDevice } from '../lib/device';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';
import { MapView } from './MapView';
import { Badge, Button, Sheet, Skeleton, cx } from './ui';

/** Strings for the device history (kept here: only admins see this panel). */
const W = {
  en: {
    title: 'Devices used', none: 'No sign-ins recorded yet.', live: 'Signed in', liveN: 'Signed in · {n} session(s)', ended: 'Signed out', app: 'App', detail: 'Device details',
    kind: 'Device', kinds: { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' } as Record<string, string>, browser: 'Browser', system: 'System', signIns: 'Sign-ins from it',
    first: 'First seen', last: 'Last seen', firstIp: 'First network address', lastIp: 'Last network address', allIps: 'Network addresses used', raw: 'Technical details',
    sDevices: 'Devices', sLive: 'Signed in now', sAddresses: 'Network addresses', sCities: 'Cities', s24h: 'Sign-ins, 24 h',
    wForeign: 'Signed in from outside Palestine: {list}', wMany: '{n} sign-ins in the last 24 hours — unusually many.', wAddr: '{n} different network addresses — check for shared or stolen access.',
    mapTitle: 'Where it signed in from', noMap: 'No place known yet for this device’s addresses.', accuracy: 'Places come from the network address, so they are approximate (usually the city or the provider’s nearest exchange, within a few kilometres) — not a GPS position.',
    placesTitle: 'Places and how often', internal: 'Internal address (recorded before the fix) — place unknown', unknownPlace: 'Place not known yet', timeline: 'Recent sign-ins',
    out: 'Sign out of this device', outQ: 'Sign out of this device only?', outB: '{device} is signed out right away. Their other devices stay signed in.', outDone: 'Signed out ({n} session(s) closed)',
  },
  ar: {
    title: 'الأجهزة المستخدمة', none: 'ما في دخول مسجّل لسا.', live: 'داخل هلأ', liveN: 'داخل هلأ · {n} جلسة', ended: 'طالع', app: 'التطبيق', detail: 'تفاصيل الجهاز',
    kind: 'نوع الجهاز', kinds: { phone: 'جوال', tablet: 'تابلت', computer: 'كمبيوتر' } as Record<string, string>, browser: 'المتصفح', system: 'النظام', signIns: 'مرات الدخول منه',
    first: 'أول مرة', last: 'آخر مرة', firstIp: 'أول عنوان شبكة', lastIp: 'آخر عنوان شبكة', allIps: 'عناوين الشبكة اللي استخدمها', raw: 'تفاصيل تقنية',
    sDevices: 'الأجهزة', sLive: 'داخل هلأ', sAddresses: 'عناوين الشبكة', sCities: 'المدن', s24h: 'دخول آخر 24 ساعة',
    wForeign: 'في دخول من برّا فلسطين: {list}', wMany: '{n} مرة دخول بآخر 24 ساعة — كثير عن العادي.', wAddr: '{n} عنوان شبكة مختلف — تأكد إنه الحساب مش مشترك أو مسروق.',
    mapTitle: 'من وين دخل', noMap: 'ما في مكان معروف لعناوين هالجهاز لسا.', accuracy: 'الأماكن مأخوذة من عنوان الشبكة، فهي تقريبية (عادة المدينة أو أقرب مقسم لمزوّد الإنترنت، ضمن كم كيلومتر) — مش موقع GPS.',
    placesTitle: 'الأماكن وقديش تكرر', internal: 'عنوان داخلي (انسجّل قبل التصليح) — المكان مش معروف', unknownPlace: 'المكان مش معروف لسا', timeline: 'آخر مرات الدخول',
    out: 'طلّعه من هالجهاز', outQ: 'تطلّعه من هالجهاز بس؟', outB: '{device} بيطلع فورًا. باقي أجهزته بتضل داخلة.', outDone: 'انطلع ({n} جلسة انسكّرت)',
  },
};

/**
 * Every device a person signed in from, where each one connected from (approximate,
 * from the network address) and how often — for spotting account takeovers.
 */
const flag = (cc?: string | null) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

export function AdminDevicesPanel({ userId, canSignOut }: { userId: string; canSignOut: boolean }) {
  const { lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useData<{ devices: any[]; summary: any }>(`/api/admin/users/${userId}/devices`, [userId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const D = W[lang === 'ar' ? 'ar' : 'en'];
  const open = data?.devices.find((d) => d.id === openId) ?? null;
  const full = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar-PS' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const placeName = (p: any) => (p.city ? [p.city, p.region && p.region !== p.city ? p.region : null, p.country].filter(Boolean).join('، ') : null);
  const signOut = async (d: any) => {
    const p = parseDevice(d.user_agent);
    if (!(await confirm({ title: D.outQ, body: fill(D.outB, { device: `${p.browser} · ${p.os}` }), confirmLabel: D.out, tone: 'danger' }))) return;
    try {
      const r = await post(`/api/admin/users/${userId}/devices/${d.id}/sign-out`);
      toast(fill(D.outDone, { n: r.sessions }));
      setOpenId(null);
      void reload();
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const Icon = ({ kind, className }: { kind: string; className?: string }) => (kind === 'phone' ? <Smartphone className={className} /> : kind === 'tablet' ? <Tablet className={className} /> : <Laptop className={className} />);
  const od = open ? parseDevice(open.user_agent) : null;
  const sm = data?.summary;
  const located = (open?.places ?? []).filter((p: any) => p.lat != null);
  const maxHits = Math.max(1, ...(open?.places ?? []).map((p: any) => p.hits));

  return (
    <section className="card overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-line px-5 py-4 text-lg">
        <MonitorSmartphone className="h-5 w-5 text-sky" /> {D.title}
      </h2>
      {sm && (
        <div className="border-b border-line bg-sunk/40 p-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[
              [D.sDevices, sm.devices],
              [D.sLive, sm.live],
              [D.sAddresses, sm.addresses],
              [D.sCities, sm.cities.length],
              [D.s24h, sm.signins24h],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-surface px-3 py-2 ring-1 ring-line/60">
                <p className="text-[11px] leading-tight text-muted">{k}</p>
                <p className="num mt-0.5 text-lg font-bold">{v}</p>
              </div>
            ))}
          </div>
          {(sm.foreign || sm.signins24h >= 10 || sm.addresses >= 15) && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-gold/15 px-3 py-2.5 text-sm">
              <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(150_105_10)] dark:text-gold" />
              <div className="space-y-0.5">
                {sm.foreign && <p>{fill(D.wForeign, { list: sm.countries.filter((c: string) => c !== 'PS' && c !== 'IL').map((c: string) => `${flag(c)} ${c}`).join('  ') })}</p>}
                {sm.signins24h >= 10 && <p>{fill(D.wMany, { n: sm.signins24h })}</p>}
                {sm.addresses >= 15 && <p>{fill(D.wAddr, { n: sm.addresses })}</p>}
              </div>
            </div>
          )}
          {sm.cities.length > 0 && (
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <MapPin className="h-3.5 w-3.5" />
              {sm.cities.slice(0, 8).map((c: string) => (
                <span key={c} className="rounded-full bg-surface px-2 py-0.5 ring-1 ring-line/60">
                  {c}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {!data ? (
        <Skeleton className="m-4 h-16" />
      ) : !data.devices.length ? (
        <p className="p-6 text-center text-sm text-muted">{D.none}</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.devices.map((d) => {
            const p = parseDevice(d.user_agent);
            const live = d.active_sessions > 0;
            const lastPlace = d.places?.find((x: any) => x.city);
            return (
              <li key={d.id}>
                <button type="button" onClick={() => setOpenId(d.id)} className="flex w-full items-center gap-3 px-5 py-3 text-start transition hover:bg-sunk/60">
                  <span className={cx('relative grid h-11 w-11 shrink-0 place-items-center rounded-xl', live ? 'bg-olive/15 text-olive' : 'bg-sunk text-muted')}>
                    <Icon kind={p.kind} className="h-5 w-5" />
                    {live && <span className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-olive ring-2 ring-surface" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {p.app ? D.app : p.browser} · {p.os}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-muted">
                      <span>
                        {D.last} {relative(d.last_seen, lang)}
                      </span>
                      {lastPlace && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {flag(lastPlace.country_code)} {lastPlace.city}
                        </span>
                      )}
                      <span className="num">×{d.sign_ins}</span>
                    </span>
                  </span>
                  {live ? <Badge tone="good">{D.live}</Badge> : <Badge tone="neutral">{D.ended}</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        wide
        open={!!open}
        onClose={() => setOpenId(null)}
        title={D.detail}
        footer={
          open && canSignOut && open.active_sessions > 0 ? (
            <Button className="w-full" variant="danger" icon={<LogOut className="h-4 w-4 flip-rtl" />} onClick={() => signOut(open)}>
              {D.out}
            </Button>
          ) : undefined
        }
      >
        {open && od && (
          <div className="space-y-5">
            {/* Identity */}
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-sky/10 text-sky">
                <Icon kind={od.kind} className="h-7 w-7" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xl">
                  {od.app ? D.app : od.browser} · {od.os}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {open.active_sessions > 0 ? <Badge tone="good">{fill(D.liveN, { n: open.active_sessions })}</Badge> : <Badge tone="neutral">{D.ended}</Badge>}
                  <Badge tone="info">{D.kinds[od.kind]}</Badge>
                </div>
              </div>
            </div>

            {/* Key numbers */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [D.signIns, String(open.sign_ins)],
                [D.sAddresses, String(open.places?.length ?? 0)],
                [D.first, full(open.first_seen)],
                [D.last, full(open.last_seen)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-sunk/70 px-3 py-2.5">
                  <p className="text-[11px] text-muted">{k}</p>
                  <p className="num mt-0.5 text-sm font-semibold leading-snug">{v}</p>
                </div>
              ))}
            </div>

            {/* Map */}
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4 text-stitch" /> {D.mapTitle}
              </h3>
              {located.length ? (
                <MapView
                  className="h-64 rounded-2xl"
                  zoom={8}
                  pins={located.map((x: any) => ({ id: x.ip, lat: x.lat, lng: x.lng, kind: 'agent' as const, label: `${x.city ?? x.ip} · ×${x.hits}` }))}
                />
              ) : (
                <p className="rounded-2xl bg-sunk/60 p-4 text-center text-sm text-muted">{D.noMap}</p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-muted">{D.accuracy}</p>
            </section>

            {/* Places with frequency */}
            <section>
              <h3 className="mb-2 text-sm font-semibold">{D.placesTitle}</h3>
              <ul className="overflow-hidden rounded-2xl ring-1 ring-line">
                {(open.places ?? []).map((x: any) => {
                  const priv = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(x.ip);
                  return (
                    <li key={x.ip} className="border-b border-line px-3.5 py-3 last:border-b-0">
                      <div className="flex items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sunk text-base">{flag(x.country_code) || <MapPin className="h-4 w-4 text-muted" />}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{placeName(x) ?? (priv ? D.internal : D.unknownPlace)}</p>
                          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                            <span dir="ltr" className="num">
                              {x.ip}
                            </span>
                            {x.isp && <span className="truncate">{x.isp}</span>}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted">
                            {full(x.first_seen)} ← {full(x.last_seen)}
                          </p>
                        </div>
                        <div className="w-16 shrink-0 text-end">
                          <p className="num text-sm font-bold">×{x.hits}</p>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunk">
                            <div className="h-full rounded-full bg-stitch" style={{ width: `${Math.max(8, (x.hits / maxHits) * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Timeline */}
            {open.signins?.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold">{D.timeline}</h3>
                <ol className="relative space-y-2.5 border-s-2 border-dashed border-line ps-4">
                  {open.signins.map((x: any, i: number) => (
                    <li key={i} className="relative">
                      <span className="absolute -start-[1.4rem] top-1.5 h-2.5 w-2.5 rotate-45 bg-stitch ring-4 ring-surface" />
                      <p className="text-sm">
                        <span className="font-medium">{full(x.at)}</span>
                        <span className="text-muted"> · {x.city ? `${flag(x.country)} ${x.city}` : <span dir="ltr">{x.ip ?? '—'}</span>}</span>
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none">{D.raw}</summary>
              <p dir="ltr" className="mt-2 break-all rounded-xl bg-sunk p-3 font-mono">
                {open.user_agent ?? '—'}
              </p>
            </details>
          </div>
        )}
      </Sheet>
    </section>
  );
}
