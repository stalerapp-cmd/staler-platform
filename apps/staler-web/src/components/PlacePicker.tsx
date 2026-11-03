import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, MapPin, Search } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { GOVERNORATES, REGIONS, placeKey, type Governorate } from '../lib/places';
import { CheckMark } from './Choice';
import { Button, Sheet, cx } from './ui';

const W = {
  ar: { title: 'وين بدك تتسوق؟', lead: 'اختار محافظة كاملة، أو بلدات وقرى محددة. فيك تختار أكثر من مكان.', search: 'دوّر على مدينة، بلدة أو قرية', whole: 'كل المحافظة', none: 'ما لقينا هالمكان — جرّب تكتبه بطريقة ثانية.', clear: 'امسح', apply: 'تمام', count: '{n} مكان' },
  en: { title: 'Where do you want to shop?', lead: 'Pick a whole governorate, or specific towns and villages. You can choose several.', search: 'Search a city, town or village', whole: 'Whole governorate', none: 'No place matches — try spelling it another way.', clear: 'Clear', apply: 'Done', count: '{n} places' },
};

/**
 * Palestine by governorate: tap a governorate to take all of it, or open it to pick
 * single towns and villages. Several places can be chosen at once.
 */
export function PlacePicker({ open, onClose, value, onChange, title, lead }: { open: boolean; onClose: () => void; value: string[]; onChange: (v: string[]) => void; title?: string; lead?: string }) {
  const { lang } = useI18n();
  const w = { ...W[lang === 'ar' ? 'ar' : 'en'], ...(title ? { title } : {}), ...(lead ? { lead } : {}) };
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const has = (k: string) => value.includes(k);
  const toggle = (k: string) => onChange(has(k) ? value.filter((x) => x !== k) : [...value, k]);

  const needle = placeKey(q);
  const groups = useMemo(() => {
    const byRegion = new Map<Governorate['region'], { g: Governorate; towns: string[] }[]>();
    for (const g of GOVERNORATES) {
      const nameHit = !needle || placeKey(g.ar).includes(needle) || placeKey(g.en).includes(needle);
      const towns = needle ? g.towns.filter((t) => placeKey(t).includes(needle)) : g.towns;
      if (!nameHit && !towns.length) continue;
      const list = byRegion.get(g.region) ?? [];
      list.push({ g, towns: nameHit && needle ? g.towns : towns });
      byRegion.set(g.region, list);
    }
    return [...byRegion.entries()];
  }, [needle]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={w.title}
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" className="shrink-0" onClick={() => onChange([])}>
            {w.clear}
          </Button>
          <Button className="flex-1" onClick={onClose}>
            {w.apply}
            {value.length > 0 && <span className="num ms-1.5 rounded-full bg-white/20 px-2 py-0.5 text-xs">{w.count.replace('{n}', String(value.length))}</span>}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted">{w.lead}</p>
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={w.search} className="field h-12 rounded-2xl ps-12" type="search" />
      </label>
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
                  const whole = has(`gov:${g.id}`);
                  const picked = g.towns.filter((t) => has(`town:${t}`)).length;
                  const isOpen = expanded === g.id || !!needle;
                  return (
                    <div key={g.id} className="border-b border-line last:border-b-0">
                      <div className={cx('flex items-center gap-2 px-3 py-2.5 transition', whole && 'bg-sky/[0.06]')}>
                        <button type="button" onClick={() => toggle(`gov:${g.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-start" aria-pressed={whole}>
                          <CheckMark on={whole} />
                          <span className="min-w-0">
                            <span className={cx('block truncate text-sm', whole ? 'font-semibold' : 'font-medium')}>{lang === 'ar' ? g.ar : g.en}</span>
                            <span className="block text-xs text-muted">{whole ? w.whole : picked ? w.count.replace('{n}', String(picked)) : `${g.towns.length}`}</span>
                          </span>
                        </button>
                        {!needle && (
                          <button type="button" onClick={() => setExpanded(isOpen ? null : g.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-sunk hover:text-ink" aria-expanded={isOpen}>
                            <ChevronDown className={cx('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
                          </button>
                        )}
                      </div>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                              {towns.map((t) => {
                                const on = has(`town:${t}`) || whole;
                                return (
                                  <button
                                    key={t}
                                    type="button"
                                    disabled={whole}
                                    onClick={() => toggle(`town:${t}`)}
                                    className={cx('flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition', on ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80 hover:text-ink', whole && 'opacity-70')}
                                  >
                                    {on && <MapPin className="h-3 w-3" />}
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
  );
}

/** Short label for a selection item. */
export function placeLabel(k: string, lang: string) {
  if (k.startsWith('gov:')) {
    const g = GOVERNORATES.find((x) => `gov:${x.id}` === k);
    return g ? (lang === 'ar' ? g.ar : g.en) : k;
  }
  return k.slice(5);
}
