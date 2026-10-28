/**
 * Public-site helpers: search-engine friendly HTML, robots.txt, sitemap.xml and
 * the "latest Android app" lookup used by the download section.
 *
 * The web app is a single-page app, so without this every URL would return the
 * same bare <head>. Here each public page gets its own title, description,
 * canonical URL, hreflang alternates (Arabic + English), Open Graph / Twitter
 * cards and JSON-LD — in the language the visitor (or crawler) asked for.
 */
import { readFileSync } from 'node:fs';
import type { Express, Request } from 'express';

export interface PageMeta {
  title: string;
  description: string;
}
export interface SiteConfig {
  name: string;
  publicUrl: string;
  themeColor: string;
  /** Public, indexable routes and their copy per language. */
  pages: Record<string, { ar: PageMeta; en: PageMeta; priority: number }>;
  jsonLd: (base: string, lang: 'ar' | 'en') => object[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function pickLang(req: Request): 'ar' | 'en' {
  const q = String(req.query.lang ?? '').toLowerCase();
  if (q === 'en' || q === 'ar') return q;
  return /^en\b/i.test(String(req.headers['accept-language'] ?? '')) ? 'en' : 'ar';
}

export function makeIndexRenderer(indexFile: string, cfg: SiteConfig) {
  const template = readFileSync(indexFile, 'utf8');
  const base = cfg.publicUrl.replace(/\/$/, '');
  const cache = new Map<string, string>();
  return (req: Request) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    const lang = pickLang(req);
    const key = `${path}|${lang}|${req.query.lang ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const page = cfg.pages[path];
    const meta = page?.[lang] ?? cfg.pages['/']![lang];
    const url = (l?: 'ar' | 'en') => `${base}${path === '/' ? '/' : path}${l ? `?lang=${l}` : ''}`;
    const head = [
      `<title>${esc(meta.title)}</title>`,
      `<meta name="description" content="${esc(meta.description)}" />`,
      page ? `<meta name="robots" content="index, follow, max-image-preview:large" />` : `<meta name="robots" content="noindex, nofollow" />`,
      page ? `<link rel="canonical" href="${esc(url(lang))}" />` : '',
      page ? `<link rel="alternate" hreflang="ar" href="${esc(url('ar'))}" />` : '',
      page ? `<link rel="alternate" hreflang="en" href="${esc(url('en'))}" />` : '',
      page ? `<link rel="alternate" hreflang="x-default" href="${esc(url())}" />` : '',
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(cfg.name)}" />`,
      `<meta property="og:title" content="${esc(meta.title)}" />`,
      `<meta property="og:description" content="${esc(meta.description)}" />`,
      `<meta property="og:url" content="${esc(url(lang))}" />`,
      `<meta property="og:image" content="${base}/og.png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:locale" content="${lang === 'ar' ? 'ar_PS' : 'en_US'}" />`,
      `<meta property="og:locale:alternate" content="${lang === 'ar' ? 'en_US' : 'ar_PS'}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${esc(meta.title)}" />`,
      `<meta name="twitter:description" content="${esc(meta.description)}" />`,
      `<meta name="twitter:image" content="${base}/og.png" />`,
      page && path === '/' ? `<script type="application/ld+json">${JSON.stringify(cfg.jsonLd(base, lang)).replace(/</g, '\\u003c')}</script>` : '',
    ]
      .filter(Boolean)
      .join('\n    ');
    const html = template
      .replace(/<html lang="[^"]*" dir="[^"]*">/, `<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`)
      .replace(/<title>[^<]*<\/title>/, '')
      .replace(/<meta name="description"[^>]*>/, '')
      .replace('</head>', `    ${head}\n  </head>`);
    if (cache.size > 200) cache.clear();
    cache.set(key, html);
    return html;
  };
}

export function mountSeoFiles(app: Express, cfg: SiteConfig) {
  const base = cfg.publicUrl.replace(/\/$/, '');
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api/\nDisallow: /files/\n\nSitemap: ${base}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const urls = Object.entries(cfg.pages)
      .map(([p, v]) => {
        const loc = `${base}${p === '/' ? '/' : p}`;
        return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${v.priority.toFixed(1)}</priority>
    <xhtml:link rel="alternate" hreflang="ar" href="${loc}?lang=ar"/>
    <xhtml:link rel="alternate" hreflang="en" href="${loc}?lang=en"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}"/>
  </url>`;
      })
      .join('\n');
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
  });
}

/* ------------------------------------------------------------------ APKs */

const REPO = 'stalerapp-cmd/staler-platform';
export const APK_ASSETS = { staler: 's-taler.apk', bank: 'talerbank.apk' } as const;
type Release = {
  version: string | null;
  publishedAt: string | null;
  apps: Record<keyof typeof APK_ASSETS, { url: string; size: number | null; available: boolean }>;
};
let cached: { at: number; data: Release } | null = null;
const fallback = (): Release => ({
  version: null,
  publishedAt: null,
  apps: {
    staler: { url: `https://github.com/${REPO}/releases/latest/download/${APK_ASSETS.staler}`, size: null, available: false },
    bank: { url: `https://github.com/${REPO}/releases/latest/download/${APK_ASSETS.bank}`, size: null, available: false },
  },
});

/** Latest published Android release (cached 10 min; stale copy on GitHub errors). */
export async function latestRelease(): Promise<Release> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.data;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'staler-platform' },
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
    if (!r.ok) throw new Error(`github ${r.status}`);
    const j: any = await r.json();
    const data = fallback();
    data.version = String(j.tag_name ?? '').replace(/^v/, '') || null;
    data.publishedAt = j.published_at ?? null;
    for (const k of Object.keys(APK_ASSETS) as (keyof typeof APK_ASSETS)[]) {
      const a = (j.assets ?? []).find((x: any) => x.name === APK_ASSETS[k]);
      if (a) data.apps[k] = { url: data.apps[k].url, size: Number(a.size) || null, available: true };
    }
    cached = { at: Date.now(), data };
    return data;
  } catch {
    if (cached) {
      cached.at = Date.now() - 8 * 60_000; // retry in ~2 minutes
      return cached.data;
    }
    return fallback();
  }
}

export function mountReleaseRoute(app: Express) {
  app.get('/api/app-release', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(await latestRelease());
  });
}
