import { MapPin, Plus, Trash2, Truck } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { money } from '../lib/format';
import { GOVERNORATES } from '../lib/places';
import { Segmented, cx } from './ui';

export type DeliveryMode = 'free' | 'flat' | 'zones';
export interface Zone {
  id?: string;
  name: string;
  fee: string;
}
export interface DeliveryValue {
  mode: DeliveryMode;
  fee: string;
  zones: Zone[];
}

const PRICE = /^\d{0,7}(\.\d{0,2})?$/;
const priceOk = (v: string) => /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(v.trim());

/** What's missing before the store can save its delivery prices (or null). */
export function deliveryProblem(v: DeliveryValue, ar: boolean): string | null {
  if (v.mode === 'flat' && !priceOk(v.fee)) return ar ? 'اكتب سعر التوصيل' : 'Enter the delivery price';
  if (v.mode === 'zones') {
    if (!v.zones.length) return ar ? 'ضيف منطقة توصيل وحدة على الأقل مع سعرها' : 'Add at least one delivery area with its price';
    if (v.zones.some((z) => z.name.trim().length < 2 || !priceOk(z.fee))) return ar ? 'كل منطقة بدها اسم وسعر' : 'Each area needs a name and a price';
  }
  return null;
}

/** The body fields for the store API. */
export const deliveryBody = (v: DeliveryValue) => ({
  deliveryMode: v.mode,
  ...(v.mode === 'flat' ? { deliveryFee: v.fee.trim() } : {}),
  ...(v.mode === 'zones' ? { deliveryZones: v.zones.map((z) => ({ ...(z.id ? { id: z.id } : {}), name: z.name.trim(), fee: z.fee.trim() })) } : {}),
});

function PriceInput({ value, onChange, label, className }: { value: string; onChange: (v: string) => void; label: string; className?: string }) {
  return (
    <label className={cx('flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 focus-within:border-sky', className)} dir="ltr">
      <input
        aria-label={label}
        inputMode="decimal"
        placeholder="0"
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.');
          if (PRICE.test(v)) onChange(v);
        }}
        className="num w-full min-w-0 bg-transparent text-base outline-none"
      />
      <span className="shrink-0 text-xs text-muted">PS</span>
    </label>
  );
}

/** The store sets what delivery costs: free, one price, or a price per area. */
export function DeliveryPricing({ value, onChange }: { value: DeliveryValue; onChange: (v: DeliveryValue) => void }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const set = (p: Partial<DeliveryValue>) => onChange({ ...value, ...p });
  const setZone = (i: number, p: Partial<Zone>) => set({ zones: value.zones.map((z, j) => (j === i ? { ...z, ...p } : z)) });
  const have = new Set(value.zones.map((z) => z.name.trim()));
  const quick = GOVERNORATES.map((g) => (ar ? g.ar : g.en)).filter((n) => !have.has(n));
  const fees = value.zones.map((z) => Number(z.fee)).filter((n) => Number.isFinite(n) && n >= 0);
  return (
    <div className="space-y-3 rounded-2xl border border-line p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Truck className="h-4 w-4 text-olive" /> {ar ? 'سعر التوصيل' : 'Delivery price'}
      </p>
      <Segmented
        value={value.mode}
        onChange={(mode) => set({ mode, ...(mode === 'zones' && !value.zones.length ? { zones: [{ name: '', fee: '' }] } : {}) })}
        options={[
          { value: 'free', label: ar ? 'مجاني' : 'Free' },
          { value: 'flat', label: ar ? 'سعر واحد' : 'One price' },
          { value: 'zones', label: ar ? 'حسب المنطقة' : 'By area' },
        ]}
      />
      {value.mode === 'free' && <p className="text-xs text-muted">{ar ? 'الزبون ما بيدفع إشي عالتوصيل.' : 'Customers pay nothing for delivery.'}</p>}
      {value.mode === 'flat' && (
        <div className="flex flex-wrap items-center gap-3">
          <PriceInput value={value.fee} onChange={(fee) => set({ fee })} label={ar ? 'سعر التوصيل' : 'Delivery price'} className="w-36" />
          <p className="min-w-0 flex-1 text-xs text-muted">{ar ? 'نفس السعر لكل الطلبات، وبينضاف عالمجموع.' : 'Same price on every order, added to the total.'}</p>
        </div>
      )}
      {value.mode === 'zones' && (
        <div className="space-y-2">
          <p className="text-xs text-muted">{ar ? 'الزبون بيختار منطقته وقت الطلب، وبينضاف سعرها عالمجموع.' : 'Customers pick their area at checkout; its price is added to the total.'}</p>
          <ul className="space-y-2">
            {value.zones.map((z, i) => (
              <li key={z.id ?? `n${i}`} className="flex items-center gap-2">
                <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-sky">
                  <MapPin className="h-4 w-4 shrink-0 text-muted" />
                  <input
                    value={z.name}
                    onChange={(e) => setZone(i, { name: e.target.value })}
                    maxLength={60}
                    placeholder={ar ? 'المنطقة (مثلًا نابلس)' : 'Area (e.g. Nablus)'}
                    aria-label={ar ? 'اسم المنطقة' : 'Area name'}
                    className="w-full min-w-0 bg-transparent text-sm outline-none"
                  />
                </label>
                <PriceInput value={z.fee} onChange={(fee) => setZone(i, { fee })} label={ar ? 'سعرها' : 'Its price'} className="w-28 shrink-0" />
                <button
                  type="button"
                  onClick={() => set({ zones: value.zones.filter((_, j) => j !== i) })}
                  className="grid h-11 w-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-stitch/10 hover:text-stitch"
                  aria-label={ar ? 'احذف المنطقة' : 'Remove area'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {value.zones.length < 40 && (
            <button type="button" onClick={() => set({ zones: [...value.zones, { name: '', fee: '' }] })} className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-sky hover:bg-sky/10">
              <Plus className="h-4 w-4" /> {ar ? 'ضيف منطقة' : 'Add area'}
            </button>
          )}
          {quick.length > 0 && value.zones.length < 40 && (
            <div>
              <p className="mb-1.5 text-[11px] text-muted">{ar ? 'ضيف بسرعة:' : 'Quick add:'}</p>
              <div className="flex flex-wrap gap-1.5">
                {quick.slice(0, 16).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      const empty = value.zones.findIndex((z) => !z.name.trim());
                      if (empty >= 0) setZone(empty, { name: n });
                      else set({ zones: [...value.zones, { name: n, fee: '' }] });
                    }}
                    className="rounded-full bg-sunk px-2.5 py-1 text-xs hover:text-ink"
                  >
                    + {n}
                  </button>
                ))}
              </div>
            </div>
          )}
          {fees.length > 1 && (
            <p className="text-xs text-muted">
              {ar ? 'من' : 'From'} <span className="num">{money(Math.min(...fees), lang)}</span> {ar ? 'لـ' : 'to'} <span className="num">{money(Math.max(...fees), lang)}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
