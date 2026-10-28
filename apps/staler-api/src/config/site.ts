import type { SiteConfig } from '../lib/site.js';
import { env } from './env.js';

export const site: SiteConfig = {
  name: 'S-Taler',
  publicUrl: env.PUBLIC_URL,
  themeColor: '#141B3D',
  pages: {
    '/': {
      priority: 1,
      ar: {
        title: 'S-Taler | محفظة إلكترونية فلسطينية للتحويل والدفع بالـ QR',
        description: 'حوّل واستلم وادفع بالـ QR بثواني ومن غير رسوم بين المحافظ. اشحن من TalerBank، تسوّق من متاجر فلسطينية، وخلّي فلوسك محمية بتحقق بخطوتين وتشفير كامل.',
      },
      en: {
        title: 'S-Taler — Palestinian digital wallet for instant transfers and QR payments',
        description: 'Send, receive and pay by QR in seconds with zero wallet-to-wallet fees. Top up from TalerBank, shop Palestinian stores, and stay protected with two-step sign-in and end-to-end encryption.',
      },
    },
    '/store': {
      priority: 0.8,
      ar: { title: 'متجر S-Taler | تسوّق من متاجر فلسطينية وادفع بأمان', description: 'منتجات من متاجر محلية، والدفع بمحفظتك بخطوة وحدة. فلوسك بتضل محفوظة لحتى يوصلك الطلب.' },
      en: { title: 'S-Taler Store — Shop Palestinian businesses and pay safely', description: 'Products from local stores, paid in one tap from your wallet. Your money is held safely until your order arrives.' },
    },
    '/register': {
      priority: 0.7,
      ar: { title: 'افتح محفظة S-Taler مجانًا خلال دقيقة', description: 'سجّل ببريدك وابدأ تحوّل وتدفع فورًا. حساب شخصي أو تجاري — مجانًا.' },
      en: { title: 'Open a free S-Taler wallet in under a minute', description: 'Sign up with your e-mail and start sending and paying right away. Personal or business — free.' },
    },
    '/login': {
      priority: 0.5,
      ar: { title: 'تسجيل الدخول | S-Taler', description: 'ادخل على محفظتك في S-Taler بأمان.' },
      en: { title: 'Sign in | S-Taler', description: 'Sign in to your S-Taler wallet securely.' },
    },
  },
  jsonLd: (base, lang) => [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'S-Taler', url: base, logo: `${base}/icon-512.png` },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'S-Taler', url: base, inLanguage: lang === 'ar' ? 'ar' : 'en' },
    {
      '@context': 'https://schema.org',
      '@type': 'MobileApplication',
      name: 'S-Taler',
      operatingSystem: 'Android',
      applicationCategory: 'FinanceApplication',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'ILS' },
      downloadUrl: 'https://github.com/stalerapp-cmd/staler-platform/releases/latest/download/s-taler.apk',
      url: base,
    },
  ],
};
