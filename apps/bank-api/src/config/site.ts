import type { SiteConfig } from '../lib/site.js';
import { env } from './env.js';

export const site: SiteConfig = {
  name: 'TalerBank',
  publicUrl: env.PUBLIC_URL,
  themeColor: '#0F1A17',
  pages: {
    '/': {
      priority: 1,
      ar: {
        title: 'TalerBank | بنك رقمي فلسطيني — حسابك كامل من جوالك',
        description: 'افتح حساب بنكي رقمي برقم IBAN، حوّل لحظيًا، ادفع وطالب بالـ QR، واربط محفظة S-Taler بأمان من غير ما تشارك كلمة السر. حماية بتحقق بخطوتين وتنبيه مع كل حركة.',
      },
      en: {
        title: 'TalerBank — Palestinian digital banking, right from your phone',
        description: 'Open a digital account with its own IBAN, send instant transfers, pay and request by QR, and link your S-Taler wallet without ever sharing your password. Two-step sign-in and an alert for every movement.',
      },
    },
    '/register': {
      priority: 0.8,
      ar: { title: 'افتح حسابك في TalerBank مجانًا', description: 'حساب بنكي رقمي برقم IBAN خلال دقائق. سجّل ببريدك وابدأ فورًا.' },
      en: { title: 'Open your TalerBank account for free', description: 'A digital bank account with its own IBAN in minutes. Sign up with your e-mail and get started.' },
    },
    '/login': {
      priority: 0.5,
      ar: { title: 'تسجيل الدخول | TalerBank', description: 'ادخل على حسابك في TalerBank بأمان.' },
      en: { title: 'Sign in | TalerBank', description: 'Sign in to your TalerBank account securely.' },
    },
  },
  jsonLd: (base, lang) => [
    { '@context': 'https://schema.org', '@type': 'BankOrCreditUnion', name: 'TalerBank', url: base, logo: `${base}/icon-512.png`, areaServed: 'PS' },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'TalerBank', url: base, inLanguage: lang === 'ar' ? 'ar' : 'en' },
    {
      '@context': 'https://schema.org',
      '@type': 'MobileApplication',
      name: 'TalerBank',
      operatingSystem: 'Android',
      applicationCategory: 'FinanceApplication',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'ILS' },
      downloadUrl: 'https://github.com/stalerapp-cmd/staler-platform/releases/latest/download/talerbank.apk',
      url: base,
    },
  ],
};
