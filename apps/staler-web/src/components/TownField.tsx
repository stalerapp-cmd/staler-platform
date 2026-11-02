import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, MapPin, Search } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { GOVERNORATES, REGIONS, placeKey, type Governorate } from '../lib/places';
import { Sheet, cx } from './ui';

const W = {
  ar: { pick: 'اختار المدينة أو البلدة', search: 'دوّر على مدينة، بلدة أو قرية', none: 'ما لقينا هالمكان — جرّب تكتبه بطريقة ثانية.', use: 'استعمل «{q}» زي ما هو', gov: 'محافظة {g}' },
  en: { pick: 'Choose a city or town', search: 'Search a city, town or village', none: 'No place matches — try spelling it another way.', use: 'Use “{q}” as written', gov: '{g} governorate' },
};

/** Which governorate a town belongs to (for showing "Huwwara · Nablus"). */
export function govOf(town: string) {
  const k = placeKey(town);
  return GOVERNORATES.find((g) => g.towns.some((t) => placeKey(t) === k));
}

/**
 * One city, town or village from the list of Palestine — the same list the
 * market's place filter uses — chosen from a searchable sheet. Something not in
 * the list can still be typed and used as written.
 */
export function TownField({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  const { lang } = useI18n();
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const needle = placeKey(q);
  const gov = value ? govOf(value) : undefined;
  const groups = useMemo(() => {
    const byRegion = new Map<Governorate['region'], { g: Governorate; towns: string[] }[]>();
    for (const g of GOVERNORATES) {
      const nameHit = !needle || placeKey(g.ar).includes(needle) || placeKey(g.en).includes(needle);
      const towns = needle && !nameHit ? g.towns.filter((t) => placeKey(t).includes(needle)) : g.towns;
      if (!towns.length) continue;
      const list = byRegion.get(g.region) ?? [];
      list.push({ g, towns });
      byRegion.set(g.region, list);
    }
    return [...byRegion.entries()];
  }, [needle]);
  const pick = (town: string) => {
    onChange(town);
    setOpen(false);
    setQ('');
  };

  return (
    <div className={className}>
      <span className="mb-1.5 block text-sm font-medium text-ink/80">{label}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="field flex w-full items-center gap-3 text-start"
      >
        <MapPin className={cx('h-5 w-5 shrink-0', value ? 'text-stitch' : 'text-muted')} />
        <span className="min-w-0 flex-1">
          {value ? (
            <>
              <span className="block truncate font-medium">{value}</span>
              {gov && placeKey(gov.ar) !== placeKey(value) && <span className="block truncate text-xs text-muted">{lang === 'ar' ? gov.ar : gov.en}</span>}
            </>
          ) : (
            <span className="text-muted">{w.pick}</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={w.pick}>
        <label className="relative mb-4 block">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={w.search} className="field h-12 rounded-2xl ps-12" type="search" autoFocus />
        </label>
        {q.trim().length >= 2 && (
          <button type="button" onClick={() => pick(q.trim())} className="mb-4 flex w-full items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-start text-sm text-muted transition hover:border-ink/30 hover:text-ink">
            <MapPin className="h-4 w-4" /> {w.use.replace('{q}', q.trim())}
          </button>
        )}
        {!groups.length ? (
          <p className="py-8 text-center text-sm text-muted">{w.none}</p>
        ) : (
          <div className="space-y-5">
            {groups.map(([region, list]) => (
              <section key={region}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink/70">
                  <span className="h-1.5 w-1.5 rotate-45 bg-stitch" /> {REGIONS[region][lang === 'ar' ? 'ar' : 'en']}
                </h3>
                <div className="overflow-hidden rounded-2xl ring-1 ring-line">
                  {list.map(({ g, towns }) => {
                    const isOpen = expanded === g.id || !!needle;
                    const here = towns.some((t) => placeKey(t) === placeKey(value));
                    return (
                      <div key={g.id} className="border-b border-line last:border-b-0">
                        <button type="button" onClick={() => setExpanded(isOpen && !needle ? null : g.id)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-sunk/60', here && 'bg-sky/[0.05]')} aria-expanded={isOpen}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{lang === 'ar' ? g.ar : g.en}</span>
                            <span className="block text-xs text-muted">{here ? value : `${g.towns.length}`}</span>
                          </span>
                          {!needle && <ChevronDown className={cx('h-4 w-4 text-muted transition-transform', isOpen && 'rotate-180')} />}
                        </button>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="flex flex-wrap gap-1.5 px-4 pb-3.5">
                                {towns.map((t) => {
                                  const on = placeKey(t) === placeKey(value);
                                  return (
                                    <button
                                      key={t}
                                      type="button"
                                      onClick={() => pick(t)}
                                      className={cx('flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition', on ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80 hover:text-ink')}
                                    >
                                      {on && <Check className="h-3 w-3" />}
                                      {t}
                                    </button>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
