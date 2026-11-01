import { motion } from 'framer-motion';
import { Banknote, Eye, Headset, Link2, Landmark, Megaphone, ShieldAlert, Sparkles, Store, Users, Wrench, type LucideIcon } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { CheckMark } from './Choice';
import { cx } from './ui';

type Risk = 'low' | 'mid' | 'high';

const GROUPS: { id: string; icon: LucideIcon; tone: string; perms: string[] }[] = [
  { id: 'people', icon: Users, tone: 'text-sky bg-sky/10', perms: ['users.view', 'users.money', 'users.devices', 'users.edit', 'users.role', 'users.status', 'users.password', 'users.security'] },
  { id: 'danger', icon: ShieldAlert, tone: 'text-stitch bg-stitch/10', perms: ['users.delete', 'users.force_delete', 'wallets.freeze'] },
  { id: 'commerce', icon: Store, tone: 'text-[rgb(150_105_10)] bg-gold/15 dark:text-gold', perms: ['stores.manage', 'stores.delete', 'agents.manage', 'orders.disputes'] },
  { id: 'comms', icon: Megaphone, tone: 'text-olive bg-olive/12', perms: ['support', 'notify', 'pending.manage'] },
  { id: 'system', icon: Landmark, tone: 'text-night bg-night/10 dark:text-white dark:bg-white/10', perms: ['bank.ops', 'audit.view', 'settings.manage'] },
];

const RISK: Record<string, Risk> = {
  'users.view': 'low', 'support': 'low', 'pending.manage': 'low', 'audit.view': 'low',
  'users.money': 'mid', 'users.devices': 'mid', 'users.edit': 'mid', 'users.role': 'mid', 'users.status': 'mid', 'stores.manage': 'mid', 'agents.manage': 'mid', 'orders.disputes': 'mid', 'notify': 'mid',
  'users.password': 'high', 'users.security': 'high', 'users.delete': 'high', 'users.force_delete': 'high', 'wallets.freeze': 'high', 'stores.delete': 'high', 'bank.ops': 'high', 'settings.manage': 'high',
};

/** A permission that only makes sense with another one. */
const NEEDS: Record<string, string[]> = {
  'users.money': ['users.view'], 'users.devices': ['users.view'], 'users.edit': ['users.view'], 'users.role': ['users.view'], 'users.status': ['users.view'],
  'users.password': ['users.view'], 'users.security': ['users.view'], 'users.delete': ['users.view'], 'users.force_delete': ['users.delete', 'users.money'],
  'wallets.freeze': ['users.view', 'users.money'], 'stores.delete': ['stores.manage'],
};

const PRESETS: { id: string; icon: LucideIcon; perms: string[] | 'all' }[] = [
  { id: 'readonly', icon: Eye, perms: ['users.view', 'audit.view'] },
  { id: 'support', icon: Headset, perms: ['users.view', 'users.devices', 'support', 'pending.manage', 'orders.disputes'] },
  { id: 'moderator', icon: Wrench, perms: ['users.view', 'users.edit', 'users.status', 'stores.manage', 'agents.manage', 'orders.disputes', 'notify'] },
  { id: 'finance', icon: Banknote, perms: ['users.view', 'users.money', 'wallets.freeze', 'bank.ops', 'audit.view'] },
  { id: 'all', icon: Sparkles, perms: 'all' },
];

/** Add what a choice needs; removing a need removes what depends on it. */
function withNeeds(set: Set<string>, all: string[]) {
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of [...set]) for (const n of NEEDS[p] ?? []) if (all.includes(n) && !set.has(n)) (set.add(n), (grew = true));
  }
  return set;
}
function withoutDependents(set: Set<string>) {
  let shrank = true;
  while (shrank) {
    shrank = false;
    for (const p of [...set]) if ((NEEDS[p] ?? []).some((n) => !set.has(n))) (set.delete(p), (shrank = true));
  }
  return set;
}

/**
 * What an administrator may see and do, grouped by area. Each line says what it
 * opens, how sensitive it is, and turning one on brings the ones it needs with it.
 */
export function PermissionEditor({ all, value, onChange }: { all: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  const P = t.permx;
  const has = new Set(value);
  const known = new Set(GROUPS.flatMap((g) => g.perms));
  const groups = [...GROUPS.map((g) => ({ ...g, perms: g.perms.filter((p) => all.includes(p)) })), { id: 'other', icon: Sparkles, tone: 'text-muted bg-sunk', perms: all.filter((p) => !known.has(p)) }].filter((g) => g.perms.length);
  const set = (next: Set<string>) => onChange(all.filter((p) => next.has(p)));
  const toggle = (p: string) => {
    const n = new Set(has);
    if (n.has(p)) set(withoutDependents((n.delete(p), n)));
    else set(withNeeds(n.add(p), all));
  };
  const preset = (perms: string[] | 'all') => set(withNeeds(new Set(perms === 'all' ? all : perms.filter((p) => all.includes(p))), all));
  const activePreset = PRESETS.find((x) => {
    const want = withNeeds(new Set(x.perms === 'all' ? all : x.perms.filter((p) => all.includes(p))), all);
    return want.size === has.size && [...want].every((p) => has.has(p));
  })?.id;
  const pct = all.length ? Math.round((value.length / all.length) * 100) : 0;
  const high = value.filter((p) => RISK[p] === 'high').length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 rounded-2xl bg-sunk/70 p-3.5">
        <div className="relative grid h-14 w-14 shrink-0 place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgb(var(--line))" strokeWidth="3.5" />
            <motion.circle cx="18" cy="18" r="15.5" fill="none" stroke="rgb(var(--sky))" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="97.4" animate={{ strokeDashoffset: 97.4 - (97.4 * pct) / 100 }} transition={{ type: 'spring', bounce: 0.2 }} />
          </svg>
          <span className="num text-sm font-bold">{value.length}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{P.count.replace('{n}', String(value.length)).replace('{all}', String(all.length))}</p>
          <p className="text-xs text-muted">{high ? P.highN.replace('{n}', String(high)) : value.length ? P.noHigh : P.none}</p>
        </div>
      </div>

      {/* Ready-made roles */}
      <div>
        <p className="mb-2 text-sm font-semibold text-ink/80">{P.presets}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {PRESETS.map((x) => {
            const on = activePreset === x.id;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => preset(x.perms)}
                className={cx('flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 text-center text-xs transition', on ? 'border-sky bg-sky/[0.08] font-semibold text-ink shadow-[0_6px_18px_-12px_rgb(var(--sky))]' : 'border-line bg-surface text-ink/80 hover:border-ink/25')}
              >
                <x.icon className={cx('h-5 w-5', on ? 'text-sky' : 'text-muted')} />
                <span>{P.preset[x.id]}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => set(new Set())} className={cx('flex flex-col items-center gap-1.5 rounded-2xl border border-dashed p-2.5 text-center text-xs transition', value.length ? 'border-line text-muted hover:border-stitch/50 hover:text-stitch' : 'border-stitch/40 font-semibold text-stitch')}>
            <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-current text-[10px] font-bold">0</span>
            <span>{P.clearAll}</span>
          </button>
        </div>
      </div>

      {/* Groups */}
      {groups.map((g) => {
        const on = g.perms.filter((p) => has.has(p)).length;
        const full = on === g.perms.length;
        return (
          <section key={g.id} className="overflow-hidden rounded-2xl ring-1 ring-line">
            <header className="flex items-center gap-3 bg-surface px-3.5 py-3">
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', g.tone)}>
                <g.icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{P.group[g.id]}</p>
                <p className="truncate text-xs text-muted">{P.groupD[g.id]}</p>
              </div>
              <span className="num shrink-0 text-xs text-muted">
                {on}/{g.perms.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  const n = new Set(has);
                  if (full) set(withoutDependents((g.perms.forEach((p) => n.delete(p)), n)));
                  else set(withNeeds((g.perms.forEach((p) => n.add(p)), n), all));
                }}
                className={cx('shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition', full ? 'bg-night text-white dark:bg-white/15' : 'bg-sunk text-ink/80 hover:text-ink')}
              >
                {full ? P.groupNone : P.groupAll}
              </button>
            </header>
            <ul className="divide-y divide-line border-t border-line bg-bg/40">
              {g.perms.map((p) => {
                const checked = has.has(p);
                const risk = RISK[p] ?? 'mid';
                const needs = (NEEDS[p] ?? []).filter((n) => all.includes(n));
                const missing = needs.filter((n) => !has.has(n));
                // Shown under its base permission when that base lives in the same group.
                const child = needs.some((n) => g.perms.includes(n));
                return (
                  <li key={p} className="relative">
                    {child && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-[1.55rem] w-px bg-line" />}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggle(p)}
                      className={cx('relative flex w-full items-start gap-3 py-3 pe-3.5 text-start transition', child ? 'ps-11' : 'ps-3.5', checked ? 'bg-sky/[0.05]' : 'hover:bg-sunk/50')}
                    >
                      {child && <span aria-hidden="true" className="absolute start-[1.55rem] top-[1.45rem] h-px w-3.5 bg-line" />}
                      <span className="pt-0.5">
                        <CheckMark on={checked} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={cx('text-sm', checked ? 'font-semibold text-ink' : 'font-medium text-ink/85')}>{t.people.perm[p] ?? p}</span>
                          {risk !== 'low' && <span className={cx('rounded-full px-2 py-0.5 text-[10px] font-bold', risk === 'high' ? 'bg-stitch/12 text-stitch' : 'bg-gold/20 text-[rgb(150_105_10)] dark:text-gold')}>{P.risk[risk]}</span>}
                        </span>
                        {P.permD[p] && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{P.permD[p]}</span>}
                        {!checked && missing.length > 0 && (
                          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[11px] text-muted">
                            <Link2 className="h-3 w-3" /> {P.needs} {missing.map((n) => t.people.perm[n] ?? n).join('، ')}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
