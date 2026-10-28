import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, BellRing, Download, Link2, QrCode } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { isNative } from '../lib/api';
import { AccountCard } from '../components/Bank';
import { Emblem, Guilloche } from '../components/Guilloche';
import { AppDownloads } from '../components/AppDownloads';
import { Button } from '../components/ui';
import { TopControls } from '../layouts/Shell';

export default function Landing() {
  const { t } = useI18n();
  const L = t.landing;
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const plateY = useTransform(scrollY, [0, 600], [0, -50]);
  const features = [
    { icon: ArrowRightLeft, title: L.f1t, d: L.f1d },
    { icon: QrCode, title: L.f2t, d: L.f2d },
    { icon: Link2, title: L.f3t, d: L.f3d },
    { icon: BellRing, title: L.f4t, d: L.f4d },
  ];
  return (
    <div className="min-h-dvh overflow-x-clip bg-bg">
      <header className="safe-top relative z-20">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-2 px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <Emblem className="h-9 w-9" />
            <span className="font-display text-2xl">TalerBank</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <TopControls />
            <Link to="/login" className="hidden sm:block">
              <Button variant="ghost">{L.signIn}</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative">
        <Guilloche className="pointer-events-none absolute -end-56 -top-48 -z-0 h-[720px] w-[720px] opacity-50" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
          <div>
            <motion.h1
              initial={reduce ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-[clamp(2.7rem,6.8vw,5.2rem)] leading-[1.02]"
            >
              {L.title}
            </motion.h1>
            <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mt-6 max-w-xl text-lg text-muted">
              {L.lead}
            </motion.p>
            <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/register">
                <Button size="lg">{L.open}</Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="secondary">
                  {L.signIn}
                </Button>
              </Link>
              {!isNative && (
                <a href="#download" className="inline-flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-medium text-muted transition hover:text-ink">
                  <Download className="h-4 w-4" /> {t.dl.download}
                </a>
              )}
            </motion.div>
            <dl className="mt-14 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-6">
              {[
                ['IBAN', L.stat1],
                ['24/7', L.stat2],
                ['2FA', L.stat3],
              ].map(([n, l], i) => (
                <motion.div key={l} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 + i * 0.1 }}>
                  <dt className="num font-display text-2xl text-gold">{n}</dt>
                  <dd className="mt-1 text-sm text-muted">{l}</dd>
                </motion.div>
              ))}
            </dl>
          </div>
          <motion.div
            style={reduce ? undefined : { y: plateY }}
            initial={reduce ? false : { opacity: 0, rotate: 0, scale: 0.94 }}
            animate={{ opacity: 1, rotate: -3, scale: 1 }}
            transition={{ delay: 0.9, type: 'spring', bounce: 0.25 }}
            className="mx-auto w-full max-w-md lg:max-w-none"
          >
            <AccountCard
              holder="Layla Haddad"
              account={{ id: 'demo', account_number: 'TB4917207166', iban: 'PS31TLRB111301735598875049875', currency: 'PS', balance: '12480.50', is_locked: false, nickname: null }}
            />
          </motion.div>
        </div>
      </section>

      <section className="border-y border-line bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-px overflow-hidden px-5 py-20 sm:grid-cols-2 lg:grid-cols-4 lg:gap-10">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className="py-6 sm:pe-6"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-gold/30 bg-gold/10 text-gold">
                <f.icon className="h-6 w-6" strokeWidth={1.6} />
              </span>
              <h2 className="mt-5 text-xl">{f.title}</h2>
              <p className="mt-2 text-muted">{f.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="engraved relative overflow-hidden bg-night text-[#ECE6D8]">
        <Guilloche className="pointer-events-none absolute -bottom-72 -start-60 h-[640px] w-[640px] opacity-40" spin={false} />
        <div className="relative mx-auto max-w-6xl px-5 pt-20">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-end md:justify-between">
            <p className="max-w-xl font-display text-3xl leading-tight sm:text-5xl">{t.brand.tagline}</p>
            <Link to="/register">
              <Button size="lg">{L.open}</Button>
            </Link>
          </div>
          <div className="mt-16 sm:mt-20">
            <AppDownloads self="bank" />
          </div>
          <footer className="safe-bottom mt-16 flex flex-col gap-6 border-t border-white/10 py-8 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Emblem className="h-10 w-10" />
              <div>
                <p className="font-display text-lg">TalerBank</p>
                <p className="text-sm text-white/60">{t.foot.aboutBank}</p>
              </div>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/70">
              <Link to="/register" className="hover:text-white">{L.open}</Link>
              <Link to="/login" className="hover:text-white">{L.signIn}</Link>
              <a href="https://s-taler.onrender.com" rel="noopener" className="hover:text-white">{t.foot.wallet} ↗</a>
            </nav>
          </footer>
        </div>
      </section>
    </div>
  );
}
