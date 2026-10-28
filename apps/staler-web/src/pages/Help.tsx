import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  Fingerprint,
  KeyRound,
  Landmark,
  LifeBuoy,
  MapPin,
  Megaphone,
  MessageCircle,
  QrCode,
  ScanLine,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Store,
  Ticket,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Button, cx } from '../components/ui';
import { StarMotif } from '../components/Tatreez';

type Step = { icon: typeof Wallet; title: [string, string]; body: [string, string] };
type Topic = { id: string; icon: typeof Wallet; title: [string, string]; color: string; steps: Step[]; to?: string };

// [English, Arabic]
const TOPICS: Topic[] = [
  {
    id: 'start',
    icon: Wallet,
    color: '#141B3D',
    title: ['Your wallet', 'محفظتك'],
    to: '/app',
    steps: [
      { icon: Wallet, title: ['Your balance, always on top', 'رصيدك دايمًا قدّامك'], body: ['The home screen shows what you have and what moved this month. Tap any movement to see its details.', 'الصفحة الرئيسية بتعرضلك رصيدك وشو تحرّك هالشهر. اكبس على أي حركة لتشوف تفاصيلها.'] },
      { icon: BadgeCheck, title: ['Your wallet ID', 'رقم محفظتك'], body: ['It works like an account number: share it so people can send you money. Copy it with one tap.', 'هو متل رقم الحساب: شاركه ليقدروا الناس يبعتولك مصاري. انسخه بكبسة.'] },
      { icon: Fingerprint, title: ['Open it with your fingerprint', 'افتحها ببصمتك'], body: ['On the Android app, turn on fingerprint unlock in Settings — no more typing your password.', 'بتطبيق أندرويد، شغّل الفتح بالبصمة من الإعدادات — بلا ما تكتب كلمة السر كل مرة.'] },
    ],
  },
  {
    id: 'send',
    icon: ArrowLeftRight,
    color: '#5A1424',
    title: ['Send & receive', 'تحويل واستلام'],
    to: '/app/send',
    steps: [
      { icon: Users, title: ['Pick someone', 'اختار الشخص'], body: ['Type a wallet ID or e-mail, or pick from your contacts. We show you the name before anything leaves.', 'اكتب رقم المحفظة أو الإيميل، أو اختار من جهات اتصالك. منعرضلك الاسم قبل ما يطلع أي شيكل.'] },
      { icon: ShieldCheck, title: ['Check and confirm', 'راجع وأكّد'], body: ['Every payment asks you to confirm the exact amount. Wallet-to-wallet transfers are free.', 'كل دفعة بتطلب منك تأكيد المبلغ بالزبط. التحويل بين المحافظ ببلاش.'] },
      { icon: QrCode, title: ['Get paid by QR', 'استلم بالـ QR'], body: ['Open Receive, set an amount if you like, and let the other person scan. Done in seconds.', 'افتح «استلام»، حدّد مبلغ إذا بدك، وخلّي الشخص التاني يمسح. خلصت بثواني.'] },
      { icon: Ticket, title: ['Cash vouchers', 'قسائم نقدية'], body: ['Handing cash value to someone in person? Create a voucher: the amount leaves your wallet and they claim it by scanning.', 'بدك تسلّم حدا قيمة كاش وجهًا لوجه؟ اعمل قسيمة: المبلغ بينخصم منك وهو بيستلمه بمسح الكود.'] },
    ],
  },
  {
    id: 'bank',
    icon: Landmark,
    color: '#2F3F18',
    title: ['Your bank', 'بنكك'],
    to: '/app/bank',
    steps: [
      { icon: KeyRound, title: ['Link with a code', 'اربط بكود'], body: ['In TalerBank, create a link code and type it here. Your bank password never touches S-Taler.', 'من TalerBank اعمل كود ربط واكتبه هون. كلمة سر بنكك ما بتوصل S-Taler أبدًا.'] },
      { icon: ArrowLeftRight, title: ['Top up or send back', 'اشحن أو رجّع'], body: ['Move money from the bank to the wallet and back. You get a notification when it lands.', 'انقل مصاري من البنك للمحفظة وبالعكس. بيوصلك إشعار لما توصل.'] },
      { icon: ShieldCheck, title: ['Locked against changes', 'الربط مقفول ضد التغيير'], body: ['Once linked, changing or removing the bank needs a code sent to your e-mail (and phone). A stolen session can’t redirect your money.', 'بعد الربط، تغيير البنك أو فكّه بدّه كود بيوصل على إيميلك (وجوالك). ما حدا بيقدر يحوّل مصاريك لو سرق جلستك.'] },
    ],
  },
  {
    id: 'shop',
    icon: ShoppingBag,
    color: '#1C3B4A',
    title: ['Shopping safely', 'التسوّق بأمان'],
    to: '/stores',
    steps: [
      { icon: Store, title: ['Find a store', 'لاقي متجر'], body: ['Browse stores by category or city, see who owns them, their branches and offers.', 'تصفّح المتاجر حسب التصنيف أو المدينة، وشوف مين صاحبها وفروعها وعروضها.'] },
      { icon: ShieldCheck, title: ['Your money waits', 'مصاريك بتستنى'], body: ['When you pay, the money is held by S-Taler — the store only gets it after you receive your order.', 'لما تدفع، المبلغ بيضل محفوظ عند S-Taler — والمتجر ما بقبضه إلا بعد ما يوصلك طلبك.'] },
      { icon: BadgeCheck, title: ['Deposit (عربون)', 'العربون'], body: ['Some items ask for a deposit now and the rest on delivery or pickup. You can pay the rest in the app or in cash.', 'بعض المنتجات بتطلب عربون هلّأ والباقي عند التوصيل أو الاستلام. بتقدر تدفع الباقي بالتطبيق أو كاش.'] },
      { icon: MapPin, title: ['Track it on the map', 'تابعه على الخريطة'], body: ['The store updates where your order is. You see every step and the latest location live.', 'المتجر بيحدّث وين صار طلبك. بتشوف كل خطوة وآخر موقع أول بأول.'] },
      { icon: KeyRound, title: ['Your handover code', 'رمز الاستلام'], body: ['Each order has a 6-digit code only you see. Give it to the courier only when the order is in your hands — that’s what pays the store.', 'كل طلب إله رمز من 6 أرقام إنت بس بتشوفه. أعطيه للمندوب لما يكون الطلب بإيدك — هو اللي بيدفع للمتجر.'] },
      { icon: LifeBuoy, title: ['Something wrong?', 'في مشكلة؟'], body: ['Report a problem from the order. The payment freezes until support decides — fairly, for both sides.', 'بلّغ عن مشكلة من الطلب. الدفعة بتتجمّد لحد ما يقرر الدعم — بعدل للطرفين.'] },
    ],
  },
  {
    id: 'digital',
    icon: BookOpen,
    color: '#4A2C10',
    title: ['Digital files', 'الملفات الرقمية'],
    to: '/app/orders',
    steps: [
      { icon: BookOpen, title: ['Read or download', 'اقرأ أو نزّل'], body: ['Open your purchase from My orders. Some files are read inside the app only.', 'افتح مشترياتك من «طلباتي». بعض الملفات بتنقرأ داخل التطبيق بس.'] },
      { icon: BadgeCheck, title: ['Your personal copy', 'نسختك الشخصية'], body: ['Every copy carries your e-mail and a licence code on each page. Please don’t share it — a leaked copy leads back to the buyer.', 'كل نسخة عليها إيميلك ورقم ترخيص على كل صفحة. لا تشاركها — النسخة المسرّبة بتدلّ على مين اشتراها.'] },
    ],
  },
  {
    id: 'merchant',
    icon: Megaphone,
    color: '#7A2E8C',
    title: ['For stores', 'لأصحاب المتاجر'],
    to: '/app/merchant',
    steps: [
      { icon: Store, title: ['Stores and branches', 'متاجر وفروع'], body: ['Open several stores, add branches by city, pick a colour, logo, cover and a pin on the map.', 'افتح أكثر من متجر، أضف فروع حسب المدينة، واختار لون وشعار وغلاف ومكان على الخريطة.'] },
      { icon: Megaphone, title: ['Ads that move', 'إعلانات بتتحرك'], body: ['Upload images or short videos as offers on top of your store page.', 'ارفع صور أو فيديوهات قصيرة كعروض فوق صفحة متجرك.'] },
      { icon: Truck, title: ['Deliver and get paid', 'وصّل واقبض'], body: ['Accept, ship, share your location, then enter the buyer’s handover code (or scan it). The money arrives instantly.', 'اقبل، اشحن، شارك موقعك، وبعدين اكتب رمز استلام المشتري (أو امسحه). المصاري بتوصلك فورًا.'] },
      { icon: Share2, title: ['Share your link', 'شارك رابطك'], body: ['Send your store link on WhatsApp, Facebook, Telegram or to people on S-Taler. It opens straight on your store.', 'ابعت رابط متجرك على واتساب وفيسبوك وتيليجرام أو لناس على S-Taler. بيفتح مباشرة على متجرك.'] },
    ],
  },
  {
    id: 'chat',
    icon: MessageCircle,
    color: '#0F5F5C',
    title: ['Messages & contacts', 'الرسائل وجهات الاتصال'],
    to: '/app/messages',
    steps: [
      { icon: MessageCircle, title: ['Chat securely', 'دردش بأمان'], body: ['Messages are encrypted. React with an emoji, reply, edit within 15 minutes, or delete.', 'الرسائل مشفّرة. تفاعل بإيموجي، رد، عدّل خلال 15 دقيقة، أو احذف.'] },
      { icon: Users, title: ['Save your people', 'احفظ ناسك'], body: ['Save anyone to contacts with the name you like, then pay or message them in one tap.', 'احفظ أي حدا بجهات الاتصال بالاسم اللي بتحبه، وادفعله أو راسله بكبسة.'] },
      { icon: ScanLine, title: ['Support is one tap away', 'الدعم بكبسة'], body: ['Start a conversation with support from Messages any time.', 'افتح محادثة مع الدعم من الرسائل بأي وقت.'] },
    ],
  },
];

export default function Help() {
  const { lang } = useI18n();
  const L = lang === 'ar' ? 1 : 0;
  const [topic, setTopic] = useState(TOPICS[0]!.id);
  const cur = TOPICS.find((x) => x.id === topic)!;
  return (
    <div className="mx-auto max-w-4xl">
      <section className="relative mb-6 overflow-hidden rounded-[2rem] p-6 text-white sm:p-10" style={{ background: cur.color, transition: 'background .5s' }}>
        <motion.div className="pointer-events-none absolute -end-10 -top-10 h-64 w-64 opacity-60" animate={{ rotate: 360 }} transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}>
          <StarMotif size={19} cell={14} className="h-full w-full" colors={['#E2506A', '#E9C060']} animate={false} />
        </motion.div>
        <p className="relative text-sm text-white/70">{lang === 'ar' ? 'دليل S-Taler' : 'S-Taler guide'}</p>
        <AnimatePresence mode="popLayout">
          <motion.h1 key={cur.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="relative mt-1 font-display text-4xl sm:text-5xl">
            {cur.title[L]}
          </motion.h1>
        </AnimatePresence>
        {cur.to && (
          <Link to={cur.to} className="relative mt-5 inline-block">
            <Button variant="secondary">{lang === 'ar' ? 'جرّبها هلّأ' : 'Try it now'}</Button>
          </Link>
        )}
      </section>

      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist">
        {TOPICS.map((x) => {
          const on = x.id === topic;
          return (
            <button
              key={x.id}
              role="tab"
              aria-selected={on}
              onClick={() => setTopic(x.id)}
              className={cx('relative flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm transition', on ? 'border-transparent text-white' : 'border-line bg-surface text-muted hover:text-ink')}
            >
              {on && <motion.span layoutId="help-pill" className="absolute inset-0 rounded-full" style={{ background: x.color }} transition={{ type: 'spring', bounce: 0.25 }} />}
              <x.icon className="relative h-4 w-4" />
              <span className="relative">{x.title[L]}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.ol key={cur.id} className="relative space-y-4 ps-8" initial="hidden" animate="show" exit="hidden" variants={{ show: { transition: { staggerChildren: 0.09 } } }}>
          <motion.span
            className="absolute start-[0.95rem] top-2 w-0.5 rounded-full"
            style={{ background: cur.color }}
            initial={{ height: 0 }}
            animate={{ height: 'calc(100% - 1rem)' }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
          {cur.steps.map((s, i) => (
            <motion.li
              key={s.title[0]}
              variants={{ hidden: { opacity: 0, x: L ? -24 : 24, scale: 0.97 }, show: { opacity: 1, x: 0, scale: 1 } }}
              transition={{ type: 'spring', bounce: 0.3 }}
              className="relative"
            >
              <span className="absolute -start-8 top-4 grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-white shadow" style={{ background: cur.color }}>
                <span className="num">{i + 1}</span>
              </span>
              <div className="card flex gap-4 p-5">
                <motion.span whileHover={{ rotate: -10, scale: 1.1 }} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: cur.color }}>
                  <s.icon className="h-6 w-6" />
                </motion.span>
                <div>
                  <h2 className="text-lg font-semibold">{s.title[L]}</h2>
                  <p className="mt-1 text-muted">{s.body[L]}</p>
                </div>
              </div>
            </motion.li>
          ))}
        </motion.ol>
      </AnimatePresence>
    </div>
  );
}
