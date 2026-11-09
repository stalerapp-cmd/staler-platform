import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftRight,
  Ban,
  ChevronDown,
  Crown,
  KeyRound,
  Landmark,
  LifeBuoy,
  BellRing,
  Contact,
  MessagesSquare,
  PhoneCall,
  Megaphone,
  Plane,
  QrCode,
  Repeat,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  Gauge,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { PageHeader, cx } from '../components/ui';

type L = [string, string];
interface Topic {
  id: string;
  who: 'all' | 'admin';
  icon: LucideIcon;
  title: L;
  to?: string;
  steps: L[];
}

/** The bank's guide: what each part does and how — customers see theirs, staff see everything. */
const TOPICS: Topic[] = [
  {
    id: 'types',
    who: 'all',
    icon: UserRound,
    title: ['Your account type', 'نوع حسابك'],
    to: '/app/settings',
    steps: [
      ['When you sign up you choose: personal (your everyday money), business (a shop or company) or cash agent (you take and hand out cash). Business and agent accounts add the business name.', 'لما تفتح حساب بتختار: شخصي (مصاريك اليومية)، تجاري (متجر أو شركة) أو صرّاف (بتستلم وبتسلّم كاش للناس). الحساب التجاري والصرّاف بينضافلهم اسم النشاط.'],
      ['People who send you money see the type and the business name, so they know they reached the right place.', 'اللي بيحوّلك بيشوف نوع الحساب واسم النشاط، فبيعرف إنه وصل للمكان الصح.'],
      ['Each type can have its own daily transfer limit. To change your type, write to support.', 'كل نوع إله سقف تحويل يومي خاص فيه. لتغيّر النوع احكي مع الدعم.'],
    ],
  },
  {
    id: 'transfer',
    who: 'all',
    icon: ArrowLeftRight,
    title: ['Transfers', 'الحوالات'],
    to: '/app/transfer',
    steps: [
      ['Type an IBAN, an account number or @username. We show the holder’s name before you confirm.', 'اكتب IBAN، رقم حساب أو @اسم المستخدم. منبيّنلك اسم صاحب الحساب قبل ما تأكد.'],
      ['Big transfers ask for your 2-step code if you turned it on.', 'الحوالات الكبيرة بتطلب رمز التحقق إذا مفعّله.'],
    ],
  },
  {
    id: 'beneficiaries',
    who: 'all',
    icon: Contact,
    title: ['Saved beneficiaries', 'المستفيدين المحفوظين'],
    to: '/app/beneficiaries',
    steps: [
      ['After a transfer, save the person with a name you know them by — or add them from “Beneficiaries”.', 'بعد أي حوالة احفظ الشخص باسم بتعرفه فيه — أو ضيفه من صفحة «المستفيدين».'],
      ['They show at the top of the transfer and scheduled-payment forms; one tap fills the account. Star the ones you use most.', 'بيطلعوا فوق بفورم الحوالة والدفعة المجدولة، وبكبسة بيتعبّى الحساب. حط نجمة عاللي بتستخدمهم أكثر.'],
      ['You still see the holder’s name and confirm before anything is sent. Removing someone keeps your past transfers.', 'برضو بتشوف اسم صاحب الحساب وبتأكد قبل ما ينبعت إشي. ولما تشيل حدا الحوالات القديمة بتضل.'],
    ],
  },
  {
    id: 'requests',
    who: 'all',
    icon: QrCode,
    title: ['Payment requests & QR', 'طلبات الدفع والـ QR'],
    to: '/app/requests',
    steps: [['Create a request for an amount and share its link or QR; whoever scans it pays you straight away.', 'اعمل طلب بمبلغ وشارك رابطه أو الـ QR؛ اللي بيمسحه بيدفعلك فورًا.']],
  },
  {
    id: 'scheduled',
    who: 'all',
    icon: Repeat,
    title: ['Scheduled payments', 'الدفعات المجدولة'],
    to: '/app/scheduled',
    steps: [
      ['Money that leaves your account on time by itself: once, weekly, every two weeks, monthly or every N days — forever, until a date or for N payments (instalments).', 'مصاري بتطلع من حسابك لحالها بالموعد: مرة وحدة، كل أسبوع، أسبوعين، شهر أو كل كم يوم — للأبد، لتاريخ، أو عدد دفعات (تقسيط).'],
      ['The first time, the receiver accepts — in the notification, on their home page or under “To you”. They can decline and stop you asking again.', 'أول مرة، المستلم بيوافق — من الإشعار، من صفحته الرئيسية أو من «دفعات إلك». وبيقدر يرفض ويمنعك تطلب مرة ثانية.'],
      ['Sent by itself, or only a reminder you pay with one tap; reminders the same day, a day, two days or a week before. Pause, skip, pay now or edit any time.', 'بتنبعت لحالها أو بس تذكير وإنت بتدفع بكبسة؛ والتذكير بنفس اليوم، قبل بيوم، يومين أو أسبوع. وقّف، تخطّى، ادفع هلّأ أو عدّل وقت ما بدك.'],
    ],
  },
  {
    id: 'privacy',
    who: 'all',
    icon: Ban,
    title: ['Privacy & blocking', 'الخصوصية والبلوك'],
    to: '/app/scheduled?tab=blocked',
    steps: [
      ['Block someone by IBAN, account number or @username. A block stops transfers, QR payments, lookups and scheduled payments between you both ways; they aren’t told.', 'بلّك حدا بالـ IBAN، رقم الحساب أو @اسم المستخدم. البلوك بيوقف الحوالات والـ QR والبحث والدفعات المجدولة بينكم بالاتجاهين، وما بيوصله إشعار.'],
      ['Settings → Account type & privacy has your blocked list and payments waiting for your yes.', 'من الإعدادات ← نوع الحساب والخصوصية بتلاقي المحظورين والدفعات اللي بتستنى موافقتك.'],
    ],
  },
  {
    id: 'wallet',
    who: 'all',
    icon: Wallet,
    title: ['Wallet & S-Taler', 'المحفظة وS‑Taler'],
    to: '/app/wallet',
    steps: [['Link your S-Taler wallet with a one-time code and move money between the bank and the wallet.', 'اربط محفظة S‑Taler برمز لمرة وحدة، وحوّل بين البنك والمحفظة.']],
  },
  {
    id: 'security',
    who: 'all',
    icon: ShieldCheck,
    title: ['Security', 'الأمان'],
    to: '/app/settings',
    steps: [['Turn on 2-step codes, see your signed-in devices and sign them out, and manage linked apps.', 'فعّل رمز التحقق بخطوتين، شوف الأجهزة اللي داخلة وطلّعها، وتحكّم بالتطبيقات المربوطة.']],
  },
  {
    id: 'support',
    who: 'all',
    icon: LifeBuoy,
    title: ['Support', 'الدعم'],
    to: '/app/support',
    steps: [
      ['Pick what it’s about and write. One team member takes it and stays with you; you see who.', 'اختار موضوعك واكتب. حدا من الفريق بيستلمه وبيضل معك، وبتشوف مين.'],
      ['When it’s closed, rate the help. Write again any time to start a new conversation.', 'لما تتسكّر قيّم المساعدة. واكتب وقت ما بدك لتبلّش محادثة جديدة.'],
    ],
  },
  {
    id: 'alerts',
    who: 'all',
    icon: BellRing,
    title: ['Pop-up notifications and sound', 'إشعارات منبثقة وصوت'],
    to: '/app/settings',
    steps: [
      ['Off until you turn them on, per device: Settings → “Notifications on this device”. Your browser or phone asks you to allow them.', 'مطفية لحد ما تشغّلها، لكل جهاز لحاله: الإعدادات ← «الإشعارات على هالجهاز». المتصفح أو الجوال بيسألك تسمح.'],
      ['Transfers, messages and support replies then pop up right away — in another tab, on the laptop, in the phone’s browser or the app. Inside the app they slide in at the top; tap one to open it.', 'بعدها الحوالات والرسائل وردود الدعم بتطلعلك فورًا — بتاب ثانية، عاللابتوب، بمتصفح الجوال أو بالتطبيق. وجوا التطبيق بتنزل من فوق، واكبس عليها لتفتحها.'],
      ['Add a short chime if you like, and press “Try it”. On iPhone, add the site to the Home Screen first. Signing out stops them on that device.', 'وبتقدر تضيف نغمة قصيرة واكبس «جرّب». عالآيفون، ضيف الموقع عالشاشة الرئيسية أول. ولما تطلع من حسابك بتوقف على هالجهاز.'],
    ],
  },
  {
    id: 'messages',
    who: 'all',
    icon: MessagesSquare,
    title: ['Messages', 'الرسائل'],
    to: '/app/messages',
    steps: [
      ['Chat with other TalerBank customers. Start from a beneficiary, or type someone’s exact @username, e-mail, IBAN or account number — there’s no search by name, for privacy.', 'احكي مع زباين TalerBank التانيين. ابدأ من المستفيدين، أو اكتب @اسم المستخدم أو الإيميل أو IBAN أو رقم الحساب كامل — ما في بحث بالاسم حفاظًا عالخصوصية.'],
      ['Reply, react, copy, edit within 15 minutes or delete for both. Messages are encrypted when stored. Two ticks mean they read it.', 'رد، تفاعل بإيموجي، انسخ، عدّل خلال 15 دقيقة أو احذف عند الطرفين. الرسائل مشفّرة وهي مخزّنة. علامتين يعني قرأها.'],
      ['From the chat: “Send money” opens a transfer to them, save them as a beneficiary, or block them — a block stops messages, transfers and scheduled payments both ways.', 'من المحادثة: «حوّل» بيفتحلك حوالة إله، أو احفظه بالمستفيدين، أو بلّكه — البلوك بيوقف الرسائل والحوالات والدفعات المجدولة بالاتجاهين.'],
      ['Support is pinned at the top of your messages: pick a topic, one team member takes it and stays with you, and you can rate the help.', 'الدعم مثبّت فوق رسائلك: اختار الموضوع، حدا من الفريق بيستلم وبيضل معك، وبتقدر تقيّم المساعدة.'],
    ],
  },
  {
    id: 'calls',
    who: 'all',
    icon: PhoneCall,
    title: ['A call with support', 'مكالمة مع الدعم'],
    to: '/app/support?calls=1',
    steps: [
      ['In support, press “Call”, pick the topic and describe the problem. The team accepts or answers by message.', 'بالدعم اكبس «مكالمة»، اختار الموضوع واحكي شو المشكلة. الفريق بيقبل أو بيرد عليك بالرسائل.'],
      ['Once accepted, pick a free time within the team’s hours. At that time they call you in the app — voice or video — or show you a “Call” button.', 'لما ينقبل، اختار وقت فاضي ضمن ساعات الفريق. بالموعد بيتصلوا فيك من التطبيق — صوت أو فيديو — أو بيظهرلك زر «اتصل».'],
      ['Sorted already? Cancel the call. Missed it? Book another time.', 'انحلّت؟ الغِ المكالمة. فاتتك؟ احجز وقت ثاني.'],
    ],
  },
  // ---------------------------------------------------------------- staff
  {
    id: 'a-customers',
    who: 'admin',
    icon: Users,
    title: ['Customers & account types', 'الزباين وأنواع الحسابات'],
    to: '/app/admin/customers',
    steps: [
      ['Filter customers by personal, business or cash agent; open one to change their type and business name — they are told.', 'فلتر الزباين حسب شخصي، تجاري أو صرّاف؛ وافتح أي زبون لتغيّر نوع حسابه واسم نشاطه — وبيوصله إشعار.'],
    ],
  },
  {
    id: 'a-limits',
    who: 'admin',
    icon: Gauge,
    title: ['Daily transfer limits', 'سقوف التحويل اليومية'],
    to: '/app/admin/limits',
    steps: [
      ['Each account type has a daily limit — tap the pencil to change it; empty uses the bank-wide limit.', 'لكل نوع حساب سقف يومي — اكبس القلم لتغيّره؛ فاضي = السقف العام.'],
      ['Under “All accounts” search anyone, see how much they sent today, and give them their own limit — higher or lower than their type.', 'تحت «كل الحسابات» دوّر على أي حدا، شوف قديش حوّل اليوم، واعطيه سقف خاص — أعلى أو أقل من نوعه.'],
      ['The customer is notified of the new limit; the reason stays with staff. “Back to type” removes it.', 'الزبون بيوصله إشعار بسقفه الجديد، والسبب بيضل للفريق. «رجّعه حسب النوع» بيشيله.'],
    ],
  },
  {
    id: 'a-support',
    who: 'admin',
    icon: LifeBuoy,
    title: ['Messages & support', 'الرسائل والدعم'],
    to: '/app/admin/support',
    steps: [
      ['New requests wait in the Queue. Take one (or just reply) and it’s yours — only you answer it. Release it back if you can’t.', 'الطلبات الجديدة بتستنى بالطابور. استلم واحد (أو رد عليه) وبيصير إلك — بس إنت بترد. ورجّعه للطابور إذا ما بتقدر.'],
      ['Close it when done; the customer is asked to rate you.', 'سكّره لما تخلص؛ والزبون بينطلب منه يقيّمك.'],
      ['“Handed to you” lists chats the super admin gave you, with the reason. Take it, or ask to move it and say why.', '«انحوّلتلك» بتبين المحادثات اللي حوّلها إلك السوبر أدمن مع السبب. استلمها، أو اطلب تحويلها واحكي ليش.'],
      ['“Message a customer” (or “Message” on their card in Customers): pick anyone, what it’s about, and write. It reaches them as a message from TalerBank in their support chat with a notification; a closed chat reopens and becomes yours. For an announcement to many people use “Send notification”.', '«رسالة لزبون» (أو «راسله» من بطاقته بالزباين): اختار أي حدا، واختار بخصوص شو، واكتب. بتوصله رسالة من TalerBank بمحادثة الدعم تبعته مع إشعار، والمحادثة المسكّرة بتنفتح وبتصير إلك. ولإعلان لكثير ناس استخدم «إرسال إشعار».'],
    ],
  },
  {
    id: 'a-calls',
    who: 'admin',
    icon: PhoneCall,
    title: ['Support calls', 'مكالمات الدعم'],
    to: '/app/admin/calls',
    steps: [
      ['“New requests”: accept or decline. Whoever accepts owns the call; the customer then books a time.', '«طلبات جديدة»: اقبل أو ارفض. اللي بيقبل بتصير المكالمة إله، والزبون بيحجز وقت.'],
      ['“Booked”: call by voice or video, or let the customer call you with a button you can hide again. Mark it done after.', '«مواعيد»: اتصل صوت أو فيديو، أو خلي الزبون يتصل فيك بزر بتقدر تخفيه. وبعدها علّمها «خلصت».'],
      ['“Ask for a call” sends a request to a customer; “Hours” sets the days, times and slot length. Staff on leave don’t get new requests.', '«اطلب مكالمة» بيبعت طلب لزبون؛ و«ساعات التوفر» بتحدد الأيام والساعات وطول الموعد. اللي بإجازة ما بيوصلهم طلبات جديدة.'],
    ],
  },
  {
    id: 'a-team',
    who: 'admin',
    icon: Crown,
    title: ['Super admin: team & every chat', 'السوبر أدمن: الفريق وكل المحادثات'],
    to: '/app/admin/team',
    steps: [
      ['Team performance: chats each member took, open now, first-reply time, ratings and comments.', 'أداء الفريق: كم محادثة استلم كل واحد، المفتوحة معه، سرعة أول رد، التقييمات والتعليقات.'],
      ['Support → Everything: filter by staff member and status, read any chat live, hand it to someone with a reason (a closed chat opens again) or to yourself to reply.', 'الدعم ← كل المحادثات: فلتر حسب الموظف والحالة، اقرأ أي محادثة أول بأول، وحوّلها لحدا مع السبب (المسكّرة بترجع تنفتح) أو لنفسك لترد.'],
    ],
  },
  {
    id: 'a-leave',
    who: 'admin',
    icon: Plane,
    title: ['Leave', 'الإجازات'],
    to: '/app/admin/leaves',
    steps: [['Any staff member asks for leave with dates and a reason; the super admin approves, declines, or puts someone on leave or off support. While away they get no new requests, and it shows under their name when handing chats.', 'أي موظف بيطلب إجازة بتاريخ وسبب؛ والسوبر أدمن بيوافق، بيرفض، أو بيحط حدا بإجازة أو بيوقفه عن الدعم. وقت الإجازة ما بتوصله طلبات جديدة، وبيبين تحت اسمه لما تحوّل محادثات.']],
  },
  {
    id: 'a-scheduled',
    who: 'admin',
    icon: Repeat,
    title: ['Scheduled payments & blocks', 'الدفعات المجدولة والبلوكات'],
    to: '/app/admin/scheduled',
    steps: [['See who pays whom on a schedule and who hasn’t accepted; pause any payment with a reason both sides see. See every block, lift one, or keep two customers apart (they can’t lift a bank block).', 'شوف مين بيدفع لمين بشكل مجدول ومين لسا ما وافق؛ وقّف أي دفعة مع سبب بيوصل للطرفين. وشوف كل البلوكات، شيل أي واحد، أو افصل بين زبونين (وما بيقدروا يشيلوا بلوك البنك).']],
  },
  {
    id: 'a-notify',
    who: 'admin',
    icon: Megaphone,
    title: ['Notifications', 'الإشعارات'],
    to: '/app/admin/notify',
    steps: [['Send a notice to everyone or to chosen customers.', 'ابعت إشعار للكل أو لزباين بتختارهم.']],
  },
  {
    id: 'a-ledger',
    who: 'admin',
    icon: Landmark,
    title: ['Ledger, teller & audit', 'الدفتر والصندوق والسجل'],
    to: '/app/admin/ledger',
    steps: [['Every movement in the bank, cash in/out at the counter, and an audit log of every staff action.', 'كل حركة بالبنك، إيداع وسحب كاش من الصندوق، وسجل لكل إجراء عمله الموظفين.']],
  },
  {
    id: 'a-admins',
    who: 'admin',
    icon: KeyRound,
    title: ['Staff & permissions', 'الموظفين والصلاحيات'],
    to: '/app/admin/admins',
    steps: [['Only the super admin adds staff and chooses exactly what each one may do.', 'بس السوبر أدمن بيضيف موظفين وبيحدد بالضبط شو مسموح لكل واحد.']],
  },
];

export default function Help() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const staff = user?.role === 'admin';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const i = ar ? 1 : 0;
  const list = TOPICS.filter((t) => (staff ? true : t.who === 'all')).filter((t) => {
    if (!q.trim()) return true;
    const hay = `${t.title[i]} ${t.steps.map((s) => s[i]).join(' ')}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={ar ? 'كيف بتشتغل' : 'How it works'} lead={staff ? (ar ? 'كل أقسام البنك — للزباين وللفريق.' : 'Every part of the bank — for customers and for staff.') : ar ? 'كل اللي بتقدر تعمله بحسابك، خطوة بخطوة.' : 'Everything you can do with your account, step by step.'} />
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر…' : 'Search…'} className="field h-12 rounded-2xl ps-12" type="search" />
      </label>
      {(['all', 'admin'] as const)
        .filter((g) => g === 'all' || staff)
        .map((g) => {
          const items = list.filter((t) => t.who === g);
          if (!items.length) return null;
          return (
            <section key={g} className="mb-6">
              {staff && <h2 className="mb-2 text-lg">{g === 'all' ? (ar ? 'للزباين' : 'For customers') : ar ? 'للفريق' : 'For staff'}</h2>}
              <ul className="card divide-y divide-line overflow-hidden">
                {items.map((t) => {
                  const on = open === t.id;
                  return (
                    <li key={t.id}>
                      <button onClick={() => setOpen(on ? null : t.id)} aria-expanded={on} className="flex w-full items-center gap-3 px-4 py-3.5 text-start transition hover:bg-sunk/60">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunk">
                          <t.icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1 font-semibold">{t.title[i]}</span>
                        <ChevronDown className={cx('h-5 w-5 shrink-0 text-muted transition', on && 'rotate-180')} />
                      </button>
                      <AnimatePresence initial={false}>
                        {on && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <ol className="space-y-2 px-4 pb-4 ps-[4.25rem]">
                              {t.steps.map((s, n) => (
                                <li key={n} className="flex gap-2.5 text-sm leading-relaxed">
                                  {t.steps.length > 1 && <span className="num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-night text-[11px] text-white dark:bg-white/20">{n + 1}</span>}
                                  <span>{s[i]}</span>
                                </li>
                              ))}
                            </ol>
                            {t.to && (
                              <Link to={t.to} className="mx-4 mb-4 ms-[4.25rem] inline-flex rounded-xl bg-night px-3.5 py-2 text-sm font-semibold text-white dark:bg-white/15">
                                {ar ? 'افتحها' : 'Open it'}
                              </Link>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
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
