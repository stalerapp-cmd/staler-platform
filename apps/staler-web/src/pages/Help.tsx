import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Hand,
  Plane,
  Ban,
  ArrowLeftRight,
  ArrowUpRight,
  AtSign,
  BadgeCheck,
  BadgePercent,
  PhoneCall,
  Repeat,
  BarChart3,
  CalendarDays,
  Flag,
  Trophy,
  Bell,
  BellRing,
  BookOpen,
  Camera,
  ClipboardList,
  Crown,
  FileClock,
  Fingerprint,
  Gift,
  GitBranch,
  HandCoins,
  HeartHandshake,
  KeyRound,
  Landmark,
  LifeBuoy,
  LockKeyhole,
  MapPin,
  MapPinned,
  Megaphone,
  MessageCircle,
  MonitorSmartphone,
  Package,
  QrCode,
  Scale,
  ScanLine,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Signpost,
  Star,
  Store,
  Tags,
  Ticket,
  Truck,
  UserCog,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Button, cx } from '../components/ui';
import { StarMotif } from '../components/Tatreez';

type Role = 'user' | 'merchant' | 'exchange' | 'admin';
type Group = 'all' | 'merchant' | 'exchange' | 'admin';
type Step = { icon: typeof Wallet; title: [string, string]; body: [string, string]; to?: string };
type Topic = { id: string; group: Group; icon: typeof Wallet; title: [string, string]; color: string; steps: Step[]; to?: string };

// [English, Arabic]
const TOPICS: Topic[] = [
  // ---------------------------------------------------------------- everyone
  {
    id: 'start',
    group: 'all',
    icon: Wallet,
    color: '#141B3D',
    title: ['Your wallet', 'محفظتك'],
    to: '/app',
    steps: [
      { icon: Wallet, title: ['Your balance, always on top', 'رصيدك دايمًا قدّامك'], body: ['The home screen shows what you have and what moved this month. Tap any movement to see its details.', 'الصفحة الرئيسية بتعرضلك رصيدك وشو تحرّك هالشهر. اكبس على أي حركة لتشوف تفاصيلها.'], to: '/app/activity' },
      { icon: BadgeCheck, title: ['Your wallet ID', 'رقم محفظتك'], body: ['It works like an account number: share it so people can send you money. Copy it with one tap.', 'هو متل رقم الحساب: شاركه ليقدروا الناس يبعتولك مصاري. انسخه بكبسة.'] },
      { icon: Fingerprint, title: ['Open it with your fingerprint', 'افتحها ببصمتك'], body: ['On the Android app, turn on fingerprint unlock in Settings → Security — no more typing your password.', 'بتطبيق أندرويد، شغّل الفتح بالبصمة من الإعدادات ← الأمان — بلا ما تكتب كلمة السر كل مرة.'], to: '/app/settings' },
      { icon: MapPin, title: ['Tell us your area', 'خبّرنا منطقتك'], body: ['In Settings → Profile pick the town you live in (optional). Then news, offers and cash-agent updates for your area reach you.', 'من الإعدادات ← الملف الشخصي اختار البلد اللي ساكن فيها (اختياري). هيك بتوصلك أخبار وعروض منطقتك وتحديثات الوكلاء القريبين منك.'], to: '/app/settings' },
      { icon: Camera, title: ['Adjust your photo', 'عدّل صورتك'], body: ['“Adjust” under your photo reopens it: turn it, mirror it, straighten it or re-frame it — no need to upload it again.', '«عدّلها» تحت صورتك بتفتحها من جديد: لفّها، اقلبها، عدّل ميلانها أو موضعها — بلا ما ترفعها مرة ثانية.'], to: '/app/settings' },
    ],
  },
  {
    id: 'send',
    group: 'all',
    icon: ArrowLeftRight,
    color: '#5A1424',
    title: ['Send & receive', 'تحويل واستلام'],
    to: '/app/send',
    steps: [
      { icon: Users, title: ['Pick someone', 'اختار الشخص'], body: ['Type a wallet ID or e-mail, or pick from your contacts. We show you the name before anything leaves.', 'اكتب رقم المحفظة أو الإيميل، أو اختار من جهات اتصالك. منعرضلك الاسم قبل ما يطلع أي شيكل.'] },
      { icon: ShieldCheck, title: ['Check and confirm', 'راجع وأكّد'], body: ['Every payment asks you to confirm the exact amount. Wallet-to-wallet transfers are free. With 2-step verification on, you also type your code.', 'كل دفعة بتطلب منك تأكيد المبلغ بالزبط. التحويل بين المحافظ ببلاش. وإذا مفعّل التحقق بخطوتين، بتكتب الكود كمان.'] },
      { icon: QrCode, title: ['Get paid by QR', 'استلم بالـ QR'], body: ['Open Receive, set an amount if you like, and let the other person scan. Done in seconds.', 'افتح «استلام»، حدّد مبلغ إذا بدك، وخلّي الشخص التاني يمسح. خلصت بثواني.'], to: '/app/receive' },
      { icon: ScanLine, title: ['One scanner for everything', 'ماسح واحد لكل إشي'], body: ['Scan reads payment QRs, cash vouchers and agent cash-out codes — it knows which is which.', '«مسح» بيقرأ QR الدفع، وقسائم الكاش، وأكواد السحب عند الوكيل — وبيعرف كل واحد شو هو.'], to: '/app/scan' },
      { icon: Users, title: ['Save your people', 'احفظ ناسك'], body: ['Save anyone to contacts with the name you like, then pay or message them in one tap.', 'احفظ أي حدا بجهات الاتصال بالاسم اللي بتحبه، وادفعله أو راسله بكبسة.'], to: '/app/contacts' },
    ],
  },
  {
    id: 'bank',
    group: 'all',
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
    group: 'all',
    icon: ShoppingBag,
    color: '#1C3B4A',
    title: ['Shopping safely', 'التسوّق بأمان'],
    to: '/app/stores',
    steps: [
      { icon: Store, title: ['Find a store', 'لاقي متجر'], body: ['Browse by category, or pick governorates and towns. Each store shows its owner, branches, map and offers.', 'تصفّح حسب التصنيف، أو اختار محافظات وبلدات. كل متجر بيبين مين صاحبه وفروعه ومكانه على الخريطة وعروضه.'] },
      { icon: ShieldCheck, title: ['Your money waits', 'مصاريك بتستنى'], body: ['When you pay, the money is held by S-Taler — the store only gets it after you receive your order.', 'لما تدفع، المبلغ بيضل محفوظ عند S-Taler — والمتجر ما بقبضه إلا بعد ما يوصلك طلبك.'] },
      { icon: BadgePercent, title: ['Discounts apply by themselves', 'الخصومات بتنحسب لحالها'], body: ['A store’s occasion offer or your loyal-customer discount shows in the cart before you pay. If both apply you get the bigger one — they don’t stack.', 'عرض المناسبة أو خصم الزبون المميز بيبين بالسلة قبل ما تدفع. إذا انطبقوا الثنين بتاخد الأكبر — ما بينجمعوا.'] },
      { icon: Gift, title: ['Gifts in the parcel', 'هدايا مع الطرد'], body: ['When your order earns a store’s gift, you see it in the cart and on the order — and the store is reminded to pack it.', 'لما طلبك يستحق هدية من المتجر، بتشوفها بالسلة وعلى الطلب — والمتجر بيوصله تذكير يحطها.'] },
      { icon: Truck, title: ['Delivery price, before you pay', 'سعر التوصيل قبل ما تدفع'], body: ['Each store sets its delivery: free, one price, or a price for your area. Pick your area in the cart and you see items, delivery and the total with delivery before paying. Delivery is paid with the order and held like the rest until it reaches you.', 'كل متجر بيحدد التوصيل: مجاني، سعر واحد، أو سعر حسب منطقتك. اختار منطقتك بالسلة وبتشوف المنتجات والتوصيل والمجموع مع التوصيل قبل ما تدفع. التوصيل بينحسب مع الطلب وبيضل محفوظ زي الباقي لحد ما يوصلك.'] },
      { icon: BadgeCheck, title: ['Deposit (عربون)', 'العربون'], body: ['Some items ask for a deposit now and the rest on delivery or pickup. You can pay the rest in the app or in cash.', 'بعض المنتجات بتطلب عربون هلّأ والباقي عند التوصيل أو الاستلام. بتقدر تدفع الباقي بالتطبيق أو كاش.'] },
      { icon: MapPin, title: ['Track it on the map', 'تابعه على الخريطة'], body: ['The store updates where your order is. You see every step and the latest location live.', 'المتجر بيحدّث وين صار طلبك. بتشوف كل خطوة وآخر موقع أول بأول.'], to: '/app/orders' },
      { icon: KeyRound, title: ['Your handover code', 'رمز الاستلام'], body: ['Each order has a 6-digit code only you see. Give it to the courier only when the order is in your hands — that’s what pays the store.', 'كل طلب إله رمز من 6 أرقام إنت بس بتشوفه. أعطيه للمندوب لما يكون الطلب بإيدك — هو اللي بيدفع للمتجر.'] },
      { icon: LifeBuoy, title: ['Something wrong?', 'في مشكلة؟'], body: ['Report a problem from the order. The payment freezes until support decides — fairly, for both sides.', 'بلّغ عن مشكلة من الطلب. الدفعة بتتجمّد لحد ما يقرر الدعم — بعدل للطرفين.'] },
      { icon: Tags, title: ['Shop by section', 'تسوّق حسب القسم'], body: ['Stores arrange their products in sections shown as big tiles. Pick one or several, then search, filter and sort inside. “On offer” gathers the discounted items.', 'المتاجر بترتّب منتجاتها بأقسام بتبين كصور كبيرة. اختار قسم أو أكثر، ودوّر وفلتر ورتّب جواتهم. «عروض وخصومات» بيجمع المنتجات اللي عليها خصم.'] },
      { icon: Truck, title: ['Buying for a shop? Wholesale', 'بتشتري لمحلّك؟ جملة'], body: ['If a store sells wholesale, apply from its page. Once approved you see wholesale prices, applied by themselves from the minimum quantity.', 'إذا المتجر بيبيع جملة، قدّم من صفحته. لما يقبلك بتشوف أسعار الجملة، وبتنحسب لحالها من أقل كمية.'] },
      { icon: Star, title: ['Rate a store', 'قيّم المتجر'], body: ['After buying, rate the store at the bottom of its page. You keep one review — writing again edits it. You can hide your name from people and the owner.', 'بعد ما تشتري، قيّم المتجر من آخر صفحته. إلك تقييم واحد — إذا كتبت مرة ثانية بيتعدّل. وبتقدر تخفي اسمك عن الناس وعن صاحب المتجر.'] },
      { icon: Flag, title: ['Report a store or a person', 'بلّغ عن متجر أو شخص'], body: ['“Report” on a store page or a person’s card sends it to the team. Only they know who reported, and you’re told how it was settled.', '«بلّغ» بصفحة المتجر أو كرت الشخص بيوصل للإدارة. هم بس بيعرفوا مين بلّغ، وبيوصلك شو صار.'] },
      { icon: Bell, title: ['Follow or mute a store', 'تابع متجر أو سكّت إشعاراته'], body: ['The bell on a store page turns its news on or off. Settings → Profile → Store notifications lists every store you hear from.', 'الجرس بصفحة المتجر بيشغّل أو بيسكّت أخباره. ومن الإعدادات ← الملف الشخصي ← إشعارات المتاجر بتشوف كل المتاجر اللي بتوصلك منها.'] },
    ],
  },
  {
    id: 'cash',
    group: 'all',
    icon: HandCoins,
    color: '#7A5A10',
    title: ['Cash with an agent', 'الكاش عند وكيل'],
    to: '/app/agents',
    steps: [
      { icon: MapPin, title: ['Find an agent near you', 'لاقي وكيل قريب منك'], body: ['Cash agents shows everyone on a map, nearest first. Use “Near me”, search a place on the map, or filter by town and by service.', '«وكلاء الصرف» بتعرضلك الكل على الخريطة، الأقرب أول. استعمل «قريب مني»، أو دوّر على مكان بالخريطة، أو فلتر حسب البلد ونوع الخدمة.'], to: '/app/agents' },
      { icon: CalendarDays, title: ['Agents in more than one place', 'وكيل بأكثر من مكان'], body: ['Some agents work from two places or on certain days. Each place is a pin on the map, and the one they’re at today is marked “Here today”.', 'في وكلاء إلهم مكانين أو بيكونوا بأيام معيّنة. كل مكان إله دبوس على الخريطة، واللي هو فيه اليوم معلّم «اليوم هون».'] },
      { icon: Camera, title: ['See the place before you go', 'شوف المكان قبل ما تروح'], body: ['Tap an agent to see photos or a short video of the shop and written directions. “Directions” opens the route in Google Maps.', 'اكبس على الوكيل لتشوف صور أو فيديو قصير للمحل ووصف كيف توصل. «الاتجاهات» بتفتحلك الطريق على خرائط جوجل.'] },
      { icon: Ticket, title: ['Cash in: hand cash, scan a voucher', 'إيداع: عطيه كاش وامسح القسيمة'], body: ['Give the agent cash; they show you a voucher QR. Scan it and the amount lands in your wallet. A voucher works once and expires in 10 minutes.', 'بتعطي الوكيل كاش، وهو بيطلعلك QR قسيمة. امسحها والمبلغ بينزل بمحفظتك. القسيمة بتشتغل مرة وحدة وبتنتهي بعد 10 دقايق.'] },
      { icon: ArrowLeftRight, title: ['Cash out: pay their code, take cash', 'سحب: ادفع كوده وخذ الكاش'], body: ['The agent shows a cash-out QR with three digits. Scan it, check the same three digits are on both phones, pay — then take your cash.', 'الوكيل بيطلعلك QR سحب عليه 3 أرقام. امسحه، تأكد إنه نفس الأرقام الثلاثة على الجوالين، ادفع — وخذ الكاش.'] },
      { icon: MapPinned, title: ['They moved? You’ll know', 'نقلوا مكانهم؟ رح تعرف'], body: ['Agents you dealt with can tell you when they move, change hours or close for a while. The latest update also shows on their card.', 'الوكلاء اللي تعاملت معهم بيقدروا يخبروك إذا نقلوا أو تغيّر دوامهم أو سكّروا فترة. وآخر تحديث بيبين كمان على كرتهم بالخريطة.'] },
    ],
  },
  {
    id: 'people',
    group: 'all',
    icon: Users,
    color: '#1F4D3A',
    title: ['Scheduled payments', 'الدفعات المجدولة'],
    to: '/app/people',
    steps: [
      { icon: Users, title: ['Who to pay', 'لمين'], body: ['Pick someone from your contacts, search a name, or type a wallet ID or e-mail. A group (children, family, debts, rent — or staff, suppliers and partners for stores) is optional, just to sort.', 'اختار حدا من جهات اتصالك، أو دوّر بالاسم، أو اكتب رقم محفظته أو إيميله. الفئة (ولادي، أهلي، ديون، إيجار — أو موظفين وموردين وشركاء للمتاجر) اختيارية، بس للترتيب.'], to: '/app/people' },
      { icon: Repeat, title: ['How much, how often, until when', 'كم، كل قديش، ولحد إمتى'], body: ['Once, every week, two weeks, month or any number of days. Forever, until a date, or for a number of payments — handy for paying off a debt in instalments.', 'مرة وحدة، كل أسبوع، أسبوعين، شهر أو أي عدد أيام. للأبد، لتاريخ معيّن، أو عدد دفعات — منيح لتسدّ دين بالتقسيط.'] },
      { icon: BellRing, title: ['Sent by itself, with a reminder', 'بتنبعت لحالها، مع تذكير'], body: ['By default the money goes on time without you. Choose a reminder the same day, a day or two before, or a week before. Or choose “remind only” and pay with one tap.', 'المصاري بتروح بموعدها بلا ما تتدخل. اختار تذكير بنفس اليوم، قبل بيوم أو يومين، أو قبل أسبوع. أو اختار «ذكّرني بس» وادفعها بكبسة.'] },
      { icon: BadgeCheck, title: ['They say yes first', 'بيوافقوا أول'], body: ['Adding someone sends them a request. Nothing is sent to them until they accept; if they decline, the payment stops — and they can stop you asking again.', 'لما تضيف حدا بيوصله طلب. ما بينبعتله إشي لحد ما يوافق؛ وإذا رفض الدفعة بتوقف — وبيقدر يمنعك تطلب مرة ثانية.'] },
      { icon: Gift, title: ['Pause, skip, pay now', 'وقّف، تخطّى، ادفع هلّأ'], body: ['Each payment has buttons to pause and resume, skip just the next one, pay now, edit or delete. Work groups also get bonuses and showing the workplace on profiles if people agree.', 'كل دفعة إلها أزرار توقيف وتشغيل، تخطّي المرة الجاية بس، ادفع هلّأ، تعديل أو حذف. وفئات الشغل كمان إلها مكافآت وإظهار مكان الشغل بملف الناس إذا وافقوا.'] },
    ],
  },
  {
    id: 'privacy',
    group: 'all',
    icon: Ban,
    color: '#7A2E2E',
    title: ['Privacy & blocking', 'الخصوصية والبلوك'],
    to: '/app/settings?tab=privacy',
    steps: [
      { icon: Users, title: ['Who added you', 'مين ضافك'], body: ['Settings → Privacy lists everyone who wants to add you to their people, with what they would send. Accept, decline, leave any time, or stop someone asking again.', 'من الإعدادات ← الخصوصية بتشوف كل حدا بدّه يضيفك لناسه، ومع شو رح يبعتلك. وافق، ارفض، اطلع وقت ما بدك، أو امنعه يطلب مرة ثانية.'], to: '/app/settings?tab=privacy' },
      { icon: Ban, title: ['Block someone', 'بلّك حدا'], body: ['From a person’s card, your contacts or Settings → Privacy. A block stops money, messages, contacts and groups between you both ways, and hides you from their search. They aren’t told.', 'من كرت الشخص، أو جهات الاتصال، أو الإعدادات ← الخصوصية. البلوك بيوقف المصاري والرسائل وجهات الاتصال والفئات بينكم بالاتجاهين، وبيخفيك من بحثه. وما بيوصله إشعار.'] },
      { icon: ShieldCheck, title: ['Your blocked list', 'قائمة المحظورين'], body: ['Unblock anyone from the same list. A block put by the S-Taler team can only be lifted by the team.', 'بتشيل البلوك عن أي حدا من نفس القائمة. البلوك اللي حطّته الإدارة بس الإدارة بتشيله.'] },
    ],
  },
  {
    id: 'digital',
    group: 'all',
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
    id: 'chat',
    group: 'all',
    icon: MessageCircle,
    color: '#0F5F5C',
    title: ['Messages & notifications', 'الرسائل والإشعارات'],
    to: '/app/messages',
    steps: [
      { icon: MessageCircle, title: ['Chat securely', 'دردش بأمان'], body: ['Messages are encrypted. React with an emoji, reply, edit within 15 minutes, or delete.', 'الرسائل مشفّرة. تفاعل بإيموجي، رد، عدّل خلال 15 دقيقة، أو احذف.'] },
      { icon: BellRing, title: ['The bell', 'الجرس'], body: ['Payments, orders, store news, agent updates and announcements arrive here. Tap one to jump to what it’s about.', 'الدفعات والطلبات وأخبار المتاجر وتحديثات الوكلاء والتعميمات بتوصل هون. اكبس على أي واحد لتروح لموضوعه.'] },
      { icon: BellRing, title: ['Pop-ups and sound', 'إشعارات منبثقة وصوت'], body: ['Off until you turn them on, per device: Settings → “Notifications on this device”. Pop-ups reach you right away — in another tab, on the laptop, in the phone’s browser or the app — and inside the app they slide in at the top. Add a short chime if you like, and “Try it” to see. Signing out stops them on that device.', 'مطفية لحد ما تشغّلها، لكل جهاز لحاله: الإعدادات ← «الإشعارات على هالجهاز». المنبثقة بتوصلك فورًا — بتاب ثانية، عاللابتوب، بمتصفح الجوال أو بالتطبيق — وجوا التطبيق بتنزل من فوق. وبتقدر تضيف نغمة قصيرة، واكبس «جرّب» لتشوف. ولما تطلع من حسابك بتوقف على هالجهاز.'], to: '/app/settings' },
      { icon: AtSign, title: ['Names you can tap', 'أسماء بتنكبس'], body: ['A store, agent or person mentioned in a notification is a link: a store opens its page, an agent opens on the map, a person opens their card (message, pay or save).', 'المتجر أو الوكيل أو الشخص المذكور بالإشعار بيكون رابط: المتجر بيفتح صفحته، الوكيل بيفتح على الخريطة، والشخص بيفتح كرته (راسله، حوّله، أو احفظه).'] },
      { icon: LifeBuoy, title: ['Support, the right team', 'الدعم، للفريق المختص'], body: ['From Messages → New chat, choose what you need help with. It reaches the team for it, and whoever takes it stays with you until it’s solved.', 'من الرسائل ← محادثة جديدة، اختار بشو بدك مساعدة. بيوصل للفريق المختص، واللي بيستلمه بيضل معك لحد ما تنحل.'] },
      { icon: PhoneCall, title: ['A call with support', 'مكالمة مع الدعم'], body: ['In Messages, “Call support”: describe the problem. If the team accepts, pick a time within their hours. They call you then — voice, with camera or screen sharing if you like — or show you a “Call” button. Sorted already? Cancel it.', 'بالرسائل، «مكالمة مع الدعم»: اكتب المشكلة. إذا قبل الفريق، اختار وقت ضمن ساعاتهم. بيتصلوا فيك فيه — صوت، ومع كاميرا أو مشاركة شاشة إذا بدك — أو بيظهرلك زر «اتصل». انحلّت؟ الغِها.'], to: '/app/messages?calls=1' },
      { icon: Star, title: ['Rate the help', 'قيّم المساعدة'], body: ['When a support chat closes you can rate it with stars and a word — or choose not to. Only the management sees it.', 'لما تنسكّر محادثة الدعم بتقدر تقيّمها بنجوم وكلمة — أو تختار ما تقيّم. الإدارة بس بتشوفها.'] },
    ],
  },
  {
    id: 'safety',
    group: 'all',
    icon: LockKeyhole,
    color: '#3B2F5E',
    title: ['Account & safety', 'الحساب والأمان'],
    to: '/app/settings',
    steps: [
      { icon: KeyRound, title: ['2-step verification', 'التحقق بخطوتين'], body: ['Turn it on in Settings → Security: sign-in and money leaving your wallet then also need a code from your authenticator app. Keep the recovery codes somewhere safe.', 'شغّله من الإعدادات ← الأمان: الدخول وطلوع المصاري من محفظتك بيصيروا بدهم كود من تطبيق المصادقة. احفظ أكواد الاسترجاع بمكان آمن.'] },
      { icon: MonitorSmartphone, title: ['Your devices', 'أجهزتك'], body: ['See every device signed in to your account, with its approximate place on a map, and sign any of them out instantly.', 'شوف كل جهاز داخل على حسابك، ومكانه التقريبي على الخريطة، وطلّع أي واحد منهم فورًا.'] },
      { icon: LockKeyhole, title: ['Idle sign-out', 'الخروج التلقائي'], body: ['On the web, being away for 30 minutes signs you out — and admins everywhere. In the phone app you stay signed in as long as possible and the lock screen protects you.', 'على الموقع، إذا غبت 30 دقيقة بتطلع لحالك — والإدارة بكل مكان. بتطبيق الجوال بتضل داخل أطول مدة ممكنة وقفل التطبيق بيحميك.'] },
      { icon: ShieldCheck, title: ['Changing e-mail or password', 'تغيير الإيميل أو كلمة السر'], body: ['Both need a code sent to your e-mail — a new e-mail needs codes from the old and the new address.', 'الثنين بدهم كود بيوصل على إيميلك — والإيميل الجديد بدّه كود من القديم والجديد.'] },
    ],
  },

  // -------------------------------------------------------------- merchants
  {
    id: 'm-stores',
    group: 'merchant',
    icon: Store,
    color: '#7A2E8C',
    title: ['Your stores', 'متاجرك'],
    to: '/app/merchant/stores',
    steps: [
      { icon: GitBranch, title: ['Stores and branches', 'متاجر وفروع'], body: ['Open several stores, add branches by city, pick a colour, logo, cover and a pin on the map.', 'افتح أكثر من متجر، أضف فروع حسب المدينة، واختار لون وشعار وغلاف ومكان على الخريطة.'], to: '/app/merchant/stores' },
      { icon: Tags, title: ['Your category isn’t listed?', 'تصنيفك مش موجود؟'], body: ['Type the category you want; the admins review it and, once approved, it joins the category bar for everyone.', 'اكتب التصنيف اللي بدك اياه؛ الإدارة بتراجعه، وأول ما توافق بيصير خيار جديد بشريط التصنيفات للكل.'] },
      { icon: Truck, title: ['Delivery prices', 'أسعار التوصيل'], body: ['In each store or branch, turn on “We deliver” and pick: free, one price, or by area (Nablus 10, Ramallah 20…; quick-add governorates). Change them any time. The customer sees the price, picks the area and pays the total with delivery; the order shows the area and what was charged.', 'بكل متجر أو فرع شغّل «منوصّل» واختار: مجاني، سعر واحد، أو حسب المنطقة (نابلس 10، رام الله 20…، وفي إضافة سريعة للمحافظات). بتغيّرهم وقت ما بدك. الزبون بيشوف السعر وبيختار منطقته وبيدفع المجموع مع التوصيل، والطلب بيبين المنطقة وقديش انحسب توصيل.'], to: '/app/merchant/stores' },
      { icon: MapPin, title: ['Pickup points', 'نقاط الاستلام'], body: ['Add places where buyers can collect orders; with pickup points the buyer chooses one at checkout.', 'أضف أماكن بيقدر الزبون يستلم منها؛ وإذا عندك نقاط استلام الزبون بيختار وحدة وقت الدفع.'], to: '/app/merchant/pickup' },
      { icon: Share2, title: ['Share your link', 'شارك رابطك'], body: ['Send your store link on WhatsApp, Facebook, Telegram or to people on S-Taler. It opens straight on your store.', 'ابعت رابط متجرك على واتساب وفيسبوك وتيليجرام أو لناس على S-Taler. بيفتح مباشرة على متجرك.'] },
    ],
  },
  {
    id: 'm-orders',
    group: 'merchant',
    icon: Package,
    color: '#1F4D3A',
    title: ['Products & orders', 'المنتجات والطلبات'],
    to: '/app/merchant/orders',
    steps: [
      { icon: Package, title: ['Products', 'المنتجات'], body: ['Add photos, price, stock, an optional deposit, or a digital file that each buyer gets as a personal copy.', 'أضف صور وسعر وكمية، وعربون إذا بدك، أو ملف رقمي كل مشتري بياخد نسخة شخصية منه.'], to: '/app/merchant/products' },
      { icon: ClipboardList, title: ['Accept and ship', 'اقبل واشحن'], body: ['New orders ring the bell. Accept, ship and share your location so the buyer follows the order on the map.', 'الطلبات الجديدة بتوصل على الجرس. اقبل، اشحن وشارك موقعك ليتابع الزبون الطلب على الخريطة.'] },
      { icon: Truck, title: ['Hand over and get paid', 'سلّم واقبض'], body: ['Enter the buyer’s 6-digit handover code (or scan it) when the order is in their hands. The money arrives instantly.', 'اكتب رمز الاستلام تبع الزبون (أو امسحه) لما يكون الطلب بإيده. المصاري بتوصلك فورًا.'] },
      { icon: Gift, title: ['“Put a gift in”', '«حط معه هدية»'], body: ['If an order earned one of your gift rules, the new-order notification and the order card tell you which gift to pack.', 'إذا الطلب استحق هدية من هداياك، إشعار الطلب الجديد وكرت الطلب بيقولولك شو تحط معه.'] },
    ],
  },
  {
    id: 'm-crm',
    group: 'merchant',
    icon: HeartHandshake,
    color: '#8A1C3A',
    title: ['Customers & offers', 'الزباين والعروض'],
    to: '/app/merchant/customers',
    steps: [
      { icon: Users, title: ['Know your customers', 'اعرف زباينك'], body: ['See top spenders and most frequent buyers, search any customer and see how many times they ordered and when last.', 'شوف الأكثر صرفًا والأكثر طلبات، دوّر على أي زبون وشوف كم مرة طلب وإمتى آخر مرة.'] },
      { icon: Crown, title: ['Loyal customers', 'الزبون المميز'], body: ['Choose after how many orders a customer becomes loyal, and an automatic discount for them (or just the title).', 'حدّد بعد كم طلب الزبون بيصير مميز، وخصم تلقائي إله (أو اللقب بس).'] },
      { icon: BadgePercent, title: ['Occasion offers', 'عروض المناسبات'], body: ['A discount on the whole store for a set time — Eid, Ramadan, an opening — for everyone or loyal customers only, with an optional minimum order. Up to 10 running.', 'خصم على كل المتجر لفترة — عيد، رمضان، افتتاح — للكل أو للمميزين بس، ومع حد أدنى للطلب إذا بدك. لحد 10 عروض شغّالة.'] },
      { icon: Gift, title: ['Gifts by rule', 'هدايا بشروط'], body: ['A gift with every order, the first order, loyal customers, or orders over an amount. Up to 10 rules.', 'هدية مع كل طلب، أو أول طلب، أو للمميزين، أو للطلبات فوق مبلغ. لحد 10 هدايا.'] },
      { icon: BarChart3, title: ['Analytics', 'التحليلات'], body: ['Where your customers come from (most to fewest or the reverse), which branch sells most and to whom, and your best-selling products by units, sales or buyers — for one branch, the whole store, or all your stores together.', 'زباينك من وين (من الأكثر للأقل أو بالعكس)، أي فرع بيبيع أكثر ولمين، ومنتجاتك الأكثر مبيعًا بالقطع أو المبيعات أو عدد المشترين — لفرع واحد، أو المتجر كله، أو كل متاجرك مع بعض.'] },
      { icon: Tags, title: ['Sections', 'الأقسام'], body: ['Make your own sections (with ideas for your kind of store), give them a picture and icon, and choose their products. They show as tiles on your page.', 'اعمل أقسامك (مع اقتراحات حسب نوع متجرك)، حطلها صورة وأيقونة، واختار منتجاتها. بتبين كصور كبيرة بصفحتك.'] },
      { icon: Truck, title: ['Wholesale', 'الجملة'], body: ['Turn on wholesale, write your terms, set a wholesale price and minimum on products, and approve the traders who apply. You can notify wholesale buyers only.', 'فعّل الجملة، اكتب شروطك، حطّ سعر جملة وأقل كمية على المنتجات، ووافق على التجار اللي بيقدّموا. وبتقدر تبعت إشعارات لتجار الجملة بس.'] },
      { icon: Star, title: ['Reviews and reports', 'التقييمات والبلاغات'], body: ['Customers rate your store after buying. When the team opens it for you, you see the reviews and may show them on your page. You can also report a customer from your customer list.', 'الزباين بيقيّموا متجرك بعد ما يشتروا. لما تفتحها الإدارة إلك، بتشوف التقييمات وبتقدر تعرضها بصفحتك. وبتقدر تبلّغ عن زبون من قائمة زباينك.'] },
      { icon: Megaphone, title: ['Notify your customers', 'إشعارات لزباينك'], body: ['Send news, an offer or a gift notice to all your customers, loyal ones, or people you pick — with a live count and preview. Up to 5 a day; people who muted you don’t get it.', 'ابعت خبر أو عرض أو هدية لكل زباينك، أو للمميزين، أو لناس بتختارهم — مع عدد مباشر ومعاينة. لحد 5 باليوم؛ واللي سكّت إشعاراتك ما بيوصله.'] },
    ],
  },
  {
    id: 'm-ads',
    group: 'merchant',
    icon: Megaphone,
    color: '#B34A1E',
    title: ['Ads', 'الإعلانات'],
    to: '/app/merchant/ads',
    steps: [{ icon: Megaphone, title: ['Ads that move', 'إعلانات بتتحرك'], body: ['Upload images or short videos as offers on top of your store page, link them to a product, and set when they end.', 'ارفع صور أو فيديوهات قصيرة كعروض فوق صفحة متجرك، اربطها بمنتج، وحدّد إمتى بتخلص.'] }],
  },

  // ------------------------------------------------------------------ agents
  {
    id: 'a-desk',
    group: 'exchange',
    icon: HandCoins,
    color: '#6B4E0E',
    title: ['Your agent desk', 'مكتب الوكيل'],
    to: '/app/agent',
    steps: [
      { icon: Ticket, title: ['Cash in with vouchers', 'الإيداع بالقسائم'], body: ['Take the cash, create a voucher for the amount and let the customer scan it. The amount leaves your wallet into theirs. You can lock a voucher to one wallet so a leaked QR is useless.', 'استلم الكاش، اعمل قسيمة بالمبلغ وخلّي الزبون يمسحها. المبلغ بيطلع من محفظتك لمحفظته. وبتقدر تقفل القسيمة على محفظة وحدة حتى لو تسرّب الـ QR ما بنفع.'], to: '/app/vouchers' },
      { icon: ArrowLeftRight, title: ['Cash out with a request', 'السحب بطلب'], body: ['Create a cash-out request; the customer scans and pays it, the three digits match on both phones, and you hand over the cash once it says paid.', 'اعمل طلب سحب؛ الزبون بيمسحه وبيدفعه، الأرقام الثلاثة بتطابق على الجوالين، وبتسلّمه الكاش لما يبين «انْدفع».'] },
      { icon: Wallet, title: ['Your day at a glance', 'يومك بنظرة'], body: ['The desk shows your balance, today’s cash in and out and what is held in open vouchers.', 'المكتب بيعرضلك رصيدك، وإيداع وسحب اليوم، والمحجوز بقسائم مفتوحة.'] },
      { icon: BarChart3, title: ['Your work in numbers', 'شغلك بالأرقام'], body: ['Cash in and out over a week, a month or more; your busiest days and hours; how many came back; where your customers are from; and your regulars.', 'الإيداع والسحب بأسبوع أو شهر أو أكثر؛ أكثر أيامك وساعاتك ضغط؛ كم واحد رجعلك؛ زباينك من وين؛ وزباينك الدايمين.'] },
    ],
  },
  {
    id: 'a-profile',
    group: 'exchange',
    icon: MapPinned,
    color: '#5A3A12',
    title: ['Your place on the map', 'مكانك على الخريطة'],
    to: '/app/settings?tab=agent',
    steps: [
      { icon: MapPin, title: ['Your agent profile', 'ملف الوكيل'], body: ['In Settings → Agent profile set your name, town, address, hours, phone and services, and place your pin. You appear on the map once the admins approve.', 'من الإعدادات ← ملف الوكيل حط اسمك وبلدك وعنوانك ودوامك وجوالك وخدماتك، وحط مكانك على الخريطة. بتبين على الخريطة أول ما توافق الإدارة.'], to: '/app/settings?tab=agent' },
      { icon: Camera, title: ['Photos and a short video', 'صور وفيديو قصير'], body: ['Add up to 8 photos or videos of the shop front, the entrance and a landmark, each with a caption. People see them when they open your card.', 'أضف لحد 8 صور أو فيديوهات لواجهة المحل والمدخل وأقرب معلم، مع وصف لكل وحدة. الناس بتشوفها لما تفتح كرتك.'] },
      { icon: Signpost, title: ['How to find you', 'كيف يوصلولك'], body: ['Write directions in your own words — “next to the mosque, ground floor, blue door”.', 'اكتب وصف الطريق بكلامك — «بجانب المسجد، الطابق الأرضي، باب أزرق».'] },
      { icon: CalendarDays, title: ['Several places, by day', 'أكثر من مكان، حسب الأيام'], body: ['Add up to 6 other places with the days and hours you’re there. Each appears on the map; the one for today is marked.', 'أضف لحد 6 أماكن ثانية مع أيامك وساعاتك فيها. كل واحد بيبين على الخريطة، واللي إله اليوم بيتعلّم.'] },
    ],
  },
  {
    id: 'a-updates',
    group: 'exchange',
    icon: BellRing,
    color: '#7A2E2E',
    title: ['Updates for your people', 'تحديثات لناسك'],
    to: '/app/agent/updates',
    steps: [
      { icon: Users, title: ['To people you served', 'للي تعاملوا معك'], body: ['Moved, new hours, closed for a while, or an offer: it reaches everyone who claimed your vouchers or paid your cash-outs, right away.', 'نقلت، تغيّر دوامك، مسكّر فترة، أو عندك عرض: بيوصل فورًا لكل اللي صرفوا قسائمك أو دفعوا طلبات سحبك.'] },
      { icon: ShieldCheck, title: ['To your whole area', 'لكل منطقتك'], body: ['Ask the admins to announce it to everyone in your governorate. You get a notification when they approve or decline.', 'اطلب من الإدارة تعمّمه على كل محافظتك. بيوصلك إشعار لما يوافقوا أو يرفضوا.'] },
      { icon: MapPinned, title: ['On your card for two weeks', 'على كرتك أسبوعين'], body: ['The latest update also shows on your card on the agents map for 14 days. Up to 3 updates a day.', 'آخر تحديث بيبين كمان على كرتك بخريطة الوكلاء لمدة 14 يوم. لحد 3 تحديثات باليوم.'] },
    ],
  },

  // ------------------------------------------------------------------ admins
  {
    id: 'ad-people',
    group: 'admin',
    icon: UserCog,
    color: '#1E2A55',
    title: ['People & accounts', 'الناس والحسابات'],
    to: '/app/admin/users',
    steps: [
      { icon: Users, title: ['Find anyone', 'لاقي أي حدا'], body: ['Search by name or e-mail, open a person to see their wallet, movements, devices and places, change their kind of account, freeze or sign them out.', 'دوّر بالاسم أو الإيميل، افتح الشخص لتشوف محفظته وحركاته وأجهزته وأماكنه، غيّر نوع حسابه، جمّده أو طلّعه.'], to: '/app/admin/users' },
      { icon: ClipboardList, title: ['Waiting sign-ups', 'التسجيلات المعلّقة'], body: ['Sign-ups that haven’t confirmed their e-mail wait here; approve them or clear the list.', 'التسجيلات اللي لسا ما أكّدت إيميلها بتستنى هون؛ وافق عليها أو امسح القائمة.'], to: '/app/admin/pending' },
      { icon: Trophy, title: ['Team performance (super admin)', 'أداء الفريق (للسوبر أدمن)'], body: ['Who took support requests, how fast they first answered, their customer ratings and comments, and the disputes and reports they settled. Under “All support chats” filter by admin and open any chat — waiting, active or closed — and watch it live as both sides write. Carry on the reply yourself, or hand it to another admin with a reason (a closed chat opens again); they take it or ask to move it, saying why. Admins on leave show it under their name.', 'مين استلم طلبات دعم، أديش بسرعة رد أول مرة، تقييمات الناس وتعليقاتهم، والنزاعات والبلاغات اللي حلّها. ومن «كل محادثات الدعم» فلتر حسب الأدمن وافتح أي محادثة — بتستنى، شغّالة أو مسكّرة — وشوف شو بينكتب أول بأول من الطرفين. كمّل الرد إنت، أو حوّلها لأدمن ثاني مع السبب (المسكّرة بترجع تنفتح)؛ وهو بيستلمها أو بيطلب تحويلها مع تفسير. واللي بإجازة بيبين تحت اسمه.'], to: '/app/admin/team?tab=chats' },
      { icon: Plane, title: ['Leave', 'الإجازات'], body: ['Any admin asks for leave with dates and a reason; the super admin approves or declines. The super admin can also put an admin on leave or off support for a while — they are told. While away, an admin gets no new support requests; chats can still be handed to them for when they are back.', 'أي أدمن بيطلب إجازة بتاريخ وسبب، والسوبر أدمن بيوافق أو بيرفض. والسوبر أدمن كمان بيقدر يحط أدمن بإجازة أو يوقفه عن الدعم لفترة — وبيوصله إشعار. وقت الإجازة ما بتوصله طلبات دعم جديدة، وبتقدر تحوّله محادثات ليشتغلها بعد ما يرجع.'], to: '/app/admin/leaves' },
      { icon: Hand, title: ['Chats handed to you', 'محادثات انحوّلتلك'], body: ['In Messages, “Handed to you” lists chats the super admin gave you, with the reason. Take it, or ask to move it and say why.', 'بالرسائل، «انحوّلتلك» بتبين المحادثات اللي حوّلها إلك السوبر أدمن مع السبب. استلمها، أو اطلب تحويلها واحكي ليش.'], to: '/app/messages?queue=1' },
      { icon: Crown, title: ['Admins and permissions', 'المشرفين والصلاحيات'], body: ['Only the super admin adds admins and chooses exactly what each one can open; every admin sees only their sections.', 'بس السوبر أدمن بيضيف مشرفين وبيحدد بالزبط شو كل واحد بيقدر يفتح؛ وكل مشرف بيشوف أقسامه بس.'], to: '/app/admin/admins' },
    ],
  },
  {
    id: 'ad-market',
    group: 'admin',
    icon: Store,
    color: '#2F3F18',
    title: ['Stores, agents & disputes', 'المتاجر والوكلاء والنزاعات'],
    to: '/app/admin/stores',
    steps: [
      { icon: Store, title: ['Stores', 'المتاجر'], body: ['See every store, open one to edit it, change its status or remove it, and approve the categories merchants suggest.', 'شوف كل المتاجر، افتح أي متجر لتعدّله أو تغيّر حالته أو تشيله، ووافق على التصنيفات اللي بيقترحها التجار.'], to: '/app/admin/stores' },
      { icon: HandCoins, title: ['Cash agents', 'وكلاء الصرف'], body: ['Approve new agents for the map, edit their listing or take them off it.', 'وافق على الوكلاء الجدد ليبينوا على الخريطة، عدّل ملفهم أو شيلهم عنها.'], to: '/app/admin/agents' },
      { icon: Flag, title: ['Reports & store reviews', 'البلاغات وتقييمات المتاجر'], body: ['Take a report, settle or dismiss it with a note the reporter sees. See stores ranked by real buyers’ reviews (with names and earlier versions), and decide what the public and each owner may see.', 'استلم البلاغ، وحلّه أو ارفضه مع ملاحظة بتوصل للي بلّغ. شوف المتاجر مرتبة حسب تقييمات اللي اشتروا فعلًا (بالأسماء والنسخ القديمة)، وقرّر شو بيشوف الناس وشو بيشوف كل صاحب متجر.'], to: '/app/admin/reports' },
      { icon: Scale, title: ['Disputes', 'النزاعات'], body: ['When a buyer reports a problem the payment freezes; read both sides and release it to the store or refund the buyer.', 'لما الزبون يبلّغ عن مشكلة الدفعة بتتجمّد؛ اقرأ الطرفين وحرّرها للمتجر أو رجّعها للزبون.'], to: '/app/admin/disputes' },
      { icon: Landmark, title: ['Bank operations', 'عمليات البنك'], body: ['Follow every transfer between S-Taler and TalerBank and its status.', 'تابع كل تحويل بين S-Taler و TalerBank وشو صار فيه.'], to: '/app/admin/bank' },
    ],
  },
  {
    id: 'ad-notify',
    group: 'admin',
    icon: Megaphone,
    color: '#5A1424',
    title: ['Notifications & announcements', 'الإشعارات والتعميمات'],
    to: '/app/admin/notify',
    steps: [
      { icon: Users, title: ['Choose who', 'اختار لمين'], body: ['Everyone, kinds of account, chosen people, or by area — governorates and towns, optionally only merchants or agents there. The count updates as you choose.', 'للكل، أو حسب نوع الحساب، أو أشخاص بعينهم، أو حسب المنطقة — محافظات وبلدات، ومع إمكانية التجار أو الوكلاء فيها بس. العدد بيتحدّث وانت بتختار.'] },
      { icon: AtSign, title: ['Mention someone', 'منشن حدا'], body: ['Type @ in the message to mention a store, a cash agent or a person; readers tap the name to open their page.', 'اكتب @ بالرسالة لتمنشن متجر أو وكيل صرف أو شخص؛ واللي بيقرأ بيكبس على الاسم ليفتح صفحته.'] },
      { icon: MessageCircle, title: ['The support desk', 'مكتب الدعم'], body: ['In Messages, “Waiting support requests” lists the requests for your team (by your permissions). Take one and it’s yours alone; give it back to the queue if another team should handle it.', 'بالرسائل، «طلبات دعم بتستنى» فيها طلبات فريقك (حسب صلاحياتك). استلم طلب وبيصير إلك لحالك؛ ورجّعه للطابور إذا لازم فريق ثاني.'], to: '/app/messages' },
      { icon: PhoneCall, title: ['Support calls', 'مكالمات الدعم'], body: ['Accept or decline call requests, set the team’s hours, call at the booked time or let the customer call, and ask anyone for a call when something’s wrong.', 'اقبل أو ارفض طلبات المكالمات، حدّد ساعات الفريق، اتصل بالموعد أو خلّي الزبون يتصل، واطلب مكالمة من أي حدا إذا صار خلل.'], to: '/app/admin/calls' },
      { icon: Users, title: ['Groups & scheduled payments', 'الفئات والدفعات المجدولة'], body: ['See who pays whom on a schedule, who hasn’t accepted yet, every movement and failure. Pause any payment with a reason the owner sees, remove someone from a person’s people, or add them directly.', 'شوف مين بيدفع لمين بشكل مجدول، مين لسا ما وافق، وكل الحركات والفشل. أوقف أي دفعة مع سبب بيوصل لصاحبها، شيل حدا من ناس شخص، أو ضيفه مباشرة.'], to: '/app/admin/groups' },
      { icon: Ban, title: ['Blocks', 'البلوكات'], body: ['Every block between people, merchants and cash agents: who blocked whom and when. Lift any block, or keep two accounts apart yourself — the protected person can’t lift a team block.', 'كل البلوكات بين الناس والتجار والصرّافين: مين بلّك مين وإمتى. شيل أي بلوك، أو افصل بين حسابين بنفسك — والشخص ما بيقدر يشيل بلوك الإدارة.'], to: '/app/admin/blocks' },
      { icon: HandCoins, title: ['Agent requests', 'طلبات الوكلاء'], body: ['Agents asking to announce to their area appear at the top: approve to send it, or reject with a reason they’ll see.', 'الوكلاء اللي بدهم يعمّموا على منطقتهم بيبينوا فوق: وافق ليوصل، أو ارفض مع سبب بيوصلهم.'] },
      { icon: ShieldCheck, title: ['Preview and history', 'معاينة وسجل'], body: ['See exactly how it will look, send an e-mail copy if needed (up to 300), and look back at everything sent and by whom.', 'شوف بالزبط كيف رح تبين، ابعت نسخة بالإيميل إذا لازم (لحد 300)، وارجع لكل اللي انبعت ومين بعته.'] },
    ],
  },
  {
    id: 'ad-audit',
    group: 'admin',
    icon: FileClock,
    color: '#333A4D',
    title: ['Audit & system', 'التدقيق والنظام'],
    to: '/app/admin/audit',
    steps: [
      { icon: Search, title: ['Audit log', 'سجل التدقيق'], body: ['Every sensitive action is recorded. Search as you type by person, action or detail.', 'كل عملية حساسة بتنسجل. دوّر وانت بتكتب بالشخص أو العملية أو التفاصيل.'], to: '/app/admin/audit' },
      { icon: ShieldCheck, title: ['System settings', 'إعدادات النظام'], body: ['Open or close new sign-ups, switch maintenance mode, and set the banner everyone sees.', 'افتح أو سكّر التسجيل، شغّل وضع الصيانة، وحط الإعلان اللي بيشوفه الكل.'], to: '/app/admin/settings' },
    ],
  },
];

const GROUPS: { k: Group; icon: typeof Wallet; t: [string, string]; d: [string, string] }[] = [
  { k: 'all', icon: Users, t: ['For everyone', 'للكل'], d: ['Wallet, payments, shopping, cash and safety', 'المحفظة والدفع والتسوّق والكاش والأمان'] },
  { k: 'merchant', icon: Store, t: ['For stores', 'لأصحاب المتاجر'], d: ['Stores, orders, customers and offers', 'المتاجر والطلبات والزباين والعروض'] },
  { k: 'exchange', icon: HandCoins, t: ['For cash agents', 'لوكلاء الصرف'], d: ['Desk, your place on the map, updates', 'المكتب ومكانك على الخريطة والتحديثات'] },
  { k: 'admin', icon: Crown, t: ['For admins', 'للإدارة'], d: ['People, stores, notifications, audit', 'الناس والمتاجر والإشعارات والتدقيق'] },
];
const ROLE_GROUP: Record<Role, Group> = { user: 'all', merchant: 'merchant', exchange: 'exchange', admin: 'admin' };

export default function Help() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const L = lang === 'ar' ? 1 : 0;
  const role = (user?.role ?? 'user') as Role;
  // Each account sees what concerns it: everyone's guide plus its own (admins see them all).
  const groups = GROUPS.filter((g) => g.k === 'all' || role === 'admin' || ROLE_GROUP[role] === g.k);
  const [group, setGroup] = useState<Group>(ROLE_GROUP[role]);
  const inGroup = TOPICS.filter((x) => x.group === group);
  const [topic, setTopic] = useState(inGroup[0]!.id);
  const [q, setQ] = useState('');
  const cur = TOPICS.find((x) => x.id === topic && x.group === group) ?? inGroup[0]!;

  // Search across every guide the person can see.
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return null;
    const seen = new Set(groups.map((g) => g.k));
    return TOPICS.filter((x) => seen.has(x.group)).flatMap((x) =>
      x.steps.filter((s) => `${s.title[L]} ${s.body[L]} ${x.title[L]}`.toLowerCase().includes(needle)).map((s) => ({ topic: x, step: s })),
    );
  }, [q, L, groups]);

  const pickGroup = (g: Group) => {
    setGroup(g);
    setTopic(TOPICS.find((x) => x.group === g)!.id);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <section className="relative mb-5 overflow-hidden rounded-[2rem] p-6 text-white sm:p-10" style={{ background: cur.color, transition: 'background .5s' }}>
        <motion.div className="pointer-events-none absolute -end-10 -top-10 h-64 w-64 opacity-60" animate={{ rotate: 360 }} transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}>
          <StarMotif size={19} cell={14} className="h-full w-full" colors={['#E2506A', '#E9C060']} animate={false} />
        </motion.div>
        <p className="relative text-sm text-white/70">{L ? 'دليل S-Taler' : 'S-Taler guide'} · {GROUPS.find((g) => g.k === group)!.t[L]}</p>
        <AnimatePresence mode="popLayout">
          <motion.h1 key={cur.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="relative mt-1 font-display text-4xl sm:text-5xl">
            {cur.title[L]}
          </motion.h1>
        </AnimatePresence>
        <label className="relative mt-5 block max-w-md">
          <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/60" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            placeholder={L ? 'دوّر بالدليل… (مثلًا: عربون، بصمة، قسيمة)' : 'Search the guide… (e.g. deposit, fingerprint, voucher)'}
            className="h-12 w-full rounded-2xl border-0 bg-white/15 pe-10 ps-12 text-white outline-none ring-1 ring-white/25 backdrop-blur placeholder:text-white/55 focus:bg-white/20 focus:ring-2 focus:ring-white/50"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="absolute end-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-white/70 hover:bg-white/15" aria-label="✕">
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </label>
        {!hits && cur.to && (
          <Link to={cur.to} className="relative mt-4 inline-block">
            <Button variant="secondary">{L ? 'جرّبها هلّأ' : 'Try it now'}</Button>
          </Link>
        )}
      </section>

      {hits ? (
        <section>
          <p className="mb-3 text-sm text-muted">{hits.length ? (L ? `${hits.length} نتيجة` : `${hits.length} results`) : L ? 'ما لقينا إشي بهالكلمة — جرّب كلمة ثانية.' : 'Nothing matches — try another word.'}</p>
          <ul className="space-y-3">
            {hits.map(({ topic: x, step: s }) => (
              <li key={x.id + s.title[0]}>
                <button
                  type="button"
                  onClick={() => {
                    setQ('');
                    setGroup(x.group);
                    setTopic(x.id);
                  }}
                  className="card flex w-full gap-4 p-4 text-start transition hover:-translate-y-0.5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: x.color }}>
                    <s.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs text-muted">{x.title[L]}</span>
                    <span className="block font-semibold">{s.title[L]}</span>
                    <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{s.body[L]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          {/* Who the guide is for */}
          {groups.length > 1 && (
          <div className={cx('mb-4 grid gap-2', groups.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2')} role="tablist">
            {groups.map((g) => {
              const on = g.k === group;
              const mine = ROLE_GROUP[role] === g.k;
              return (
                <button
                  key={g.k}
                  role="tab"
                  aria-selected={on}
                  onClick={() => pickGroup(g.k)}
                  className={cx('relative rounded-2xl border p-3 text-start transition', on ? 'border-transparent text-white shadow-lift' : 'border-line bg-surface hover:border-ink/25')}
                >
                  {on && <motion.span layoutId="help-group" className="absolute inset-0 rounded-2xl bg-night dark:bg-white/15" transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }} />}
                  <span className="relative flex items-center gap-2 text-sm font-semibold">
                    <g.icon className="h-4 w-4" /> {g.t[L]}
                    {mine && <span className={cx('rounded-full px-1.5 py-px text-[10px] font-semibold', on ? 'bg-white/20' : 'bg-stitch/10 text-stitch')}>{L ? 'إنت' : 'you'}</span>}
                  </span>
                  <span className={cx('relative mt-0.5 hidden text-xs sm:block', on ? 'text-white/70' : 'text-muted')}>{g.d[L]}</span>
                </button>
              );
            })}
          </div>
          )}

          <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist">
            {inGroup.map((x) => {
              const on = x.id === cur.id;
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
            <motion.ol key={cur.id} className="relative space-y-4 ps-8" initial="hidden" animate="show" exit="hidden" variants={{ show: { transition: { staggerChildren: 0.07 } } }}>
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
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold">{s.title[L]}</h2>
                      <p className="mt-1 text-muted">{s.body[L]}</p>
                      {s.to && (
                        <Link to={s.to} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: cur.color }}>
                          {L ? 'افتحها' : 'Open it'} <ArrowUpRight className="h-4 w-4 flip-rtl" />
                        </Link>
                      )}
                    </div>
                  </div>
                </motion.li>
              ))}
            </motion.ol>
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
