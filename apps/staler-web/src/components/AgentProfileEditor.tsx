import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownToLine, ArrowUpFromLine, CircleCheck, Clock, Hourglass, LocateFixed, MapPin, PauseCircle, Phone, Store, type LucideIcon } from 'lucide-react';
import { put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { useToast } from './Toast';
import { MapView } from './MapView';
import { OptionCard } from './Choice';
import { TownField, govOf } from './TownField';
import { Avatar, Button, ErrorNote, Field, Skeleton, cx } from './ui';

const W = {
  ar: {
    title: 'ملف الوكيل',
    lead: 'هاد اللي بتشوفه الناس على خريطة وكلاء الصرف.',
    preview: 'هيك بيبين كرتك للناس',
    where: 'وين بتلاقيك الناس',
    contact: 'التواصل والدوام',
    services: 'شو بتقدّم',
    cashInD: 'الزبون بيعطيك كاش، وانت بتحوّله لرصيد بمحفظته.',
    cashOutD: 'الزبون بيحوّلك من رصيده، وانت بتعطيه كاش.',
    locate: 'حط المؤشر على مكاني',
    locating: 'عم نحدد موقعك…',
    noGeo: 'ما قدرنا نحدد موقعك. اكبس على الخريطة بمكان محلك.',
    pinHint: 'اكبس على الخريطة بالمكان اللي الناس بتلاقيك فيه بالضبط.',
    noPin: 'لسا ما حطيت مكانك على الخريطة',
    hoursQuick: ['السبت–الخميس 9:00–20:00', 'كل يوم 8:00–22:00', '24 ساعة'],
    status: {
      active: ['ظاهر على الخريطة', 'الناس بتقدر تلاقيك وتيجيك هلأ.'],
      pending: ['بستنى موافقة الإدارة', 'عبّي ملفك وحط مكانك، وأول ما توافق الإدارة بتبين على الخريطة.'],
      suspended: ['موقوف عن الخريطة', 'الإدارة شالتك عن الخريطة مؤقتًا. تواصل مع الدعم لتعرف السبب.'],
    } as Record<string, [string, string]>,
    save: 'احفظ الملف',
    saved: 'انحفظ ملفك',
  },
  en: {
    title: 'Agent profile',
    lead: 'This is what people see on the cash agents map.',
    preview: 'How your card looks to people',
    where: 'Where people find you',
    contact: 'Contact and hours',
    services: 'What you offer',
    cashInD: 'The customer hands you cash; you turn it into balance in their wallet.',
    cashOutD: 'The customer sends you balance; you hand them cash.',
    locate: 'Put the pin where I am',
    locating: 'Finding you…',
    noGeo: 'Couldn’t find your location. Tap the map where your shop is.',
    pinHint: 'Tap the map exactly where people can find you.',
    noPin: 'You haven’t placed yourself on the map yet',
    hoursQuick: ['Sat–Thu 9:00–20:00', 'Every day 8:00–22:00', '24 hours'],
    status: {
      active: ['On the map', 'People can find you and come to you now.'],
      pending: ['Waiting for approval', 'Fill in your profile and place your pin; once the team approves you, you appear on the map.'],
      suspended: ['Taken off the map', 'The team took you off the map for now. Contact support to learn why.'],
    } as Record<string, [string, string]>,
    save: 'Save profile',
    saved: 'Profile saved',
  },
};

const STATUS_LOOK: Record<string, { icon: LucideIcon; c: string }> = {
  active: { icon: CircleCheck, c: 'bg-olive/12 text-olive ring-olive/25' },
  pending: { icon: Hourglass, c: 'bg-gold/15 text-[rgb(150_105_10)] ring-gold/30 dark:text-gold' },
  suspended: { icon: PauseCircle, c: 'bg-stitch/10 text-stitch ring-stitch/25' },
};

function Block({ icon: Icon, title, children, tone }: { icon: LucideIcon; title: string; children: ReactNode; tone: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
      <h3 className="mb-4 flex items-center gap-3 text-lg">
        <span className={cx('grid h-9 w-9 place-items-center rounded-xl', tone)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {title}
      </h3>
      {children}
    </motion.section>
  );
}

/** The cash agent's public listing: what people see on the agents map, edited in one place. */
export function AgentProfileEditor() {
  const { t, lang, err } = useI18n();
  const { user } = useAuth();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const toast = useToast();
  const data = useData<{ profile: any }>('/api/exchange/profile');
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (data.data && !f) {
      const p = data.data.profile;
      setF({ displayName: p.display_name ?? '', city: p.city ?? '', address: p.address ?? '', phone: p.phone ?? '', hours: p.hours ?? '', lat: p.lat, lng: p.lng, cashIn: p.cash_in, cashOut: p.cash_out });
    }
  }, [data.data, f]);
  if (!f) return <Skeleton className="h-96 rounded-3xl" />;
  const status: string = data.data?.profile.status ?? 'pending';
  const look = STATUS_LOOK[status] ?? STATUS_LOOK.pending!;
  const [sTitle, sLead] = w.status[status] ?? w.status.pending!;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const gov = f.city ? govOf(f.city) : undefined;
  const placeLine = [f.city, gov && gov.ar !== f.city ? (lang === 'ar' ? gov.ar : gov.en) : null, f.address].filter(Boolean).join(' · ');

  const locate = () => {
    if (!navigator.geolocation) return toast(w.noGeo, 'error');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setF((x: any) => ({ ...x, lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }));
      },
      () => {
        setLocating(false);
        toast(w.noGeo, 'error');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await put('/api/exchange/profile', {
        displayName: f.displayName.trim(),
        city: f.city.trim() || null,
        address: f.address.trim() || null,
        phone: f.phone.trim() || null,
        hours: f.hours.trim() || null,
        lat: f.lat ?? null,
        lng: f.lng ?? null,
        cashIn: f.cashIn,
        cashOut: f.cashOut,
      });
      toast(w.saved);
      void data.reload();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      {/* Status + live preview of the public card */}
      <section className="card overflow-hidden">
        <div className="relative overflow-hidden bg-night px-5 pb-5 pt-5 text-white sm:px-6 dark:bg-white/[0.04]">
          <span className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full border border-dashed border-gold/30" />
          <span className="pointer-events-none absolute -end-2 top-6 h-20 w-20 rounded-full border border-gold/20" />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">{w.title}</h2>
              <p className="mt-1 text-sm text-white/65">{w.lead}</p>
            </div>
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1', look.c, 'bg-white/95')}>
              <look.icon className="h-4 w-4" /> {sTitle}
            </span>
          </div>
          <p className="relative mt-3 max-w-lg text-xs leading-relaxed text-white/55">{sLead}</p>
        </div>
        <div className="px-4 pb-5 pt-4 sm:px-6">
          <p className="mb-2 text-xs font-medium text-muted">{w.preview}</p>
          <div className="rounded-3xl bg-bg/60 p-4 ring-1 ring-line">
            <div className="flex items-center gap-3">
              <Avatar name={f.displayName || user?.full_name} src={data.data?.profile.logo_url ?? user?.profile_image} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{f.displayName || '—'}</p>
                <p className="truncate text-sm text-muted">{placeLine || '—'}</p>
                {f.hours && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                    <Clock className="h-3.5 w-3.5" /> {f.hours}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {f.cashIn && <span className="rounded-full bg-olive/12 px-2.5 py-1 text-xs font-medium text-olive">{t.agent.cashIn}</span>}
              {f.cashOut && <span className="rounded-full bg-sky/10 px-2.5 py-1 text-xs font-medium text-sky">{t.agent.cashOut}</span>}
              {f.lat == null && <span className="rounded-full bg-stitch/10 px-2.5 py-1 text-xs font-medium text-stitch">{w.noPin}</span>}
            </div>
          </div>
        </div>
      </section>

      {/* Where */}
      <Block icon={MapPin} title={w.where} tone="bg-stitch/10 text-stitch">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.agent.displayName} value={f.displayName} onChange={set('displayName')} required minLength={2} maxLength={60} className="sm:col-span-2" />
          <TownField label={t.mstore.city} value={f.city} onChange={(v) => setF({ ...f, city: v })} />
          <Field label={t.mstore.address} value={f.address} onChange={set('address')} maxLength={160} />
        </div>
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink/80">{t.agent.pin}</p>
            <button type="button" onClick={locate} className="inline-flex items-center gap-1.5 rounded-full bg-sky/10 px-3 py-1.5 text-xs font-semibold text-sky transition hover:bg-sky/15">
              {locating ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky border-t-transparent" /> : <LocateFixed className="h-3.5 w-3.5" />}
              {locating ? w.locating : w.locate}
            </button>
          </div>
          <MapView
            className="h-72 rounded-2xl sm:h-80"
            zoom={15}
            pins={f.lat != null && f.lng != null ? [{ lat: f.lat, lng: f.lng, kind: 'store', id: 'me', label: f.displayName }] : []}
            onPick={(p) => setF({ ...f, lat: p.lat, lng: p.lng })}
          />
          <p className="mt-2 text-xs text-muted">{w.pinHint}</p>
        </div>
      </Block>

      {/* Contact and hours */}
      <Block icon={Phone} title={w.contact} tone="bg-sky/10 text-sky">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.auth.phone} value={f.phone} onChange={set('phone')} dir="ltr" type="tel" />
          <Field label={t.agent.hours} value={f.hours} onChange={set('hours')} placeholder={t.agent.hoursPh} maxLength={120} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {w.hoursQuick.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setF({ ...f, hours: h })}
              className={cx('rounded-full px-3 py-1.5 text-xs transition', f.hours === h ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80 hover:text-ink')}
            >
              {h}
            </button>
          ))}
        </div>
      </Block>

      {/* Services */}
      <Block icon={Store} title={w.services} tone="bg-olive/12 text-olive">
        <div className="grid gap-3 sm:grid-cols-2">
          <OptionCard checked={f.cashIn} onChange={(v) => setF({ ...f, cashIn: v })} icon={<ArrowDownToLine className="h-5 w-5" />} title={t.agent.cashIn} description={w.cashInD} />
          <OptionCard checked={f.cashOut} onChange={(v) => setF({ ...f, cashOut: v })} icon={<ArrowUpFromLine className="h-5 w-5" />} title={t.agent.cashOut} description={w.cashOutD} />
        </div>
      </Block>

      <ErrorNote>{error}</ErrorNote>
      <div>
        <Button size="lg" block loading={busy}>
          {w.save}
        </Button>
      </div>
    </form>
  );
}
