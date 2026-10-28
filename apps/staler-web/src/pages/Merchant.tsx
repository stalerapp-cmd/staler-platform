import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, ImageUp, Package, Pencil, Plus, Store as StoreIcon, Trash2, Truck, XCircle } from 'lucide-react';
import { assetUrl, del, post, put, upload } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { AMOUNT_RE, date, money } from '../lib/format';
import { useToast } from '../components/Toast';
import { AreaChart, BarList } from '../components/Chart';
import { AmountInput, Badge, Button, EmptyState, ErrorNote, Field, PageHeader, Sheet, Skeleton, TextArea, Toggle, cx } from '../components/ui';
import { StarMotif } from '../components/Tatreez';

function StoreSetup({ onDone }: { onDone: () => void }) {
  const { t, err } = useI18n();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card mx-auto max-w-lg overflow-hidden">
      <div className="relative h-40 bg-night">
        <StarMotif size={21} cell={10} className="absolute -bottom-10 end-6 h-56 w-56" />
      </div>
      <form
        className="space-y-4 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post('/api/merchant/profile', { storeName: name.trim(), description: desc.trim() });
            onDone();
          } catch (e2) {
            setError(err(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="text-2xl">{t.merchant.setup}</h2>
        <p className="text-muted">{t.merchant.setupLead}</p>
        <Field label={t.merchant.storeName} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} />
        <TextArea label={t.merchant.description} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
        <ErrorNote>{error}</ErrorNote>
        <Button block size="lg" loading={busy}>
          {t.merchant.create}
        </Button>
      </form>
    </div>
  );
}

export function MerchantDashboard() {
  const { t, lang } = useI18n();
  const profile = useData<{ merchant: any }>('/api/merchant/profile');
  const stats = useData<any>(profile.data?.merchant ? '/api/merchant/stats' : null, [profile.data?.merchant?.id]);
  if (profile.loading && !profile.data) return <Skeleton className="h-64 rounded-3xl" />;
  if (!profile.data?.merchant) return <StoreSetup onDone={() => profile.reload()} />;
  const s = stats.data?.stats;
  const tiles = [
    { label: t.merchant.revenue, value: money(s?.revenue ?? 0, lang), tone: 'text-olive' },
    { label: t.merchant.escrow, value: money(s?.in_escrow ?? 0, lang), tone: 'text-gold' },
    { label: t.merchant.toShip, value: String(s?.to_ship ?? 0), tone: 'text-stitch' },
    { label: t.merchant.completed, value: String(s?.completed ?? 0), tone: 'text-ink' },
  ];
  return (
    <div>
      <PageHeader
        title={profile.data.merchant.store_name}
        lead={profile.data.merchant.description}
        actions={
          <Link to="/app/merchant/products">
            <Button icon={<Plus className="h-4 w-4" />}>{t.merchant.newProduct}</Button>
          </Link>
        }
      />
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
    </div>
  );
}

interface ProductForm {
  id?: string;
  name: string;
  description: string;
  price: string;
  stock: string;
  category: string;
  imageUrl: string | null;
  isDigital: boolean;
  digitalFileRef: string | null;
  fileName?: string;
  status?: 'active' | 'hidden';
}
const emptyForm: ProductForm = { name: '', description: '', price: '', stock: '1', category: '', imageUrl: null, isDigital: false, digitalFileRef: null };

export function MerchantProducts() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useData<{ products: any[] }>('/api/merchant/products');
  const [form, setForm] = useState<ProductForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState<any>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doUpload = async (kind: 'image' | 'digital', f: File) => {
    setBusy(kind);
    setError(null);
    try {
      const fd = new FormData();
      fd.append(kind === 'image' ? 'image' : 'file', f);
      const r = await upload(`/api/merchant/uploads/${kind}`, fd);
      setForm((p) => (p ? (kind === 'image' ? { ...p, imageUrl: r.url } : { ...p, digitalFileRef: r.ref, fileName: r.name }) : p));
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
      stock: form.isDigital ? 0 : Math.max(0, Number(form.stock) || 0),
      category: form.category.trim() || undefined,
      imageUrl: form.imageUrl,
      isDigital: form.isDigital,
      digitalFileRef: form.digitalFileRef,
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

  return (
    <div>
      <PageHeader
        title={t.merchant.products}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...emptyForm })}>
            {t.merchant.newProduct}
          </Button>
        }
      />
      {loading && !data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !data?.products.length ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title={t.merchant.noProducts} />
      ) : (
        <div className="card divide-y divide-line">
          {data.products.map((p) => (
            <div key={p.id} className="flex items-center gap-4 p-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sunk">
                {p.image_url ? <img src={assetUrl(p.image_url)!} alt="" className="h-full w-full object-cover" /> : <StoreIcon className="m-4 h-6 w-6 text-muted" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-sm text-muted">
                  <span className="num">{money(p.price, lang)}</span> · {p.is_digital ? t.store.digital : `${p.stock} ${t.store.inStock}`}
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
                    stock: String(p.stock ?? 0),
                    category: p.category ?? '',
                    imageUrl: p.image_url,
                    isDigital: p.is_digital,
                    digitalFileRef: null,
                    status: p.status === 'hidden' ? 'hidden' : 'active',
                  })
                }
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button className="rounded-lg p-2 text-muted hover:bg-stitch/10 hover:text-stitch" aria-label={t.common.delete} onClick={() => setRemove(p)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? t.common.edit : t.merchant.newProduct} wide>
        {form && (
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-4">
              <Field label={t.merchant.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} />
              <AmountInput label={t.merchant.price} value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
              <Toggle checked={form.isDigital} onChange={(v) => setForm({ ...form, isDigital: v })} label={t.merchant.digital} />
              {!form.isDigital && <Field label={t.merchant.stock} type="number" min={0} max={1000000} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />}
              <Field label={`${t.merchant.category} (${t.common.optional})`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={40} />
              {form.id && (
                <Toggle checked={form.status !== 'hidden'} onChange={(v) => setForm({ ...form, status: v ? 'active' : 'hidden' })} label={form.status !== 'hidden' ? t.merchant.active : t.merchant.hidden} />
              )}
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
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink/80">{t.merchant.file}</p>
                  <Button type="button" variant="secondary" block loading={busy === 'digital'} icon={<FileUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                    {form.fileName ?? t.merchant.uploadFile}
                  </Button>
                  <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && doUpload('digital', e.target.files[0])} />
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

      <Sheet open={!!remove} onClose={() => setRemove(null)} title={t.common.delete}>
        <p className="text-muted">{t.merchant.deleteQ}</p>
        <p className="mt-2 font-medium">{remove?.name}</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setRemove(null)}>
            {t.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await del(`/api/merchant/products/${remove.id}`);
                void reload();
              } catch (e) {
                toast(err(e), 'error');
              }
              setRemove(null);
            }}
          >
            {t.common.delete}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

export function MerchantOrders() {
  const { t, lang, err } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useData<{ orders: any[] }>('/api/merchant/orders');
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: 'ship' | 'cancel') => {
    setBusy(id + action);
    try {
      await post(`/api/merchant/orders/${id}/${action}`);
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
      {loading && !data ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !data?.orders.length ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title={t.orders.none} />
      ) : (
        <div className="space-y-3">
          {data.orders.map((o) => (
            <div key={o.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t.merchant.buyer}: {o.buyer_name ?? '—'}
                </p>
                <p className="num text-sm text-muted">
                  #{String(o.id).slice(0, 8)} · {date(o.created_at, lang)}
                </p>
                <p className="mt-1 truncate text-sm">{o.items.map((i: any) => `${i.quantity}× ${i.name}`).join('، ')}</p>
              </div>
              <div className="text-end">
                <p className="num font-display text-lg">{money(o.total_amount, lang)}</p>
                <Badge tone={o.status === 'completed' ? 'good' : o.status === 'cancelled' ? 'bad' : 'warn'}>{t.orders.st[o.status] ?? o.status}</Badge>
              </div>
              {o.escrow_status === 'held' && (
                <div className="flex w-full gap-2 sm:w-auto">
                  {o.status === 'processing' && (
                    <Button size="sm" loading={busy === o.id + 'ship'} icon={<Truck className="h-4 w-4" />} onClick={() => act(o.id, 'ship')}>
                      {t.merchant.ship}
                    </Button>
                  )}
                  <Button size="sm" variant="danger" loading={busy === o.id + 'cancel'} icon={<XCircle className="h-4 w-4" />} onClick={() => act(o.id, 'cancel')}>
                    {t.merchant.cancelRefund}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

