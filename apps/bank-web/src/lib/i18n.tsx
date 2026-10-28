import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const en = {
  brand: { name: 'TalerBank', tagline: 'Private banking, engraved in trust.' },
  common: {
    continue: 'Continue', cancel: 'Cancel', back: 'Back', save: 'Save changes', saved: 'Saved', close: 'Close', confirm: 'Confirm', copy: 'Copy', copied: 'Copied',
    retry: 'Try again', loading: 'Loading…', search: 'Search', all: 'All', in: 'Incoming', out: 'Outgoing', empty: 'Nothing here yet', optional: 'optional',
    amount: 'Amount', delete: 'Delete', yes: 'Yes', no: 'No', status: 'Status', date: 'Date', more: 'Load more', done: 'Done', language: 'العربية', theme: 'Theme',
    signOut: 'Sign out', menu: 'Menu', details: 'Details', total: 'Total', or: 'or', from: 'From', to: 'To', note: 'Reference', revoke: 'Revoke',
  },
  nav: {
    overview: 'Overview', transfer: 'Transfer', transactions: 'Statements', requests: 'Payment requests', scan: 'Scan to pay', wallet: 'Send to S-Taler',
    apps: 'Linked apps', settings: 'Profile & security', notifications: 'Notifications', admin: 'Administration', customers: 'Customers',
    ledger: 'All transactions', exchange: 'Exchange & reserves', audit: 'Audit log', system: 'Bank settings', more: 'More', home: 'Home', statementsTab: 'Statement',
  },
  auth: {
    welcome: 'Welcome to TalerBank', lead: 'Sign in with your e-mail or username.', login: 'E-mail or username', password: 'Password', signIn: 'Sign in',
    noAccount: 'No account yet?', open: 'Open an account', have: 'Already a customer?', forgot: 'Forgot password?', registerTitle: 'Open your account',
    registerLead: 'A current account with a Palestinian IBAN, ready in minutes.', fullName: 'Full name', email: 'E-mail', username: 'Username',
    usernameHint: '3–32 letters, digits or _. Others can pay you with @username.', create: 'Open account', verifyTitle: 'Confirm your e-mail',
    verifyLead: 'Enter the 6-digit code we sent to', verify: 'Confirm', resend: 'Send a new code', resent: 'A new code is on its way',
    mfaTitle: 'Two-step verification', mfaLead: 'Enter the code from your authenticator app, or a recovery code.', mfaCode: 'Authenticator code',
    resetTitle: 'Reset password', resetLead: 'We will e-mail you a code to choose a new password.', sendCode: 'Send code', newPassword: 'New password',
    setPassword: 'Set new password', resetDone: 'Password updated. Please sign in.', pwRules: 'At least 10 characters with upper and lower case, a digit and a symbol.',
    strength: ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent'], idle: 'For your security you were signed out after inactivity.',
    trust1: 'Every transfer is double-entry and atomic', trust2: 'Two-step verification for money movements', trust3: 'Apps get scoped, revocable access — never your password',
  },
  home: {
    greeting: 'Good to see you', available: 'Available balance', iban: 'IBAN', account: 'Account', income: 'In · 30 days', spending: 'Out · 30 days',
    flow: 'Cash flow · 30 days', recent: 'Latest movements', seeAll: 'Full statement', frozen: 'This account is frozen. Contact the bank.',
    noTx: 'No movements yet.', quick: 'Quick actions',
  },
  tx: {
    types: {
      transfer: 'Transfer', deposit: 'Cash deposit', withdrawal: 'Cash withdrawal', taler_withdraw: 'To S-Taler wallet', taler_deposit: 'From S-Taler wallet',
      wire: 'Wire', fee: 'Fee',
    } as Record<string, string>,
    direction: { in: 'Incoming', out: 'Outgoing' } as Record<string, string>,
    balanceAfter: 'Balance after', reference: 'Reference', counterparty: 'Counterparty', exportCsv: 'Export CSV', from: 'From date', to: 'To date',
    searchPh: 'Name, reference or subject',
  },
  transfer: {
    title: 'New transfer', fromAcc: 'From account', to: 'Beneficiary', toPh: 'IBAN, account number or @username', subject: 'Payment reference',
    review: 'Review transfer', beneficiary: 'Beneficiary', send: 'Send transfer', sent: 'Transfer completed', newOne: 'New transfer', limits: 'Limits',
    perTransfer: 'per transfer', perDay: 'per day',
  },
  requests: {
    title: 'Payment requests', lead: 'Create a QR code; any TalerBank customer can scan it and pay you.', create: 'Create request', fixed: 'Fixed amount',
    description: 'What is it for?', show: 'Show QR', st: { pending: 'Waiting', paid: 'Paid', expired: 'Expired' } as Record<string, string>,
    payTitle: 'Pay a request', payee: 'Pay to', pay: 'Pay now', paid: 'Payment sent', notPayable: 'This request can no longer be paid.',
  },
  scan: {
    title: 'Scan to pay', lead: 'Scan a TalerBank payment request.', paste: 'Or paste the code', use: 'Use code', unknown: 'This is not a TalerBank payment code.',
    camera: 'Start camera', denied: 'Camera access was blocked. Allow it in settings, or paste the code.', stalerHint: 'Taler wallet codes are scanned in the S-Taler app.',
  },
  wallet: {
    title: 'Send to your S-Taler wallet', lead: 'Create a withdrawal, scan the QR with S-Taler, then confirm here. Money moves only after your confirmation.',
    create: 'Create withdrawal QR', step1: 'Scan this code with S-Taler', step2: 'Confirm the transfer', waiting: 'Waiting for S-Taler to scan…',
    selected: 'Your wallet is ready', selectedLead: 'A wallet scanned this code. Confirm to send the money.', wallet: 'Wallet', confirm: 'Confirm & send',
    abort: 'Cancel withdrawal', done: 'Sent to S-Taler', aborted: 'This withdrawal was cancelled or expired.', recent: 'Recent withdrawals', expires: 'Expires',
    st: { pending: 'Waiting for wallet', selected: 'Awaiting your confirmation', confirmed: 'Sent', aborted: 'Cancelled' } as Record<string, string>,
    copyUri: 'Copy link',
  },
  apps: {
    title: 'Linked apps', lead: 'Apps like S-Taler can move money from your account into your own wallet. They never see your password, and you can revoke them anytime.',
    code: 'Create link code', codeLead: 'Type this code into S-Taler → Bank → Link with a code. It works once and expires in 10 minutes.', expiresIn: 'Expires',
    none: 'No apps are linked.', scopes: 'Can do', lastUsed: 'Last used', never: 'never', revokeQ: 'Revoke access? The app will need a new link code.',
    scope: { read: 'See balance', withdraw: 'Top up your wallet' } as Record<string, string>,
  },
  settings: {
    title: 'Profile & security', profile: 'Profile', fullName: 'Full name', phone: 'Phone', language: 'Language', appearance: 'Appearance', light: 'Light',
    dark: 'Dark', username: 'Username', password: 'Password', currentPassword: 'Current password', change: 'Change password',
    changed: 'Password changed. Other devices were signed out.', twofa: 'Two-step verification', on: 'On', off: 'Off',
    twofaLead: 'Protects sign-in, transfers and wallet withdrawals with a code from your phone.', enable: 'Turn on', disable: 'Turn off',
    scanApp: 'Scan with Google Authenticator, Authy or 1Password, then enter the code.', secret: 'Setup key', recovery: 'Recovery codes',
    recoveryLead: 'Keep these offline. Each works once if you lose your phone.', sessions: 'Signed-in devices', thisDevice: 'This device',
    signOutAll: 'Sign out everywhere', lastActive: 'Last active', close: 'Close account', closeLead: 'All balances must be zero. Linked apps are revoked.',
    closeConfirm: 'Close my account',
  },
  admin: {
    overview: 'Bank overview', customers: 'Customers', deposits: 'Customer deposits', exchange: 'Exchange reserve', central: 'Central account', volume: 'Volume · 7 days',
    tx24: 'Transactions · 24h', pending: 'Open withdrawals', with2fa: 'With 2FA', frozen: 'Frozen accounts', recent: 'Recent security events',
    active: 'Active', suspended: 'Suspended', suspend: 'Suspend', activate: 'Reactivate', freeze: 'Freeze', unfreeze: 'Unfreeze', revokeSessions: 'Sign out all devices',
    reset2fa: 'Reset 2FA', teller: 'Teller desk', cashIn: 'Cash deposit', cashOut: 'Cash withdrawal', tellerNote: 'Teller note', book: 'Book',
    roles: { user: 'Customer', admin: 'Administrator' } as Record<string, string>, makeAdmin: 'Make administrator', makeCustomer: 'Make customer',
    reserves: 'Reserves', wires: 'Wallet payouts', registrations: 'Allow new accounts', maintenance: 'Maintenance mode', maintenanceD: 'Pauses customer transfers and withdrawals.',
    bankName: 'Bank name', accounts: 'Accounts', apps: 'Linked apps', volume14: 'Volume · 14 days', series: 'Daily volume',
  },
  errors: {
    NETWORK: 'No connection. Check your internet and try again.', INSUFFICIENT_FUNDS: 'Insufficient funds.', MFA_REQUIRED: 'Enter your authenticator code to continue.',
    MFA_INVALID: 'That authenticator code is not correct.', INVALID_CREDENTIALS: 'Sign-in details are not correct.', RATE_LIMITED: 'Too many attempts. Please wait a moment.',
    ACCOUNT_TEMPORARILY_LOCKED: 'Too many failed attempts. Try again later or reset your password.', SESSION_EXPIRED: 'Your session ended. Please sign in again.',
    DAILY_LIMIT: 'Daily limit reached.', LIMIT_EXCEEDED: 'This amount is above the limit.', RECIPIENT_NOT_FOUND: 'No account matches this beneficiary.',
    INVALID_IBAN: 'This IBAN is not valid.', ACCOUNT_LOCKED: 'This account is frozen.', MAINTENANCE: 'The bank is under maintenance. Please try again soon.',
    USERNAME_TAKEN: 'This username is taken.',
  } as Record<string, string>,
};
type Dict = typeof en;

const ar: Dict = {
  brand: { name: 'TalerBank', tagline: 'صيرفة خاصة، محفورة بالثقة.' },
  common: {
    continue: 'متابعة', cancel: 'إلغاء', back: 'رجوع', save: 'حفظ التغييرات', saved: 'تم الحفظ', close: 'إغلاق', confirm: 'تأكيد', copy: 'نسخ', copied: 'تم النسخ',
    retry: 'حاول مجددًا', loading: 'جارٍ التحميل…', search: 'بحث', all: 'الكل', in: 'وارد', out: 'صادر', empty: 'لا شيء هنا بعد', optional: 'اختياري', amount: 'المبلغ',
    delete: 'حذف', yes: 'نعم', no: 'لا', status: 'الحالة', date: 'التاريخ', more: 'عرض المزيد', done: 'تم', language: 'English', theme: 'المظهر', signOut: 'تسجيل الخروج',
    menu: 'القائمة', details: 'التفاصيل', total: 'المجموع', or: 'أو', from: 'من', to: 'إلى', note: 'المرجع', revoke: 'إلغاء الصلاحية',
  },
  nav: {
    overview: 'نظرة عامة', transfer: 'حوالة', transactions: 'كشوف الحساب', requests: 'طلبات الدفع', scan: 'امسح وادفع', wallet: 'إرسال إلى S‑Taler',
    apps: 'التطبيقات المرتبطة', settings: 'الملف والأمان', notifications: 'الإشعارات', admin: 'الإدارة', customers: 'العملاء', ledger: 'كل الحركات',
    exchange: 'الصرّاف والاحتياطي', audit: 'سجل التدقيق', system: 'إعدادات البنك', more: 'المزيد', home: 'الرئيسية', statementsTab: 'الكشوف',
  },
  auth: {
    welcome: 'أهلًا بك في TalerBank', lead: 'سجّل الدخول ببريدك أو اسم المستخدم.', login: 'البريد أو اسم المستخدم', password: 'كلمة المرور', signIn: 'دخول',
    noAccount: 'ما عندك حساب؟', open: 'افتح حسابًا', have: 'عميل حالي؟', forgot: 'نسيت كلمة المرور؟', registerTitle: 'افتح حسابك',
    registerLead: 'حساب جارٍ برقم IBAN فلسطيني، جاهز خلال دقائق.', fullName: 'الاسم الكامل', email: 'البريد الإلكتروني', username: 'اسم المستخدم',
    usernameHint: 'من 3 إلى 32 حرفًا لاتينيًا أو رقمًا أو _. الآخرون بيقدروا يحوّلولك على @اسم_المستخدم.', create: 'فتح الحساب', verifyTitle: 'أكّد بريدك',
    verifyLead: 'أدخل الرمز المكوّن من 6 أرقام المرسل إلى', verify: 'تأكيد', resend: 'أرسل رمزًا جديدًا', resent: 'الرمز الجديد بالطريق', mfaTitle: 'التحقق بخطوتين',
    mfaLead: 'أدخل الرمز من تطبيق المصادقة، أو رمز استرداد.', mfaCode: 'رمز المصادقة', resetTitle: 'إعادة تعيين كلمة المرور', resetLead: 'رح نبعتلك رمز لتختار كلمة مرور جديدة.',
    sendCode: 'أرسل الرمز', newPassword: 'كلمة مرور جديدة', setPassword: 'تعيين كلمة المرور', resetDone: 'تم تحديث كلمة المرور. سجّل الدخول.',
    pwRules: '10 أحرف على الأقل، فيها حرف كبير وصغير ورقم ورمز.', strength: ['ضعيفة جدًا', 'ضعيفة', 'مقبولة', 'قوية', 'ممتازة'],
    idle: 'حفاظًا على أمانك تم تسجيل خروجك بعد عدم النشاط.', trust1: 'كل حوالة قيد مزدوج وذرّي', trust2: 'تحقق بخطوتين لكل حركة مال',
    trust3: 'التطبيقات بتاخد صلاحيات محدودة وقابلة للإلغاء — مش كلمة سرك',
  },
  home: {
    greeting: 'أهلًا فيك', available: 'الرصيد المتاح', iban: 'IBAN', account: 'الحساب', income: 'وارد · 30 يوم', spending: 'صادر · 30 يوم', flow: 'التدفق النقدي · 30 يوم',
    recent: 'آخر الحركات', seeAll: 'كشف الحساب الكامل', frozen: 'هذا الحساب مجمّد. تواصل مع البنك.', noTx: 'لا حركات بعد.', quick: 'إجراءات سريعة',
  },
  tx: {
    types: { transfer: 'حوالة', deposit: 'إيداع نقدي', withdrawal: 'سحب نقدي', taler_withdraw: 'إلى محفظة S‑Taler', taler_deposit: 'من محفظة S‑Taler', wire: 'حوالة سلكية', fee: 'رسوم' },
    direction: { in: 'وارد', out: 'صادر' }, balanceAfter: 'الرصيد بعدها', reference: 'المرجع', counterparty: 'الطرف الآخر', exportCsv: 'تصدير CSV', from: 'من تاريخ', to: 'إلى تاريخ',
    searchPh: 'اسم أو مرجع أو بيان',
  },
  transfer: {
    title: 'حوالة جديدة', fromAcc: 'من حساب', to: 'المستفيد', toPh: 'IBAN أو رقم الحساب أو @اسم_المستخدم', subject: 'بيان الدفع', review: 'مراجعة الحوالة',
    beneficiary: 'المستفيد', send: 'إرسال الحوالة', sent: 'تمت الحوالة', newOne: 'حوالة جديدة', limits: 'الحدود', perTransfer: 'للحوالة الواحدة', perDay: 'يوميًا',
  },
  requests: {
    title: 'طلبات الدفع', lead: 'أنشئ كود QR؛ أي عميل في TalerBank بيقدر يمسحه ويدفعلك.', create: 'إنشاء طلب', fixed: 'مبلغ محدد', description: 'شو الغرض؟', show: 'عرض الكود',
    st: { pending: 'بانتظار الدفع', paid: 'مدفوع', expired: 'منتهي' }, payTitle: 'دفع طلب', payee: 'الدفع إلى', pay: 'ادفع الآن', paid: 'تم الدفع',
    notPayable: 'هذا الطلب ما عاد قابل للدفع.',
  },
  scan: {
    title: 'امسح وادفع', lead: 'امسح كود طلب دفع من TalerBank.', paste: 'أو الصق الكود', use: 'استخدم الكود', unknown: 'هذا مش كود دفع من TalerBank.',
    camera: 'تشغيل الكاميرا', denied: 'تم منع الكاميرا. اسمح فيها من الإعدادات أو الصق الكود.', stalerHint: 'أكواد محفظة Taler بتنمسح من تطبيق S‑Taler.',
  },
  wallet: {
    title: 'إرسال إلى محفظة S‑Taler', lead: 'أنشئ عملية سحب، امسح الكود بـ S‑Taler، وبعدين أكّد هون. المصاري ما بتتحرك إلا بعد تأكيدك.', create: 'إنشاء كود السحب',
    step1: 'امسح هذا الكود بـ S‑Taler', step2: 'أكّد التحويل', waiting: 'بانتظار مسح S‑Taler…', selected: 'محفظتك جاهزة',
    selectedLead: 'في محفظة مسحت الكود. أكّد لإرسال المبلغ.', wallet: 'المحفظة', confirm: 'تأكيد وإرسال', abort: 'إلغاء السحب', done: 'تم الإرسال إلى S‑Taler',
    aborted: 'تم إلغاء السحب أو انتهت صلاحيته.', recent: 'آخر عمليات السحب', expires: 'ينتهي',
    st: { pending: 'بانتظار المحفظة', selected: 'بانتظار تأكيدك', confirmed: 'تم الإرسال', aborted: 'ملغى' }, copyUri: 'نسخ الرابط',
  },
  apps: {
    title: 'التطبيقات المرتبطة', lead: 'تطبيقات زي S‑Taler بتقدر تنقل مصاري من حسابك لمحفظتك أنت فقط. ما بتشوف كلمة سرك أبدًا، وبتقدر تلغيها بأي وقت.',
    code: 'إنشاء رمز ربط', codeLead: 'اكتب هذا الرمز في S‑Taler ← البنك ← الربط برمز. صالح لمرة وحدة ولمدة 10 دقائق.', expiresIn: 'ينتهي',
    none: 'لا توجد تطبيقات مرتبطة.', scopes: 'الصلاحيات', lastUsed: 'آخر استخدام', never: 'أبدًا', revokeQ: 'إلغاء الصلاحية؟ التطبيق رح يحتاج رمز ربط جديد.',
    scope: { read: 'عرض الرصيد', withdraw: 'شحن محفظتك' },
  },
  settings: {
    title: 'الملف والأمان', profile: 'الملف الشخصي', fullName: 'الاسم الكامل', phone: 'الهاتف', language: 'اللغة', appearance: 'المظهر', light: 'فاتح', dark: 'داكن',
    username: 'اسم المستخدم', password: 'كلمة المرور', currentPassword: 'كلمة المرور الحالية', change: 'تغيير كلمة المرور', changed: 'تم التغيير وتسجيل خروج الأجهزة الأخرى.',
    twofa: 'التحقق بخطوتين', on: 'مفعّل', off: 'غير مفعّل', twofaLead: 'بيحمي الدخول والحوالات وعمليات السحب برمز من جوالك.', enable: 'تفعيل', disable: 'إيقاف',
    scanApp: 'امسح بـ Google Authenticator أو Authy أو 1Password، ثم أدخل الرمز.', secret: 'مفتاح الإعداد', recovery: 'رموز الاسترداد',
    recoveryLead: 'احفظها بمكان غير متصل بالإنترنت. كل رمز لمرة وحدة.', sessions: 'الأجهزة المسجّلة', thisDevice: 'هذا الجهاز', signOutAll: 'تسجيل الخروج من كل الأجهزة',
    lastActive: 'آخر نشاط', close: 'إغلاق الحساب', closeLead: 'لازم تكون كل الأرصدة صفر. رح تنلغى صلاحيات التطبيقات المرتبطة.', closeConfirm: 'أغلق حسابي',
  },
  admin: {
    overview: 'نظرة على البنك', customers: 'العملاء', deposits: 'ودائع العملاء', exchange: 'احتياطي الصرّاف', central: 'الحساب المركزي', volume: 'الحجم · 7 أيام',
    tx24: 'الحركات · 24 ساعة', pending: 'عمليات سحب مفتوحة', with2fa: 'مع التحقق بخطوتين', frozen: 'حسابات مجمّدة', recent: 'آخر الأحداث الأمنية', active: 'نشط',
    suspended: 'موقوف', suspend: 'إيقاف', activate: 'إعادة تفعيل', freeze: 'تجميد', unfreeze: 'فك التجميد', revokeSessions: 'تسجيل خروج كل الأجهزة',
    reset2fa: 'إعادة ضبط التحقق بخطوتين', teller: 'شبّاك الصرّاف', cashIn: 'إيداع نقدي', cashOut: 'سحب نقدي', tellerNote: 'ملاحظة الصرّاف', book: 'قيد العملية',
    roles: { user: 'عميل', admin: 'مدير' }, makeAdmin: 'ترقية لمدير', makeCustomer: 'إرجاع لعميل', reserves: 'الاحتياطيات', wires: 'دفعات المحفظة',
    registrations: 'السماح بفتح حسابات', maintenance: 'وضع الصيانة', maintenanceD: 'بيوقف الحوالات وعمليات السحب للعملاء.', bankName: 'اسم البنك', accounts: 'الحسابات',
    apps: 'التطبيقات المرتبطة', volume14: 'الحجم · 14 يوم', series: 'الحجم اليومي',
  },
  errors: {
    NETWORK: 'ما في اتصال. افحص الإنترنت وحاول مجددًا.', INSUFFICIENT_FUNDS: 'الرصيد غير كافٍ.', MFA_REQUIRED: 'أدخل رمز المصادقة للمتابعة.', MFA_INVALID: 'رمز المصادقة غير صحيح.',
    INVALID_CREDENTIALS: 'بيانات الدخول غير صحيحة.', RATE_LIMITED: 'محاولات كثيرة. استنى شوي.', ACCOUNT_TEMPORARILY_LOCKED: 'محاولات فاشلة كثيرة. حاول لاحقًا أو أعد تعيين كلمة المرور.',
    SESSION_EXPIRED: 'انتهت جلستك. سجّل الدخول من جديد.', DAILY_LIMIT: 'وصلت للحد اليومي.', LIMIT_EXCEEDED: 'المبلغ أعلى من الحد المسموح.',
    RECIPIENT_NOT_FOUND: 'ما في حساب مطابق لهذا المستفيد.', INVALID_IBAN: 'رقم IBAN غير صحيح.', ACCOUNT_LOCKED: 'هذا الحساب مجمّد.',
    MAINTENANCE: 'البنك تحت الصيانة. حاول قريبًا.', USERNAME_TAKEN: 'اسم المستخدم محجوز.',
  },
};

export type Lang = 'en' | 'ar';
interface I18n {
  lang: Lang;
  t: Dict;
  dir: 'rtl' | 'ltr';
  setLang: (l: Lang) => void;
  toggle: () => void;
  err: (e: unknown) => string;
}
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const s = localStorage.getItem('tb.lang');
      if (s === 'en' || s === 'ar') return s;
    } catch {
      /* ignore */
    }
    return navigator.language?.startsWith('en') ? 'en' : 'ar';
  });
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('tb.lang', l);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<I18n>(() => {
    const t = lang === 'ar' ? ar : en;
    return {
      lang,
      t,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      setLang,
      toggle: () => setLang(lang === 'ar' ? 'en' : 'ar'),
      err: (e: any) => (e?.code && t.errors[e.code]) || e?.message || t.errors.NETWORK,
    };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
