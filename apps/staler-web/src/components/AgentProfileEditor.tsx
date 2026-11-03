import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownToLine, ArrowUpFromLine, Camera, CircleCheck, Clock, Hourglass, ImagePlus, LocateFixed, MapPin, PauseCircle, Phone, Signpost, Store, Trash2, type LucideIcon } from 'lucide-react';
import { get, put, upload } from '../lib/api';
import { MediaViewer, PlaceStrip, ShotThumb, type PlaceShot } from './PlaceMedia';
import { AgentPlacesEditor, type AgentPlace } from './AgentPlaces';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { useToast } from './Toast';
import { MapView } from './MapView';
import { OptionCard } from './Choice';
import { TownField, govOf } from './TownField';
import { Avatar, Button, ErrorNote, Field, Skeleton, TextArea, cx } from './ui';

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
    pinHint: 'دوّر على مكانك بالبحث فوق الخريطة، أو اكبس على الخريطة بالمكان اللي الناس بتلاقيك فيه بالضبط.',
    noPin: 'لسا ما حطيت مكانك على الخريطة',
    hoursQuick: ['السبت–الخميس 9:00–20:00', 'كل يوم 8:00–22:00', '24 ساعة'],
    status: {
      active: ['ظاهر على الخريطة', 'الناس بتقدر تلاقيك وتيجيك هلأ.'],
      pending: ['بستنى موافقة الإدارة', 'عبّي ملفك وحط مكانك، وأول ما توافق الإدارة بتبين على الخريطة.'],
      suspended: ['موقوف عن الخريطة', 'الإدارة شالتك عن الخريطة مؤقتًا. تواصل مع الدعم لتعرف السبب.'],
    } as Record<string, [string, string]>,
    save: 'احفظ الملف',
    saved: 'انحفظ ملفك',
    shots: 'صور المكان وكيف توصل',
    shotsLead: 'صوّر واجهة المحل والمدخل وأقرب معلم — أو فيديو قصير من الشارع للباب. بتبين للناس لما يفتحوا كرتك على الخريطة.',
    addShot: 'أضف صورة أو فيديو',
    uploading: 'عم نرفع…',
    caption: 'وصف قصير (مثلًا: المدخل من جهة الدوار)',
    maxShots: 'لحد 8 — الصورة لحد 5 ميغا والفيديو لحد 25',
    directions: 'كيف توصلنا',
    directionsPh: 'مثلًا: بجانب مسجد النصر، الطابق الأرضي، باب أزرق',
    remove: 'شيل',
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
    pinHint: 'Search for your place above the map, or tap the map exactly where people can find you.',
    noPin: 'You haven’t placed yourself on the map yet',
    hoursQuick: ['Sat–Thu 9:00–20:00', 'Every day 8:00–22:00', '24 hours'],
    status: {
      active: ['On the map', 'People can find you and come to you now.'],
      pending: ['Waiting for approval', 'Fill in your profile and place your pin; once the team approves you, you appear on the map.'],
      suspended: ['Taken off the map', 'The team took you off the map for now. Contact support to learn why.'],
    } as Record<string, [string, string]>,
    save: 'Save profile',
    saved: 'Profile saved',
    shots: 'Photos of the place and how to get there',
    shotsLead: 'Photograph the shop front, the entrance and the nearest landmark — or a short video from the street to the door. People see them when they open your card on the map.',
    addShot: 'Add a photo or video',
    uploading: 'Uploading…',
    caption: 'Short caption (e.g. entrance from the roundabout side)',
    maxShots: 'Up to 8 — photos up to 5 MB, videos up to 25 MB',
    directions: 'How to find us',
    directionsPh: 'e.g. Next to Al-Nasr mosque, ground floor, blue door',
    remove: 'Remove',
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
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ key: string; lat: number; lng: number; zoom?: number; bbox?: [number, number, number, number] | null } | null>(null);
  const touched = useRef(false);
  // Choosing a city or typing the address moves the map there (the pin stays where it is until you tap).
  useEffect(() => {
    if (!f || !touched.current) return;
    const q = [f.address?.trim(), f.city?.trim()].filter(Boolean).join('، ');
    if (q.length < 2) return;
    const h = setTimeout(async () => {
      try {
        const r = await get<{ results: { lat: number; lng: number; bbox: [number, number, number, number] | null }[] }>(`/api/geo/search?q=${encodeURIComponent(q)}`);
        const top = r.results?.[0];
        if (top) setFocus({ key: `${q}|${Date.now()}`, lat: top.lat, lng: top.lng, zoom: f.address?.trim() ? 17 : 14, bbox: f.address?.trim() ? null : top.bbox });
      } catch {
        /* the map just stays */
      }
    }, 600);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.city, f?.address]);
  useEffect(() => {
    if (data.data && !f) {
      const p = data.data.profile;
      setF({ displayName: p.display_name ?? '', city: p.city ?? '', address: p.address ?? '', phone: p.phone ?? '', hours: p.hours ?? '', lat: p.lat, lng: p.lng, cashIn: p.cash_in, cashOut: p.cash_out, media: (p.media ?? []) as PlaceShot[], directions: p.directions ?? '', places: (p.places ?? []) as AgentPlace[] });
    }
  }, [data.data, f]);
  if (!f) return <Skeleton className="h-96 rounded-3xl" />;
  const status: string = data.data?.profile.status ?? 'pending';
  const look = STATUS_LOOK[status] ?? STATUS_LOOK.pending!;
  const [sTitle, sLead] = w.status[status] ?? w.status.pending!;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (k === 'address') touched.current = true;
    setF({ ...f, [k]: e.target.value });
  };
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

  const addShot = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await upload<{ url: string; kind: 'image' | 'video' }>('/api/exchange/uploads/media', fd);
      setF((x: any) => ({ ...x, media: [...x.media, { url: r.url, kind: r.kind, caption: '' }] }));
    } catch (e2) {
      setError(err(e2));
    } finally {
      setUploading(false);
    }
  };
  const setShot = (i: number, patch: Partial<PlaceShot> | null) =>
    setF((x: any) => ({ ...x, media: patch ? x.media.map((m: PlaceShot, k: number) => (k === i ? { ...m, ...patch } : m)) : x.media.filter((_: PlaceShot, k: number) => k !== i) }));

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
        media: f.media.map((m: PlaceShot) => ({ url: m.url, kind: m.kind, caption: (m.caption ?? '').trim() })),
        directions: f.directions.trim() || null,
        places: f.places
          .filter((x: AgentPlace) => x.name.trim().length >= 2)
          .map((x: AgentPlace) => ({ name: x.name.trim(), city: x.city?.trim() || null, address: x.address?.trim() || null, lat: x.lat, lng: x.lng, days: x.days, hours: x.hours?.trim() || null, directions: x.directions?.trim() || null })),
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
            {f.directions.trim() && (
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink/75">
                <Signpost className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stitch" /> {f.directions}
              </p>
            )}
            <PlaceStrip media={f.media} onOpen={setView} className="mt-3" />
          </div>
        </div>
      </section>

      {/* Where */}
      <Block icon={MapPin} title={w.where} tone="bg-stitch/10 text-stitch">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.agent.displayName} value={f.displayName} onChange={set('displayName')} required minLength={2} maxLength={60} className="sm:col-span-2" />
          <TownField
            label={t.mstore.city}
            value={f.city}
            onChange={(v) => {
              touched.current = true;
              setF({ ...f, city: v });
            }}
          />
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
            search
            onSearchPick={(p) => setF((x: any) => ({ ...x, lat: p.lat, lng: p.lng }))}
            focus={focus}
          />
          <p className="mt-2 text-xs text-muted">{w.pinHint}</p>
        </div>
      </Block>

      {/* Photos of the place + directions */}
      <Block icon={Camera} title={w.shots} tone="bg-gold/15 text-[rgb(150_105_10)] dark:text-gold">
        <p className="-mt-2 mb-4 text-sm leading-relaxed text-muted">{w.shotsLead}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {f.media.map((m: PlaceShot, i: number) => (
            <motion.div key={m.url} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
              <button type="button" onClick={() => setView(i)} className="block w-full">
                <ShotThumb m={m} className="aspect-[4/3] w-full" />
              </button>
              <div className="flex items-center gap-1 p-1.5">
                <input
                  value={m.caption ?? ''}
                  onChange={(e) => setShot(i, { caption: e.target.value })}
                  maxLength={80}
                  placeholder={w.caption}
                  className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted/70 focus:bg-sunk"
                />
                <button type="button" onClick={() => setShot(i, null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-stitch/10 hover:text-stitch" aria-label={w.remove} title={w.remove}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ))}
          {f.media.length < 8 && (
            <label className={cx('grid aspect-[4/3] cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-line text-center transition hover:border-stitch/50 hover:bg-stitch/[0.03]', uploading && 'pointer-events-none opacity-60')}>
              <span className="px-2">
                {uploading ? (
                  <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-stitch border-t-transparent" />
                ) : (
                  <ImagePlus className="mx-auto h-7 w-7 text-stitch" />
                )}
                <span className="mt-2 block text-sm font-medium">{uploading ? w.uploading : w.addShot}</span>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void addShot(file);
                }}
              />
            </label>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">{w.maxShots}</p>
        <div className="mt-5">
          <TextArea label={w.directions} value={f.directions} onChange={(e) => setF({ ...f, directions: e.target.value })} placeholder={w.directionsPh} maxLength={400} rows={2} />
        </div>
      </Block>

      {/* Other places */}
      <Block icon={MapPin} title={lang === 'ar' ? 'أماكن ثانية بتتواجد فيها' : 'Other places you work from'} tone="bg-gold/15 text-[rgb(150_105_10)] dark:text-gold">
        <p className="-mt-2 mb-4 text-sm leading-relaxed text-muted">
          {lang === 'ar' ? 'عندك محل ثاني، أو بتكون أيام هون وأيام هناك؟ أضف كل مكان مع أيامه — الناس بتشوفه على الخريطة ومعلّم عليه «اليوم هون».' : 'A second shop, or some days here and some there? Add each place with its days — people see it on the map marked “Here today”.'}
        </p>
        <AgentPlacesEditor value={f.places} onChange={(v) => setF({ ...f, places: v })} />
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

      <MediaViewer media={f.media} index={view} title={f.displayName} onClose={() => setView(null)} />
      <ErrorNote>{error}</ErrorNote>
      <div>
        <Button size="lg" block loading={busy}>
          {w.save}
        </Button>
      </div>
    </form>
  );
}
