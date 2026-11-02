import { useEffect, useState } from 'react';
import { get } from './api';
import { useI18n } from './i18n';

export interface CustomCategory {
  slug: string;
  name_ar: string;
  name_en: string;
}

const BUILT_IN = ['food', 'fashion', 'electronics', 'books', 'beauty', 'home', 'crafts', 'digital', 'services'];

// One fetch for the whole app; components re-render when it lands or changes.
let cache: CustomCategory[] | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
function load(force = false) {
  if (pending && !force) return pending;
  pending = get<{ categories: string[]; custom?: CustomCategory[] }>('/api/store/categories')
    .then((d) => {
      cache = d.custom ?? [];
      listeners.forEach((f) => f());
    })
    .catch(() => {
      pending = null;
    });
  return pending;
}
export const reloadCategories = () => load(true);

/**
 * Store categories: the built-in ones, then the ones store owners suggested and
 * an admin approved, then "Other". `label` names any of them in the current language.
 */
export function useCategories() {
  const { t, lang } = useI18n();
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    if (!cache) void load();
    return () => {
      listeners.delete(f);
    };
  }, []);
  const custom = cache ?? [];
  const keys = [...BUILT_IN, ...custom.map((c) => c.slug), 'other'];
  const label = (k?: string | null) => {
    const key = k || 'other';
    const c = custom.find((x) => x.slug === key);
    if (c) return lang === 'ar' ? c.name_ar : c.name_en;
    return t.shop.cat[key] ?? t.shop.cat.other ?? key;
  };
  const isCustom = (k?: string | null) => !!k && custom.some((x) => x.slug === k);
  return { keys, custom, label, isCustom };
}
