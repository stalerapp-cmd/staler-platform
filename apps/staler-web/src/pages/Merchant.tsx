import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera,
  ImagePlus,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileSearch,
  FileUp,
  GitBranch,
  ImageUp,
  KeyRound,
  LocateFixed,
  MapPin,
  Megaphone,
  Navigation,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  ScanLine,
  Share2,
  Store as StoreIcon,
  Trash2,
  Truck,
  Video,
  XCircle,
} from 'lucide-react';
import { assetUrl, currentStore, del, get, patch, post, put, upload, PUBLIC_ORIGIN } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { AMOUNT_RE, date, fill, money, relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { AreaChart, BarList } from '../components/Chart';
import { MapView, type Pin } from '../components/MapView';
import { ShareSheet } from '../components/Share';
import { Scanner } from '../components/Scanner';
import { AmountInput, Badge, Button, Chips, CodeInput, EmptyState, ErrorNote, Field, PageHeader, Select, Sheet, Skeleton, TextArea, Toggle, cx } from '../components/ui';
import { CATEGORIES, StoreCover, StoreLogo } from './Stores';
import { ImageCropper } from '../components/ImageCropper';

interface MStore {
  id: string;
  slug: string;
  store_name: string;
  branch_name: string | null;
  parent_id: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  category: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  show_phone: boolean;
  accent: string | null;
  delivery_note: string | null;
  offers_pickup: boolean;
  offers_delivery: boolean;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
}

/** All stores of this merchant + the one being worked on (sent as X-Store-Id). */
function useStores() {
  const r = useData<{ stores: MStore[] }>('/api/merchant/stores');
  const stores = r.data?.stores ?? [];
  const [cur, setCur] = useState<string | null>(currentStore.get());
  const current = stores.find((s) => s.id === cur) ?? stores[0] ?? null;
  useEffect(() => {
    if (current && current.id !== currentStore.get()) currentStore.set(current.id);
  }, [current]);
  return {
    ...r,
    stores,
    current,
    pick: (id: string) => {
      currentStore.set(id);
      setCur(id);
    },
  };
}

const label = (s: MStore, t: any) => (s.parent_id ? `${s.store_name} · ${s.branch_name ?? t.shop.branch}` : s.store_name);

function StoreSwitcher({ st }: { st: ReturnType<typeof useStores> }) {
  const { t } = useI18n();
  if (st.stores.length < 2 || !st.current) return null;
  return (
    <Select
      label={t.mstore.current}
      value={st.current.id as any}
      onChange={(v) => st.pick(v)}
      icon={<StoreIcon className="h-4 w-4" />}
      options={st.stores.map((s) => ({ value: s.id, label: label(s, t), hint: s.city ?? undefined }))}
      className="min-w-[220px]"
    />
  );
}

async function uploadTo(path: string, field: string, f: File) {
  const fd = new FormData();
  fd.append(field, f);
  return upload(path, fd);
}

// ------------------------------------------------------------ store editor
const ACCENTS = ['#141B3D', '#5A1424', '#2F3F18', '#1C3B4A', '#4A2C10', '#7A2E8C', '#0F5F5C', '#B34A1E'];

function StoreEditor({ open, onClose, store, parent, onSaved }: { open: boolean; onClose: () => void; store?: MStore | null; parent?: MStore | null; onSaved: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<{ kind: 'logo' | 'cover'; file: File } | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(
      store
        ? {
            storeName: store.store_name,
            branchName: store.branch_name ?? '',
            description: store.description ?? '',
            category: store.category ?? 'other',
            city: store.city ?? '',
            address: store.address ?? '',
            phone: store.phone ?? '',
            showPhone: store.show_phone,
            accent: store.accent ?? ACCENTS[0],
            deliveryNote: store.delivery_note ?? '',
            offersPickup: store.offers_pickup,
            offersDelivery: store.offers_delivery,
            logoUrl: store.logo_url,
            coverUrl: store.cover_url,
            lat: store.lat,
            lng: store.lng,
            instagram: store.instagram ?? '',
            tiktok: store.tiktok ?? '',
            facebook: store.facebook ?? '',
          }
        : {
            storeName: parent?.store_name ?? '',
            branchName: '',
            description: parent?.description ?? '',
            category: parent?.category ?? 'other',
            city: '',
            address: '',
            phone: parent?.phone ?? '',
            showPhone: parent?.show_phone ?? false,
            accent: parent?.accent ?? ACCENTS[0],
            deliveryNote: '',
            offersPickup: true,
            offersDelivery: true,
            logoUrl: parent?.logo_url ?? null,
            coverUrl: parent?.cover_url ?? null,
            lat: null,
            lng: null,
            instagram: parent?.instagram ?? '',
            tiktok: parent?.tiktok ?? '',
            facebook: parent?.facebook ?? '',
          },
    );
  }, [open, store, parent]);
  if (!f) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const isBranch = Boolean(parent || store?.parent_id);
  const up = async (kind: 'logo' | 'cover', file: File) => {
    setBusy(kind);
    try {
      const r = await uploadTo('/api/merchant/uploads/image', 'image', file);
      setF((x: any) => ({ ...x, [kind === 'logo' ? 'logoUrl' : 'coverUrl']: r.url }));
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(null);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    const body: any = {
      storeName: f.storeName.trim(),
      description: f.description.trim(),
      category: f.category,
      city: f.city.trim() || null,
      address: f.address.trim() || null,
      phone: f.phone.trim() || null,
      showPhone: f.showPhone,
      accent: f.accent,
      deliveryNote: f.deliveryNote.trim() || null,
      offersPickup: f.offersPickup,
      offersDelivery: f.offersDelivery,
      logoUrl: f.logoUrl,
      coverUrl: f.coverUrl,
      lat: f.lat,
      lng: f.lng,
      instagram: f.instagram.trim() || null,
      tiktok: f.tiktok.trim() || null,
      facebook: f.facebook.trim() || null,
      ...(isBranch && f.branchName.trim() ? { branchName: f.branchName.trim() } : {}),
    };
    try {
      if (store) await patch(`/api/merchant/stores/${store.id}`, body);
      else await post('/api/merchant/stores', { ...body, ...(parent ? { parentId: parent.id } : {}) });
      toast(t.common.saved);
      onSaved();
      onClose();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={store ? t.mstore.editStore : parent ? t.mstore.newBranch : t.mstore.newStore} wide>
      <form onSubmit={save} className="space-y-5">
        <div className="relative overflow-hidden rounded-3xl">
          <button type="button" onClick={() => coverRef.current?.click()} className="block w-full">
            <StoreCover s={{ cover_url: f.coverUrl, accent: f.accent, store_name: f.storeName || 'S' }} className="h-36" />
            <span className="absolute end-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white backdrop-blur">
              <Camera className="h-3.5 w-3.5" /> {busy === 'cover' ? '…' : t.mstore.cover}
            </span>
          </button>
          <button type="button" onClick={() => logoRef.current?.click()} className="group absolute bottom-3 start-3" aria-label={t.mstore.logo}>
            <span className="block rounded-[1.3rem] ring-4 ring-surface transition group-hover:scale-105">
              <StoreLogo s={{ logo_url: f.logoUrl, store_name: f.storeName || 'S', accent: f.accent }} size={80} />
            </span>
            <span className="absolute -bottom-1 -end-1 grid h-8 w-8 place-items-center rounded-full bg-stitch text-white shadow-lift">
              {busy === 'logo' ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Camera className="h-4 w-4" />}
            </span>
          </button>
          <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => (e.target.files?.[0] && setCrop({ kind: 'cover', file: e.target.files[0] }), (e.target.value = ''))} />
          <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => (e.target.files?.[0] && setCrop({ kind: 'logo', file: e.target.files[0] }), (e.target.value = ''))} />
          <ImageCropper
            file={crop?.file ?? null}
            shape={crop?.kind === 'cover' ? 'wide' : 'square'}
            onCancel={() => setCrop(null)}
            onConfirm={async (blob) => {
              const kind = crop!.kind;
              await up(kind, new File([blob], `${kind}.jpg`, { type: blob.type }));
              setCrop(null);
            }}
          />
        </div>
        {!f.logoUrl && (
          <button
            type="button"
            onClick={() => logoRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-stitch/40 bg-stitch/5 p-3.5 text-start transition hover:border-stitch"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-stitch text-white">
              <ImagePlus className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-medium">{t.mstore.logoAdd}</span>
              <span className="block text-sm text-muted">{t.mstore.logoAddD}</span>
            </span>
          </button>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.merchant.storeName} value={f.storeName} onChange={(e) => setF({ ...f, storeName: e.target.value })} required minLength={2} maxLength={60} />
          {isBranch ? (
            <Field label={t.mstore.branchName} value={f.branchName} onChange={(e) => setF({ ...f, branchName: e.target.value })} required minLength={2} maxLength={60} />
          ) : (
            <Select block label={t.mstore.category} value={f.category} onChange={(v) => setF({ ...f, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: t.shop.cat[c] }))} />
          )}
          <Field label={t.mstore.city} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} maxLength={60} />
          <Field label={t.mstore.address} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={200} />
          <Field label={t.mstore.storePhone} type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <div className="flex items-end">
            <Toggle checked={f.showPhone} onChange={(v) => setF({ ...f, showPhone: v })} label={t.mstore.showPhone} />
          </div>
        </div>
        <TextArea label={t.merchant.description} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} rows={3} />
        <div>
          <p className="mb-2 text-sm font-medium text-ink/80">{t.mstore.accent}</p>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setF({ ...f, accent: c })}
                className={cx('h-9 w-9 rounded-full ring-offset-2 ring-offset-bg transition', f.accent === c ? 'ring-2 ring-ink' : 'hover:scale-110')}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle checked={f.offersDelivery} onChange={(v) => setF({ ...f, offersDelivery: v })} label={t.mstore.deliveryOn} />
          <Toggle checked={f.offersPickup} onChange={(v) => setF({ ...f, offersPickup: v })} label={t.mstore.pickupOn} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink/80">{t.social.title}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['instagram', 'tiktok', 'facebook'] as const).map((k) => (
              <Field key={k} label={t.social[k]} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} dir="ltr" placeholder="@" maxLength={80} />
            ))}
          </div>
        </div>
        {f.offersDelivery && <Field label={t.mstore.deliveryNote} value={f.deliveryNote} onChange={(e) => setF({ ...f, deliveryNote: e.target.value })} maxLength={200} />}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink/80">{t.mstore.pin}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={<LocateFixed className="h-4 w-4" />}
              onClick={() =>
                navigator.geolocation?.getCurrentPosition((p) => setF((x: any) => ({ ...x, lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) })))
              }
            >
              {t.shop.useLocation}
            </Button>
          </div>
          <MapView pins={f.lat != null ? [{ lat: f.lat, lng: f.lng, kind: 'store', label: f.storeName }] : []} onPick={(p) => setF((x: any) => ({ ...x, ...p }))} className="h-52" />
          <p className="mt-1 text-xs text-muted">{t.mstore.pinHint}</p>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy === 'save'}>
          {t.common.save}
        </Button>
      </form>
    </Sheet>
  );
}

function StoreSetup({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="card mx-auto max-w-lg overflow-hidden text-center">
      <StoreCover s={{ store_name: 'S-Taler' }} className="h-40" />
      <div className="space-y-3 p-6">
        <h2 className="text-2xl">{t.merchant.setup}</h2>
        <p className="text-muted">{t.merchant.setupLead}</p>
        <Button block size="lg" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
          {t.merchant.create}
        </Button>
      </div>
      <StoreEditor open={open} onClose={() => setOpen(false)} onSaved={onDone} />
    </div>
  );
}

// --------------------------------------------------------------- dashboard
export function MerchantDashboard() {
  const { t, lang } = useI18n();
  const st = useStores();
  const stats = useData<any>(st.current ? '/api/merchant/stats' : null, [st.current?.id]);
  const [share, setShare] = useState(false);
  const [edit, setEdit] = useState(false);
  if (st.loading && !st.data) return <Skeleton className="h-64 rounded-3xl" />;
  if (!st.current) return <StoreSetup onDone={() => st.reload()} />;
  const s = stats.data?.stats;
  const tiles = [
    { label: t.merchant.revenue, value: money(s?.revenue ?? 0, lang), tone: 'text-olive' },
    { label: t.merchant.escrow, value: money(s?.in_escrow ?? 0, lang), tone: 'text-gold' },
    { label: t.merchant.toShip, value: String(s?.to_ship ?? 0), tone: 'text-stitch' },
    { label: t.merchant.completed, value: String(s?.completed ?? 0), tone: 'text-ink' },
  ];
  return (
    <div>
      <section className="relative mb-6 overflow-hidden rounded-[2rem]">
        <StoreCover s={st.current} className="h-40 sm:h-48" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end gap-4 p-5 text-white">
          <StoreLogo s={st.current} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-3xl">{label(st.current, t)}</h1>
            {st.current.city && (
              <p className="flex items-center gap-1 text-sm text-white/80">
                <MapPin className="h-4 w-4" /> {st.current.city}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Share2 className="h-4 w-4" />} onClick={() => setShare(true)}>
              {t.shop.share}
            </Button>
            <Link to={`/s/${st.current.slug}`}>
              <Button variant="secondary" icon={<Eye className="h-4 w-4" />}>
                {t.shop.visit}
              </Button>
            </Link>
          </div>
        </div>
      </section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <StoreSwitcher st={st} />
        <div className="flex flex-wrap gap-2">
          <Link to="/app/merchant/products">
            <Button icon={<Plus className="h-4 w-4" />}>{t.merchant.newProduct}</Button>
          </Link>
          <Link to="/app/merchant/ads">
            <Button variant="secondary" icon={<Megaphone className="h-4 w-4" />}>
              {t.mstore.ads}
            </Button>
          </Link>
          <Link to="/app/merchant/stores">
            <Button variant="secondary" icon={<GitBranch className="h-4 w-4" />}>
              {t.mstore.stores}
            </Button>
          </Link>
        </div>
      </div>
      {!st.current.logo_url && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setEdit(true)}
          className="sewn mb-5 flex w-full items-center gap-4 rounded-3xl bg-surface p-4 text-start shadow-lift ring-1 ring-line transition hover:-translate-y-0.5"
        >
          <motion.span animate={{ rotate: [0, -8, 8, 0] }} transition={{ repeat: Infinity, duration: 2.4, repeatDelay: 1.5 }} className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-stitch text-white">
            <ImagePlus className="h-6 w-6" />
          </motion.span>
          <span>
            <span className="block font-semibold">{t.mstore.logoAdd}</span>
            <span className="block text-sm text-muted">{t.mstore.logoAddD}</span>
          </span>
        </motion.button>
      )}
      <StoreEditor open={edit} onClose={() => setEdit(false)} store={st.current} onSaved={() => st.reload()} />
      {s?.disputes > 0 && <p className="mb-4 rounded-2xl bg-stitch/10 px-4 py-3 text-sm text-stitch">{t.mstore.disputeOpen}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x, i) => (
          <motion.div key={x.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="card p-4">
            <p className="text-sm text-muted">{x.label}</p>
            <p className={cx('num mt-1 font-display text-2xl', x.tone)}>{x.value}</p>
          </motion.div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <h2 className="mb-4 text-lg">{t.merchant.sales}</h2>
          {stats.data ? (
            <AreaChart
              labels={stats.data.series.map((d: any) => d.day)}
              series={[{ name: t.merchant.sales, color: 'rgb(var(--stitch))', values: stats.data.series.map((d: any) => Number(d.sales)) }]}
              format={(n) => money(n, lang)}
            />
          ) : (
            <Skeleton className="h-48" />
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-4 text-lg">{t.merchant.top}</h2>
          {stats.data?.topProducts?.length ? (
            <BarList items={stats.data.topProducts.map((p: any) => ({ label: p.name, value: Number(p.sold) }))} format={(n) => String(n)} />
          ) : (
            <p className="text-muted">{t.common.empty}</p>
          )}
        </section>
      </div>
      <LicenceLookup />
      <ShareSheet open={share} onClose={() => setShare(false)} url={`${PUBLIC_ORIGIN}/s/${st.current.slug}`} title={st.current.store_name} />
    </div>
  );
}

function LicenceLookup() {
  const { t, lang, err } = useI18n();
  const [code, setCode] = useState('');
  const [hit, setHit] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card mt-6 p-5">
      <h2 className="flex items-center gap-2 text-lg">
        <FileSearch className="h-5 w-5 text-muted" /> {t.mstore.licence}
      </h2>
      <p className="mb-3 text-sm text-muted">{t.mstore.licenceLead}</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setHit(null);
          try {
            setHit((await get(`/api/merchant/licences/${code.trim().toUpperCase()}`)).licence);
          } catch (e2) {
            setError(err(e2));
          }
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ST-XXXX-XXXX" dir="ltr" className="field num max-w-xs flex-1" />
        <Button variant="secondary">{t.mstore.licenceFind}</Button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {hit && (
        <div className="mt-3 rounded-2xl bg-sunk p-4 text-sm">
          <p className="font-medium">{hit.product}</p>
          <p>
            {hit.buyer_name} · <span className="num">{hit.buyer_email}</span>
          </p>
          <p className="text-muted">
            #{String(hit.order_id).slice(0, 8)} · {date(hit.created_at, lang)} · {hit.downloads}×
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------- stores/branches
export function MerchantStores() {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const st = useStores();
  const [edit, setEdit] = useState<{ store?: MStore | null; parent?: MStore | null } | null>(null);
  const mains = st.stores.filter((s) => !s.parent_id);
  return (
    <div>
      <PageHeader title={t.mstore.stores} actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>{t.mstore.newStore}</Button>} />
      {st.loading && !st.data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !mains.length ? (
        <StoreSetup onDone={() => st.reload()} />
      ) : (
        <div className="space-y-6">
          {mains.map((m) => {
            const branches = st.stores.filter((b) => b.parent_id === m.id);
            return (
              <motion.section key={m.id} layout className="card overflow-hidden">
                <div className="relative">
                  <StoreCover s={m} className="h-28" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4 text-white">
                    <StoreLogo s={m} size={56} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-2xl">{m.store_name}</p>
                      <p className="text-xs text-white/80">{t.shop.cat[m.category ?? 'other']}</p>
                    </div>
                  </div>
                </div>
                <ul className="divide-y divide-line">
                  {[m, ...branches].map((b) => (
                    <li key={b.id} className={cx('flex flex-wrap items-center gap-3 p-4', st.current?.id === b.id && 'bg-sunk/60')}>
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-sunk">{b.parent_id ? <GitBranch className="h-5 w-5" /> : <StoreIcon className="h-5 w-5" />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{b.parent_id ? b.branch_name : t.shop.mainBranch}</p>
                        <p className="truncate text-sm text-muted">{[b.city, b.address].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                      {st.current?.id === b.id ? (
                        <Badge tone="good">{t.mstore.current}</Badge>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => st.pick(b.id)}>
                          {t.mstore.switch}
                        </Button>
                      )}
                      <button className="rounded-lg p-2 text-muted hover:bg-sunk hover:text-ink" aria-label={t.common.edit} onClick={() => setEdit({ store: b })}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch"
                        aria-label={t.mstore.closeStore}
                        onClick={async () => {
                          const name = b.parent_id ? `${b.store_name} · ${b.branch_name}` : b.store_name;
                          if (!(await confirm({ title: fill(t.mstore.closeQ, { name }), body: t.mstore.closeB, confirmLabel: t.mstore.closeOk, tone: 'danger' }))) return;
                          try {
                            await del(`/api/merchant/stores/${b.id}`);
                            if (currentStore.get() === b.id) currentStore.set(null);
                            void st.reload();
                          } catch (e) {
                            toast((e as Error).message, 'error');
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-dashed border-line p-3">
                  <Button variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ parent: m })}>
                    {t.mstore.newBranch}
                  </Button>
                </div>
              </motion.section>
            );
          })}
        </div>
      )}
      <StoreEditor open={!!edit} onClose={() => setEdit(null)} store={edit?.store} parent={edit?.parent} onSaved={() => st.reload()} />
    </div>
  );
}

// ---------------------------------------------------------------- products
interface ProductForm {
  id?: string;
  name: string;
  description: string;
  price: string;
  compareAtPrice: string;
  stock: string;
  category: string;
  imageUrl: string | null;
  isDigital: boolean;
  digitalFileRef: string | null;
  fileName?: string;
  stampable?: boolean;
  digitalMode: 'download' | 'view';
  downloadLimit: string;
  depositPercent: string;
  depositRefundable: boolean;
  status?: 'active' | 'hidden';
}
const emptyForm: ProductForm = {
  name: '',
  description: '',
  price: '',
  compareAtPrice: '',
  stock: '1',
  category: '',
  imageUrl: null,
  isDigital: false,
  digitalFileRef: null,
  digitalMode: 'download',
  downloadLimit: '3',
  depositPercent: '0',
  depositRefundable: true,
};

export function MerchantProducts() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const st = useStores();
  const { data, loading, reload } = useData<{ products: any[] }>(st.current ? '/api/merchant/products' : null, [st.current?.id]);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doUpload = async (kind: 'image' | 'digital', f: File) => {
    setBusy(kind);
    setError(null);
    try {
      const r = await uploadTo(`/api/merchant/uploads/${kind}`, kind === 'image' ? 'image' : 'file', f);
      setForm((p) => (p ? (kind === 'image' ? { ...p, imageUrl: r.url } : { ...p, digitalFileRef: r.ref, fileName: r.name, stampable: r.stampable }) : p));
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!AMOUNT_RE.test(form.price) || Number(form.price) <= 0) return setError(t.merchant.price);
    setBusy('save');
    setError(null);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: form.price,
      compareAtPrice: AMOUNT_RE.test(form.compareAtPrice) && Number(form.compareAtPrice) > Number(form.price) ? form.compareAtPrice : null,
      stock: form.isDigital ? 0 : Math.max(0, Number(form.stock) || 0),
      category: form.category.trim() || undefined,
      imageUrl: form.imageUrl,
      isDigital: form.isDigital,
      digitalFileRef: form.digitalFileRef,
      digitalMode: form.digitalMode,
      downloadLimit: Math.min(20, Math.max(1, Number(form.downloadLimit) || 3)),
      depositPercent: form.isDigital ? 0 : Math.min(90, Math.max(0, Number(form.depositPercent) || 0)),
      depositRefundable: form.depositRefundable,
      ...(form.id && form.status ? { status: form.status } : {}),
    };
    try {
      if (form.id) await put(`/api/merchant/products/${form.id}`, body);
      else await post('/api/merchant/products', body);
      toast(t.common.saved);
      setForm(null);
      void reload();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(null);
    }
  };

  if (!st.current && !st.loading) return <StoreSetup onDone={() => st.reload()} />;
  return (
    <div>
      <PageHeader title={t.merchant.products} actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...emptyForm })}>{t.merchant.newProduct}</Button>} />
      <div className="mb-4">
        <StoreSwitcher st={st} />
      </div>
      {loading && !data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !data?.products.length ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title={t.merchant.noProducts} />
      ) : (
        <div className="card divide-y divide-line">
          <AnimatePresence initial={false}>
            {data.products.map((p) => (
              <motion.div key={p.id} layout exit={{ opacity: 0, height: 0 }} className="flex items-center gap-4 p-4">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sunk">
                  {p.image_url ? <img src={assetUrl(p.image_url)!} alt="" className="h-full w-full object-cover" /> : <StoreIcon className="m-4 h-6 w-6 text-muted" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-sm text-muted">
                    <span className="num">{money(p.price, lang)}</span> · {p.is_digital ? (p.digital_mode === 'view' ? t.shop.viewOnly : t.store.digital) : p.stock > 0 ? `${p.stock} ${t.store.inStock}` : t.store.soldOut}
                    {p.deposit_percent > 0 && <span className="text-gold"> · {fill(t.shop.deposit, { p: p.deposit_percent })}</span>}
                  </p>
                </div>
                <Badge tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status === 'active' ? t.merchant.active : t.merchant.hidden}</Badge>
                <button
                  className="rounded-lg p-2 text-muted hover:bg-sunk hover:text-ink"
                  aria-label={t.common.edit}
                  onClick={() =>
                    setForm({
                      id: p.id,
                      name: p.name,
                      description: p.description ?? '',
                      price: Number(p.price).toFixed(2),
                      compareAtPrice: p.compare_at_price ? Number(p.compare_at_price).toFixed(2) : '',
                      stock: String(p.stock ?? 0),
                      category: p.category ?? '',
                      imageUrl: p.image_url,
                      isDigital: p.is_digital,
                      digitalFileRef: null,
                      digitalMode: p.digital_mode ?? 'download',
                      downloadLimit: String(p.download_limit ?? 3),
                      depositPercent: String(p.deposit_percent ?? 0),
                      depositRefundable: p.deposit_refundable ?? true,
                      status: p.status === 'hidden' ? 'hidden' : 'active',
                    })
                  }
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch"
                  aria-label={t.common.delete}
                  onClick={async () => {
                    if (!(await confirm({ title: t.common.delete, body: `${t.merchant.deleteQ} — ${p.name}`, confirmLabel: t.common.delete, tone: 'danger' }))) return;
                    try {
                      await del(`/api/merchant/products/${p.id}`);
                      void reload();
                    } catch (e) {
                      toast(err(e), 'error');
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? t.common.edit : t.merchant.newProduct} wide>
        {form && (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-4">
              <Field label={t.merchant.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} />
              <div className="grid grid-cols-2 gap-3">
                <AmountInput label={t.merchant.price} value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
                <AmountInput label={t.mstore.compareAt} value={form.compareAtPrice} onChange={(v) => setForm({ ...form, compareAtPrice: v })} />
              </div>
              <Toggle checked={form.isDigital} onChange={(v) => setForm({ ...form, isDigital: v })} label={t.merchant.digital} />
              {!form.isDigital && <Field label={t.merchant.stock} type="number" min={0} max={1000000} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />}
              <Field label={`${t.merchant.category} (${t.common.optional})`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={40} />
              {!form.isDigital && (
                <div className="space-y-3 rounded-2xl border border-gold/40 bg-gold/5 p-4">
                  <p className="font-medium">{t.mstore.deposit}</p>
                  <Field label={t.mstore.depositPct} type="number" min={0} max={90} value={form.depositPercent} onChange={(e) => setForm({ ...form, depositPercent: e.target.value })} />
                  <p className="text-xs text-muted">{t.mstore.depositHelp}</p>
                  {Number(form.depositPercent) > 0 && (
                    <Toggle checked={form.depositRefundable} onChange={(v) => setForm({ ...form, depositRefundable: v })} label={t.mstore.depositRefundable} />
                  )}
                </div>
              )}
              {form.id && <Toggle checked={form.status !== 'hidden'} onChange={(v) => setForm({ ...form, status: v ? 'active' : 'hidden' })} label={form.status !== 'hidden' ? t.merchant.active : t.merchant.hidden} />}
            </div>
            <div className="space-y-4">
              <TextArea label={t.merchant.description} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink/80">{t.merchant.image}</p>
                <button type="button" onClick={() => imgRef.current?.click()} className="grid aspect-video w-full place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-line text-muted transition hover:border-stitch hover:text-stitch">
                  {form.imageUrl ? <img src={assetUrl(form.imageUrl)!} alt="" className="h-full w-full object-cover" /> : <span className="flex items-center gap-2">{busy === 'image' ? '…' : <ImageUp className="h-5 w-5" />} {t.merchant.uploadImage}</span>}
                </button>
                <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => e.target.files?.[0] && doUpload('image', e.target.files[0])} />
              </div>
              {form.isDigital && (
                <div className="space-y-3 rounded-2xl border border-sky/40 bg-sky/5 p-4">
                  <p className="text-sm font-medium text-ink/80">{t.merchant.file}</p>
                  <Button type="button" variant="secondary" block loading={busy === 'digital'} icon={<FileUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                    {form.fileName ?? t.merchant.uploadFile}
                  </Button>
                  <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && doUpload('digital', e.target.files[0])} />
                  <Select
                    block
                    label={t.mstore.digitalMode}
                    value={form.digitalMode}
                    onChange={(v) => setForm({ ...form, digitalMode: v })}
                    options={[
                      { value: 'download', label: t.mstore.modeDownload },
                      { value: 'view', label: t.mstore.modeView },
                    ]}
                  />
                  {form.digitalMode === 'download' && (
                    <Field label={t.mstore.downloadLimit} type="number" min={1} max={20} value={form.downloadLimit} onChange={(e) => setForm({ ...form, downloadLimit: e.target.value })} />
                  )}
                  <p className="text-xs text-muted">{t.mstore.stampNote}</p>
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <ErrorNote>{error}</ErrorNote>
              <Button block size="lg" className="mt-2" loading={busy === 'save'} disabled={form.isDigital && !form.id && !form.digitalFileRef}>
                {t.common.save}
              </Button>
            </div>
          </form>
        )}
      </Sheet>
    </div>
  );
}

// --------------------------------------------------------------------- ads
export function MerchantAds() {
  const { t, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const st = useStores();
  const ads = useData<{ ads: any[] }>(st.current ? '/api/merchant/ads' : null, [st.current?.id]);
  const products = useData<{ products: any[] }>(st.current ? '/api/merchant/products' : null, [st.current?.id]);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.mediaUrl) return setError(t.mstore.adMedia);
    setBusy('save');
    setError(null);
    const body = { kind: form.kind, mediaUrl: form.mediaUrl, title: form.title.trim() || null, body: form.body.trim() || null, productId: form.productId || null, active: form.active, sort: 0 };
    try {
      if (form.id) await put(`/api/merchant/ads/${form.id}`, body);
      else await post('/api/merchant/ads', body);
      setForm(null);
      void ads.reload();
      toast(t.common.saved);
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <PageHeader
        title={t.mstore.ads}
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ kind: 'image', mediaUrl: '', title: '', body: '', productId: '', active: true })}>{t.mstore.newAd}</Button>}
      />
      <div className="mb-4">
        <StoreSwitcher st={st} />
      </div>
      {!ads.data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !ads.data.ads.length ? (
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title={t.common.empty} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {ads.data.ads.map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="group relative aspect-[4/5] overflow-hidden rounded-[1.4rem] bg-night">
              {a.kind === 'video' ? <video src={assetUrl(a.media_url)!} muted loop autoPlay playsInline className="h-full w-full object-cover" /> : <img src={assetUrl(a.media_url)!} alt="" className="h-full w-full object-cover" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3 text-white">
                <p className="line-clamp-1 font-medium">{a.title ?? '—'}</p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    className="rounded-lg bg-white/15 p-2 backdrop-blur hover:bg-white/25"
                    aria-label={a.active ? t.merchant.hidden : t.mstore.adActive}
                    onClick={async () => {
                      await put(`/api/merchant/ads/${a.id}`, { kind: a.kind, mediaUrl: a.media_url, title: a.title, body: a.body, productId: a.product_id, active: !a.active, sort: a.sort });
                      void ads.reload();
                    }}
                  >
                    {a.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    className="rounded-lg bg-white/15 p-2 backdrop-blur hover:bg-white/25"
                    aria-label={t.common.edit}
                    onClick={() => setForm({ id: a.id, kind: a.kind, mediaUrl: a.media_url, title: a.title ?? '', body: a.body ?? '', productId: a.product_id ?? '', active: a.active })}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded-lg bg-white/15 p-2 backdrop-blur hover:bg-stitch"
                    aria-label={t.common.delete}
                    onClick={async () => {
                      if (!(await confirm({ title: t.mstore.adDeleteQ, confirmLabel: t.mstore.adDeleteOk, tone: 'danger' }))) return;
                      await del(`/api/merchant/ads/${a.id}`);
                      void ads.reload();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {!a.active && <span className="absolute start-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">{t.merchant.hidden}</span>}
            </motion.div>
          ))}
        </div>
      )}
      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? t.common.edit : t.mstore.newAd}>
        {form && (
          <form onSubmit={save} className="space-y-4">
            <button type="button" onClick={() => mediaRef.current?.click()} className="relative grid aspect-[4/5] w-full max-w-[16rem] place-items-center overflow-hidden rounded-[1.4rem] border-2 border-dashed border-line text-muted transition hover:border-stitch">
              {form.mediaUrl ? (
                form.kind === 'video' ? (
                  <video src={assetUrl(form.mediaUrl)!} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                ) : (
                  <img src={assetUrl(form.mediaUrl)!} alt="" className="h-full w-full object-cover" />
                )
              ) : (
                <span className="flex flex-col items-center gap-2 text-sm">
                  {busy === 'media' ? '…' : (
                    <span className="flex gap-2">
                      <ImageUp className="h-6 w-6" />
                      <Video className="h-6 w-6" />
                    </span>
                  )}
                  {t.mstore.adMedia}
                </span>
              )}
            </button>
            <input
              ref={mediaRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy('media');
                try {
                  const r = await uploadTo('/api/merchant/uploads/media', 'file', file);
                  setForm((x: any) => ({ ...x, mediaUrl: r.url, kind: r.kind }));
                } catch (e2) {
                  setError(err(e2));
                } finally {
                  setBusy(null);
                }
              }}
            />
            <Field label={t.mstore.adTitle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} />
            <TextArea label={t.mstore.adBody} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={240} rows={2} />
            <Select
              block
              label={t.mstore.adProduct}
              value={form.productId}
              onChange={(v) => setForm({ ...form, productId: v })}
              options={[{ value: '', label: '—' }, ...(products.data?.products ?? []).map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label={t.mstore.adActive} />
            <ErrorNote>{error}</ErrorNote>
            <Button block size="lg" loading={busy === 'save'}>
              {t.common.save}
            </Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ orders
function DeliverSheet({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const { t, lang, err } = useI18n();
  const [code, setCode] = useState('');
  const [cash, setCash] = useState(false);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCode('');
    setCash(false);
    setScan(false);
    setError(null);
  }, [order]);
  const due = order && Number(order.balance_due) > 0;
  const submit = async (c = code) => {
    if (!/^\d{6}$/.test(c)) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/merchant/orders/${order.id}/deliver`, { code: c, cashBalance: cash });
      onDone();
      onClose();
    } catch (e) {
      setError(err(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!order} onClose={onClose} title={t.mstore.deliver}>
      {order && (
        <div className="space-y-4">
          <p className="text-muted">{t.mstore.deliverLead}</p>
          {scan ? (
            <Scanner
              onResult={(text) => {
                const m = /^staler-handover:([^:]+):(\d{6})$/.exec(text.trim());
                if (m && m[1] === String(order.id)) {
                  setScan(false);
                  setCode(m[2]!);
                  void submit(m[2]!);
                }
              }}
            />
          ) : (
            <CodeInput value={code} onChange={setCode} />
          )}
          <Button type="button" variant="ghost" icon={<ScanLine className="h-4 w-4" />} onClick={() => setScan((v) => !v)}>
            {scan ? t.mstore.code : t.nav.scan}
          </Button>
          {due && <Toggle checked={cash} onChange={setCash} label={fill(t.mstore.cashBalance, { amount: money(order.balance_due, lang) })} />}
          <ErrorNote>{error}</ErrorNote>
          <Button block size="lg" variant="stitch" loading={busy} disabled={code.length !== 6 || (due && !cash)} icon={<KeyRound className="h-5 w-5" />} onClick={() => submit()}>
            {t.mstore.deliverOk}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function TrackSheet({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const { t, err } = useI18n();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (kind: 'location' | 'note' | 'out_for_delivery') => {
    setBusy(kind);
    const go = async (geo?: { lat: number; lng: number }) => {
      try {
        await post(`/api/merchant/orders/${order.id}/track`, { kind, ...(note.trim() ? { note: note.trim() } : {}), ...(geo ?? {}) });
        toast(t.common.done);
        setNote('');
        onDone();
        onClose();
      } catch (e) {
        toast(err(e), 'error');
      } finally {
        setBusy(null);
      }
    };
    if (kind === 'location' || kind === 'out_for_delivery') {
      if (!navigator.geolocation) return void go();
      navigator.geolocation.getCurrentPosition(
        (p) => void go({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }),
        () => void (kind === 'location' ? setBusy(null) : go()),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    } else void go();
  };
  return (
    <Sheet open={!!order} onClose={onClose} title={t.mstore.track}>
      {order && (
        <div className="space-y-4">
          <Field label={t.mstore.addNote} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" loading={busy === 'location'} icon={<MapPin className="h-4 w-4" />} onClick={() => send('location')}>
              {t.mstore.sendLocation}
            </Button>
            <Button variant="secondary" loading={busy === 'out_for_delivery'} icon={<Navigation className="h-4 w-4" />} onClick={() => send('out_for_delivery')}>
              {t.mstore.outForDelivery}
            </Button>
            <Button variant="secondary" loading={busy === 'note'} disabled={!note.trim()} icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => send('note')}>
              {t.mstore.addNote}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function MerchantOrders() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const st = useStores();
  const [scope, setScope] = useState<'store' | 'all'>('all');
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const { data, loading, reload } = useData<{ orders: any[] }>(st.current ? `/api/merchant/orders${scope === 'all' ? '?all=1' : ''}` : null, [scope, st.current?.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [deliver, setDeliver] = useState<any>(null);
  const [track, setTrack] = useState<any>(null);
  const orders = useMemo(() => (data?.orders ?? []).filter((o) => (tab === 'open' ? o.escrow_status === 'held' : o.escrow_status !== 'held')), [data, tab]);

  const act = async (o: any, action: 'accept' | 'ship' | 'cancel') => {
    const q =
      action === 'accept'
        ? { title: t.mstore.acceptQ, body: t.mstore.acceptB, confirmLabel: t.mstore.accept }
        : action === 'ship'
          ? { title: t.ask.shipTitle, body: t.ask.shipBody, confirmLabel: o.fulfillment === 'pickup' ? t.mstore.readyPickup : t.ask.shipOk }
          : { title: t.ask.merchCancelTitle, body: t.ask.merchCancelBody, confirmLabel: t.ask.merchCancelOk, tone: 'danger' as const };
    if (!(await confirm(q))) return;
    setBusy(o.id + action);
    try {
      await post(`/api/merchant/orders/${o.id}/${action}`, {});
      toast(t.common.done);
      void reload();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title={t.merchant.orders} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chips label={t.tx.filter} value={tab} onChange={setTab} options={[{ value: 'open', label: t.ord.st.processing }, { value: 'done', label: t.ord.st.completed }]} />
        {st.stores.length > 1 && <Chips label={t.mstore.current} value={scope} onChange={setScope} options={[{ value: 'all', label: t.mstore.allStores }, { value: 'store', label: st.current ? label(st.current, t) : '' }]} />}
      </div>
      {loading && !data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !orders.length ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title={t.orders.none} />
      ) : (
        <div className="space-y-3">
          {orders.map((o, i) => {
            const pins: Pin[] = [
              ...(o.store_lat != null ? [{ lat: o.store_lat, lng: o.store_lng, kind: 'store' as const, label: o.store_name }] : []),
              ...(o.delivery_lat != null ? [{ lat: o.delivery_lat, lng: o.delivery_lng, kind: 'home' as const, label: o.buyer_name }] : []),
            ];
            return (
              <motion.div key={o.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} className="card p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t.merchant.buyer}: {o.buyer_name ?? '—'}
                    </p>
                    <p className="num text-sm text-muted">
                      #{String(o.id).slice(0, 8)} · {date(o.created_at, lang)}
                      {o.branch_name ? ` · ${o.branch_name}` : ''}
                    </p>
                    <p className="mt-1 text-sm">{o.items.map((x: any) => `${x.quantity}× ${x.name}`).join('، ')}</p>
                  </div>
                  <div className="text-end">
                    <p className="num font-display text-lg">{money(o.total_amount, lang)}</p>
                    {Number(o.balance_due) > 0 && (
                      <p className="num text-xs text-gold">
                        {t.mstore.buyerOwes}: {money(o.balance_due, lang)}
                      </p>
                    )}
                    <Badge tone={o.dispute_status === 'open' ? 'bad' : o.status === 'completed' ? 'good' : o.status === 'cancelled' ? 'bad' : 'warn'}>
                      {o.dispute_status === 'open' ? t.ord.disputed : t.ord.st[o.status] ?? o.status}
                    </Badge>
                  </div>
                </div>
                {o.fulfillment !== 'digital' && (
                  <div className="mt-3 grid gap-2 rounded-2xl bg-sunk/60 p-3 text-sm sm:grid-cols-2">
                    <p className="flex items-start gap-2">
                      {o.fulfillment === 'pickup' ? <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <Truck className="mt-0.5 h-4 w-4 shrink-0" />}
                      <span>{o.fulfillment === 'pickup' ? (o.pickup_info ? `${t.pick.at}: ${o.pickup_info.name}` : t.shop.pickup) : o.delivery_address ?? '—'}</span>
                    </p>
                    {o.delivery_phone && (
                      <a href={`tel:${o.delivery_phone}`} className="num text-sky" dir="ltr">
                        {o.delivery_phone}
                      </a>
                    )}
                    {o.buyer_note && <p className="text-muted sm:col-span-2">“{o.buyer_note}”</p>}
                    {(o.events as any[]).length > 0 && (
                      <p className="text-xs text-muted sm:col-span-2">
                        {t.ord.lastSeen}: {t.ord.ev[o.events[o.events.length - 1].kind] ?? ''} · {relative(o.events[o.events.length - 1].at, lang)}
                      </p>
                    )}
                  </div>
                )}
                {pins.length > 0 && o.escrow_status === 'held' && <MapView pins={pins} className="mt-3 h-40" />}
                {o.escrow_status === 'held' && o.dispute_status !== 'open' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {o.status === 'processing' && !o.accepted_at && (
                      <Button size="sm" loading={busy === o.id + 'accept'} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => act(o, 'accept')}>
                        {t.mstore.accept}
                      </Button>
                    )}
                    {o.status === 'processing' && (
                      <Button size="sm" variant="secondary" loading={busy === o.id + 'ship'} icon={<Truck className="h-4 w-4" />} onClick={() => act(o, 'ship')}>
                        {o.fulfillment === 'pickup' ? t.mstore.readyPickup : t.mstore.ship}
                      </Button>
                    )}
                    {o.fulfillment !== 'digital' && (
                      <Button size="sm" variant="secondary" icon={<MapPin className="h-4 w-4" />} onClick={() => setTrack(o)}>
                        {t.mstore.track}
                      </Button>
                    )}
                    {o.fulfillment !== 'digital' && (
                      <Button size="sm" variant="stitch" icon={<KeyRound className="h-4 w-4" />} onClick={() => setDeliver(o)}>
                        {t.mstore.deliver}
                      </Button>
                    )}
                    <Button size="sm" variant="danger" loading={busy === o.id + 'cancel'} icon={<XCircle className="h-4 w-4" />} onClick={() => act(o, 'cancel')}>
                      {t.merchant.cancelRefund}
                    </Button>
                  </div>
                )}
                {o.dispute_status === 'open' && <p className="mt-3 rounded-xl bg-stitch/10 px-3 py-2 text-sm text-stitch">{t.mstore.disputeOpen}</p>}
              </motion.div>
            );
          })}
        </div>
      )}
      <DeliverSheet order={deliver} onClose={() => setDeliver(null)} onDone={() => void reload()} />
      <TrackSheet order={track} onClose={() => setTrack(null)} onDone={() => void reload()} />
    </div>
  );
}

// ---------------------------------------------------------- pickup points
export function MerchantPickup() {
  const { t, err } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const st = useStores();
  const list = useData<{ points: any[] }>(st.current ? '/api/merchant/pickup-points' : null, [st.current?.id]);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = { name: '', description: '', city: '', address: '', hours: '', lat: null, lng: null, active: true };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      hours: form.hours.trim() || null,
      lat: form.lat ?? null,
      lng: form.lng ?? null,
      active: form.active,
    };
    try {
      if (form.id) await patch(`/api/merchant/pickup-points/${form.id}`, body);
      else await post('/api/merchant/pickup-points', body);
      toast(t.pick.saved);
      setForm(null);
      void list.reload();
    } catch (e2) {
      setError(err(e2));
    } finally {
      setBusy(false);
    }
  };
  if (!st.current && !st.loading) return <EmptyState icon={<StoreIcon className="h-6 w-6" />} title={t.merchant.setupLead} />;
  return (
    <div>
      <PageHeader
        title={t.pick.title}
        lead={t.pick.lead}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => (setError(null), setForm({ ...blank }))}>
            {t.pick.add}
          </Button>
        }
      />
      <div className="mb-4">
        <StoreSwitcher st={st} />
      </div>
      {!list.data ? (
        <Skeleton className="h-40 rounded-3xl" />
      ) : !list.data.points.length ? (
        <EmptyState icon={<MapPin className="h-6 w-6" />} title={t.pick.none} action={<Button onClick={() => setForm({ ...blank })}>{t.pick.add}</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.data.points.map((x, i) => (
            <motion.div key={x.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={cx('card p-5', !x.active && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-stitch/10 text-stitch">
                  <MapPin className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{x.name}</p>
                  {(x.city || x.address) && <p className="text-sm text-muted">{[x.city, x.address].filter(Boolean).join(' · ')}</p>}
                  {x.hours && <p className="mt-0.5 text-xs text-muted">{x.hours}</p>}
                </div>
                {!x.active && <Badge>{t.pick.off}</Badge>}
              </div>
              {x.description && <p className="mt-3 rounded-xl bg-sunk/60 p-3 text-sm">{x.description}</p>}
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => (setError(null), setForm({ ...blank, ...x, description: x.description ?? '', city: x.city ?? '', address: x.address ?? '', hours: x.hours ?? '' }))}>
                  {t.common.edit}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (!(await confirm({ title: t.pick.deleteQ, body: t.pick.deleteB, confirmLabel: t.common.delete, tone: 'danger' }))) return;
                    try {
                      await del(`/api/merchant/pickup-points/${x.id}`);
                      void list.reload();
                    } catch (e) {
                      toast(err(e), 'error');
                    }
                  }}
                >
                  {t.common.delete}
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? t.pick.edit : t.pick.add} wide>
        {form && (
          <form onSubmit={save} className="space-y-4">
            <Field label={t.pick.name} placeholder={t.pick.namePh} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} />
            <TextArea label={t.pick.description} placeholder={t.pick.descPh} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} maxLength={300} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.mstore.city} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={60} />
              <Field label={t.mstore.address} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={200} />
            </div>
            <Field label={t.pick.hours} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} maxLength={120} />
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label={t.pick.active} />
            <div>
              <p className="mb-2 text-sm font-medium text-ink/80">{t.mstore.pin}</p>
              <MapView pins={form.lat != null ? [{ lat: form.lat, lng: form.lng, kind: 'store', label: form.name }] : []} onPick={(p) => setForm((f: any) => ({ ...f, ...p }))} className="h-52 rounded-2xl" />
            </div>
            <ErrorNote>{error}</ErrorNote>
            <Button block size="lg" loading={busy}>
              {t.common.save}
            </Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
