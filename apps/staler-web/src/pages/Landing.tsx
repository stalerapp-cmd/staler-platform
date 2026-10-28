import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Landmark, Lock, QrCode, ShoppingBag } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Logo, StarMotif, StitchBand } from '../components/Tatreez';
import { BalanceCard } from '../components/Wallet';
import { Button } from '../components/ui';
import { TopControls } from '../layouts/AppShell';

export default function Landing() {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const starRotate = useTransform(scrollY, [0, 800], [0, 45]);
  const cardY = useTransform(scrollY, [0, 600], [0, -60]);

  const features = [
    { icon: QrCode, title: t.landing.f1t, d: t.landing.f1d, tone: 'text-stitch' },
    { icon: Landmark, title: t.landing.f2t, d: t.landing.f2d, tone: 'text-olive' },
    { icon: Lock, title: t.landing.f3t, d: t.landing.f3d, tone: 'text-sky' },
    { icon: ShoppingBag, title: t.landing.f4t, d: t.landing.f4d, tone: 'text-gold' },
  ];

  return (
    <div className="overflow-x-clip">
      <header className="safe-top relative z-20">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-3">
            <Logo animate />
            <span className="font-display text-xl">S-Taler</span>
          </Link>
          <div className="flex items-center gap-2">
            <TopControls />
            <Link to="/login" className="hidden sm:block">
              <Button variant="ghost">{t.landing.signIn}</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------- hero */}
      <section className="relative">
        <div className="stitch-ground absolute inset-0 -z-10 [mask-image:radial-gradient(70%_70%_at_50%_30%,black,transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-6 lg:grid-cols-[1.1fr_1fr] lg:pt-12">
          <div>
            <motion.h1
              initial={reduce ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-[clamp(2.6rem,6.5vw,4.8rem)] leading-[1.05] text-ink"
            >
              {t.landing.title}
            </motion.h1>
            <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mt-6 max-w-xl text-lg text-muted">
              {t.landing.lead}
            </motion.p>
            <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-9 flex flex-wrap gap-3">
              <Link to="/register">
                <Button size="lg" variant="stitch">
                  {t.landing.start}
                </Button>
              </Link>
              <Link to="/store">
                <Button size="lg" variant="secondary">
                  {t.landing.browse}
                </Button>
              </Link>
            </motion.div>
            <dl className="mt-14 grid max-w-lg grid-cols-3 gap-6">
              {[
                ['0%', t.landing.stat1],
                ['3s', t.landing.stat2],
                ['AES-256', t.landing.stat3],
              ].map(([n, l], i) => (
                <motion.div key={l} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 + i * 0.1 }}>
                  <dt className="num font-display text-2xl text-ink">{n}</dt>
                  <dd className="mt-1 text-sm text-muted">{l}</dd>
                </motion.div>
              ))}
            </dl>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <motion.div style={reduce ? undefined : { rotate: starRotate }} className="absolute -inset-10 -z-10 opacity-[0.9]">
              <StarMotif size={29} cell={18} className="h-full w-full" strokeWidth={1.8} />
            </motion.div>
            <motion.div style={reduce ? undefined : { y: cardY }} initial={reduce ? false : { opacity: 0, scale: 0.9, rotate: -4 }} animate={{ opacity: 1, scale: 1, rotate: -4 }} transition={{ delay: 1.2, type: 'spring', bounce: 0.3 }}>
              <BalanceCard balance="1248.50" walletId="wallet_qamar7k2nw4x" currency="PS" name="Layla Haddad" />
            </motion.div>
            <motion.div
              initial={reduce ? false : { opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.6 }}
              className="absolute -bottom-10 end-2 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card sm:end-6"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-olive/15 text-olive">
                <QrCode className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium">{t.tx.types.payment_received}</p>
                <p className="num text-sm text-olive">+ 35.00 PS</p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <StitchBand width={140} className="h-8 w-full opacity-70" />

      {/* -------------------------------------------------------- features */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid gap-x-12 gap-y-14 md:grid-cols-2">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={reduce ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: (i % 2) * 0.08 }}
              className={i % 2 ? 'md:translate-y-12' : ''}
            >
              <f.icon className={`h-8 w-8 ${f.tone}`} strokeWidth={1.6} />
              <h2 className="mt-4 text-2xl">{f.title}</h2>
              <p className="mt-2 max-w-md text-muted">{f.d}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ close */}
      <section className="relative overflow-hidden bg-night py-20 text-white">
        <div className="absolute -start-24 top-1/2 h-96 w-96 -translate-y-1/2 opacity-60">
          <StarMotif size={19} cell={20} className="h-full w-full" colors={['#E2506A', '#E9C060']} animate={false} />
        </div>
        <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 md:items-end md:text-end">
          <p className="max-w-xl font-display text-3xl sm:text-4xl">{t.brand.tagline}</p>
          <Link to="/register">
            <Button size="lg" variant="stitch">
              {t.landing.start}
            </Button>
          </Link>
        </div>
      </section>
      <footer className="safe-bottom mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted">
        <span>© {new Date().getFullYear()} S-Taler · An-Najah National University</span>
        <Link to="/login" className="hover:text-ink">
          {t.landing.signIn}
        </Link>
      </footer>
    </div>
  );
}
