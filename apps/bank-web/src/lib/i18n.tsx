import { serverTextAr } from './serverText';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const en = {
  brand: { name: 'TalerBank', tagline: 'Your money, safe. Your bank, in your pocket.' },
  navg: { banking: 'Banking', connect: 'Connections', admin: 'Administration', collapse: 'Collapse menu', expand: 'Expand menu', support: 'Support', supportLead: 'We answer every message. Pick what suits you.', emailUs: 'E-mail support', chatStaler: 'Chat with us in S-Taler', chatStalerD: 'Opens the support chat in your S-Taler wallet.', emailD: 'Write to us — we reply by e-mail.', hello: 'Hello' },
  mailtest: { title: 'E-mail check', lead: 'Send a test code to your own e-mail and see exactly what happened.', send: 'Send test e-mail', ok: 'Sent to {to}. If it isn’t in your inbox within a minute, look in Spam or Promotions and mark it “Not spam” — that teaches Gmail to deliver the next ones.', fail: 'Sending failed: {error}' },
  bio: { unlockTitle: 'Unlock', unlockReason: 'Confirm it’s you', unlock: 'Unlock with fingerprint', usePassword: 'Sign in with password instead', lockedLead: 'Locked to keep your money safe.', enableTitle: 'Open with your fingerprint?', enableLead: 'Next time, unlock with your fingerprint or phone PIN instead of typing your password. You can turn this off in Settings.', enable: 'Turn on', notNow: 'Not now', enabled: 'Fingerprint unlock is on', toggle: 'Unlock with fingerprint', toggleD: 'Use your fingerprint, face or phone PIN instead of your password on this phone.' },
  account: { user: 'Customer', admin: 'Admin', super: 'Super admin' } as Record<string, string>,
  landing: {
    title: 'A bank that keeps its word.', open: 'Open an account', signIn: 'Sign in',
    lead: 'Open an account with its own IBAN in minutes. Send instant transfers, pay and request by QR, and fund your S-Taler wallet — with an alert for every move.',
    f1t: 'Instant transfers', f1d: 'Send to any IBAN or username and it lands in seconds, any time of day.',
    f2t: 'Pay and request by QR', f2d: 'Show a code to get paid, or scan one to pay. No account numbers to type.',
    f3t: 'Linked to S-Taler', f3d: 'Top up your wallet straight from your account — you approve each app, and never share your password.',
    f4t: 'Nothing slips by', f4d: 'Two-step sign-in, device control and an instant alert for every movement on your account.',
    stat1: 'your own account number', stat2: 'transfers, day and night', stat3: 'two-step protection',
  },
  dl: {
    title: 'Take it with you.', lead: 'Our Android apps, always the newest version — straight from here, no store needed.',
    wallet: 'Wallet', bank: 'Bank', walletD: 'Send, receive and pay by QR from your pocket.', bankD: 'Your account, transfers and statements in one tap.',
    download: 'Download APK', updated: 'Updated',
    android: 'First install? Android will ask you to allow installs from your browser — that’s expected.',
    iphone: 'On iPhone? Open the site in Safari, tap Share, then “Add to Home Screen”. It works just like an app.',
  },
  foot: { store: 'Store', open: 'Open a wallet', bank: 'TalerBank', wallet: 'S-Taler', about: 'A Palestinian wallet and bank that work as one.', aboutBank: 'Digital banking that works hand in hand with the S-Taler wallet.', privacy: 'Your data stays encrypted, always.' },
  common: {
    continue: 'Continue', cancel: 'Cancel', areYouSure: 'Are you sure you want to continue?', back: 'Back', save: 'Save changes', saved: 'Saved', close: 'Close', confirm: 'Confirm', copy: 'Copy', copied: 'Copied',
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
    phone: 'Mobile number', or: 'or', viaEmail: 'E-mail', viaSms: 'SMS', sendVia: 'Send my code by', smsNeedsPhone: 'Add your phone number to get the code by SMS.', verifyLeadSms: 'We sent a 6-digit code by SMS to',
    resendIn: 'Send a new code in', noMailTitle: 'No code yet?', noMail1: 'Check Spam, Promotions and Updates — first e-mails often land there.', noMail2: 'It can take up to a minute to arrive.', noMail3: 'Typo in the address?', changeEmail: 'Change e-mail', reviewTitle: 'Is this e-mail right?', reviewBody: 'We’ll send your 6-digit code to {email}. Make sure it’s an inbox you can open now.', reviewOk: 'Yes, send the code',
    confirmPassword: 'Confirm password', mismatch: 'The two passwords don’t match.',
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
    searchPh: 'Name, reference or subject', typeLabel: 'Type',
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
  ask: {
    payTitle: 'Confirm payment', payBody: 'You are paying {amount} to {payee} from your account.', payOk: 'Pay {amount}',
    abortTitle: 'Cancel this withdrawal?', abortBody: 'The QR code stops working and no money moves.', abortOk: 'Cancel withdrawal',
    sendWalletTitle: 'Send to S-Taler?', sendWalletBody: '{amount} will leave your account and land in the wallet that scanned the code.', sendWalletOk: 'Send {amount}',
    allOutTitle: 'Sign out on every device?', allOutBody: 'Every phone and browser — including this one — will need to sign in again.', allOutOk: 'Sign out everywhere',
    deviceTitle: 'Sign this device out?', deviceBody: 'That device will need your password to get back in.', deviceOk: 'Sign it out',
    signOutTitle: 'Sign out?', signOutBody: 'You can sign back in anytime.', signOutOk: 'Sign out',
    tellerTitle: 'Book this cash movement?', tellerBody: '{kind} of {amount} on {name}’s account.', tellerOk: 'Book {amount}',
    saveTitle: 'Save bank settings?', saveBody: 'Changes apply to every customer right away.', saveOk: 'Save',
    requestTitle: 'Create this request?', requestBody: 'Anyone with the QR code can pay it until it is paid or expires.', requestOk: 'Create request',
  },
  people: {
    edit: 'Edit details', sendReset: 'E-mail a reset code', closeAccount: 'Close account', phone: 'Phone', language: 'Language', save: 'Save details', saved: 'Details saved',
    setPassword: 'Set a new password', setPasswordLead: 'They are signed out everywhere and told by e-mail.', setPasswordOk: 'Set password',
    notify: 'Send a notification', notifyLead: 'Shows up in their notifications.', title: 'Title', message: 'Message', send: 'Send',
    broadcast: 'Announcement to everyone', broadcastLead: 'Appears in every user’s notifications.', audience: 'Who gets it', everyone: 'Everyone', sent: 'Sent to {n} people',
    admins: 'Administrators', addAdmin: 'Add administrator', addAdminLead: 'Promote an existing account by its e-mail, or create a new one.',
    newAccountHint: 'New account? Add a name and a password too.', permissions: 'What can they do?', selectAll: 'Select all', clear: 'Clear',
    superAdmin: 'Super admin', superNote: 'Has every permission and is the only one who can manage administrators.', editPerms: 'Edit permissions',
    removeAdmin: 'Remove admin rights', yourAccount: 'This is your account — change it from your settings.', protected: 'Protected account',
    noPerms: 'No permissions yet', actions: 'Actions', security: 'Security', danger: 'Careful',
    q: {
      suspendT: 'Suspend {name}?', suspendB: 'They are signed out at once and cannot sign in until reactivated.', suspendOk: 'Suspend',
      activateT: 'Reactivate {name}?', activateB: 'They can sign in again right away.', activateOk: 'Reactivate',
      revokeT: 'Sign {name} out everywhere?', revokeB: 'Every device they use will need to sign in again.', revokeOk: 'Sign out',
      resetT: 'Send a reset code to {email}?', resetB: 'They choose their own new password with the code.', resetOk: 'Send code',
      twofaT: 'Turn off 2-step verification for {name}?', twofaB: 'Only do this after confirming who you are talking to.', twofaOk: 'Reset 2FA',
      deleteT: 'Delete {name}?', deleteB: 'Personal data is erased and the account can’t sign in again. Financial records stay for audit. This can’t be undone.', deleteOk: 'Delete account',
      removeAdminT: 'Remove {name}’s admin rights?', removeAdminB: 'They keep their account as a regular user and lose admin access immediately.', removeAdminOk: 'Remove rights',
      saveT: 'Save changes to {name}?', saveB: 'If you change the e-mail, the old address is told about it.', saveOk: 'Save',
      broadcastT: 'Send this announcement?', broadcastB: 'Everyone in the chosen group will see it in their notifications.', broadcastOk: 'Send to everyone',
      grantT: 'Give admin rights to {email}?', grantB: 'They get exactly the permissions you ticked — nothing more.', grantOk: 'Grant rights',
      permsT: 'Update {name}’s permissions?', permsB: 'The change applies the next time they open a page.', permsOk: 'Update',
    },
    perm: {
      'customers.view': 'See customers and their accounts', 'customers.edit': 'Edit names, e-mails, usernames and phones', 'customers.password': 'Set or reset passwords',
      'customers.status': 'Suspend and reactivate customers', 'customers.delete': 'Close customer accounts', 'customers.security': 'Sign customers out, reset 2FA',
      'accounts.freeze': 'Freeze accounts', teller: 'Teller desk (cash in and out)', 'ledger.view': 'See every transaction', notify: 'Send notifications and announcements',
      'exchange.view': 'See the exchange and reserves', 'audit.view': 'Read the audit log', 'settings.manage': 'Change bank settings',
    } as Record<string, string>,
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
  brand: { name: 'TalerBank', tagline: 'فلوسك بأمان، وبنكك بجيبتك.' },
  navg: { banking: 'الخدمات البنكية', connect: 'الربط', admin: 'الإدارة', collapse: 'صغّر القائمة', expand: 'كبّر القائمة', support: 'الدعم', supportLead: 'منرد على كل رسالة. اختار اللي بناسبك.', emailUs: 'راسل الدعم بالإيميل', chatStaler: 'احكي معنا بـ S-Taler', chatStalerD: 'بيفتح محادثة الدعم بمحفظتك S-Taler.', emailD: 'اكتبلنا — ومنرد عليك بالإيميل.', hello: 'مرحبا' },
  mailtest: { title: 'فحص الإيميل', lead: 'ابعت رمز تجريبي لإيميلك وشوف شو صار بالزبط.', send: 'ابعت إيميل تجريبي', ok: 'انبعت على {to}. إذا ما وصل الوارد خلال دقيقة، افحص البريد المزعج (Spam) أو العروض (Promotions) واكبس «ليس رسالة مزعجة» — هيك جيميل بيتعلّم يوصّل الجاية للوارد.', fail: 'ما زبط الإرسال: {error}' },
  bio: { unlockTitle: 'فتح القفل', unlockReason: 'أكّد إنه إنت', unlock: 'افتح بالبصمة', usePassword: 'ادخل بكلمة المرور بدلها', lockedLead: 'مقفول عشان تضل مصاريك بأمان.', enableTitle: 'بدك تفتح ببصمتك؟', enableLead: 'المرة الجاية افتح ببصمتك أو رمز قفل الجوال بدل ما تكتب كلمة المرور. بتقدر تطفيها من الإعدادات.', enable: 'شغّلها', notNow: 'مش هلّأ', enabled: 'تم تفعيل الفتح بالبصمة', toggle: 'الفتح بالبصمة', toggleD: 'استخدم بصمتك أو وجهك أو رمز قفل الجوال بدل كلمة المرور على هالجوال.' },
  account: { user: 'عميل', admin: 'مدير', super: 'المدير العام' },
  landing: {
    title: 'بنك قدّ كلمته.', open: 'افتح حساب', signIn: 'تسجيل الدخول',
    lead: 'افتح حساب برقم IBAN خاص فيك خلال دقائق. حوّل فورًا، ادفع واطلب بالـ QR، واشحن محفظة S-Taler — ومع كل حركة بيوصلك تنبيه.',
    f1t: 'حوالات فورية', f1d: 'حوّل لأي IBAN أو اسم مستخدم، وبتوصل خلال ثواني بأي وقت.',
    f2t: 'ادفع واطلب بالـ QR', f2d: 'اعرض الكود لتستلم، أو امسحه لتدفع. بدون ما تكتب أرقام حسابات.',
    f3t: 'مربوط مع S-Taler', f3d: 'اشحن محفظتك مباشرة من حسابك — إنت بتوافق على كل تطبيق، وكلمة سرك ما بتطلع لحدا.',
    f4t: 'ولا حركة بتفوتك', f4d: 'تحقق بخطوتين، تحكّم بأجهزتك، وتنبيه فوري مع كل حركة على حسابك.',
    stat1: 'رقم حساب خاص فيك', stat2: 'حوالات ليل نهار', stat3: 'حماية بخطوتين',
  },
  dl: {
    title: 'خلّيه معك وين ما رحت.', lead: 'تطبيقاتنا لأندرويد، دايمًا بآخر نسخة — نزّلها من هون مباشرة، بدون متجر.',
    wallet: 'المحفظة', bank: 'البنك', walletD: 'حوّل واستلم وادفع بالـ QR من جيبتك.', bankD: 'حسابك وحوالاتك وكشوفك بكبسة وحدة.',
    download: 'نزّل التطبيق', updated: 'آخر تحديث',
    android: 'أول مرة بتنزّل؟ أندرويد رح يطلب تسمح بالتثبيت من المتصفح — هاد طبيعي.',
    iphone: 'عندك آيفون؟ افتح الموقع من Safari، اكبس مشاركة ثم «إضافة إلى الشاشة الرئيسية» — بيشتغل متل التطبيق تمامًا.',
  },
  foot: { store: 'المتجر', open: 'افتح محفظة', bank: 'TalerBank', wallet: 'S-Taler', about: 'محفظة وبنك فلسطينيين بيشتغلوا مع بعض كأنهم واحد.', aboutBank: 'بنك رقمي بيشتغل إيد بإيد مع محفظة S-Taler.', privacy: 'بياناتك مشفّرة، دايمًا.' },
  common: {
    continue: 'متابعة', cancel: 'إلغاء', areYouSure: 'متأكد إنك بدك تكمل؟', back: 'رجوع', save: 'حفظ التغييرات', saved: 'تم الحفظ', close: 'إغلاق', confirm: 'تأكيد', copy: 'نسخ', copied: 'تم النسخ',
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
    phone: 'رقم الجوال', or: 'أو', viaEmail: 'الإيميل', viaSms: 'رسالة SMS', sendVia: 'ابعتلي الرمز على', smsNeedsPhone: 'أضف رقم جوالك لتستلم الرمز برسالة SMS.', verifyLeadSms: 'بعتنالك رمز من 6 أرقام برسالة SMS على',
    resendIn: 'رمز جديد بعد', noMailTitle: 'ما وصلك الرمز؟', noMail1: 'افحص البريد المزعج (Spam) والعروض (Promotions) — أول رسالة كثير بتروح هناك.', noMail2: 'ممكن تاخد لحد دقيقة لتوصل.', noMail3: 'في غلط بالإيميل؟', changeEmail: 'غيّر الإيميل', reviewTitle: 'الإيميل صحيح؟', reviewBody: 'رح نبعت الرمز المكوّن من 6 أرقام على {email}. تأكد إنه إيميل بتقدر تفتحه هلّأ.', reviewOk: 'آه، ابعت الرمز',
    confirmPassword: 'تأكيد كلمة المرور', mismatch: 'كلمتا المرور مش متطابقتين.',
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
    searchPh: 'اسم أو مرجع أو بيان', typeLabel: 'نوع الحركة',
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
  ask: {
    payTitle: 'تأكيد الدفع', payBody: 'رح تدفع {amount} لـ {payee} من حسابك.', payOk: 'ادفع {amount}',
    abortTitle: 'إلغاء عملية السحب؟', abortBody: 'الكود بيوقف عن الشغل وما بتتحرك أي مصاري.', abortOk: 'إلغاء السحب',
    sendWalletTitle: 'إرسال لـ S‑Taler؟', sendWalletBody: 'رح يطلع {amount} من حسابك ويوصل للمحفظة اللي مسحت الكود.', sendWalletOk: 'أرسل {amount}',
    allOutTitle: 'تسجيل الخروج من كل الأجهزة؟', allOutBody: 'كل جوال ومتصفح، ومنهم هاد الجهاز، رح يحتاج تسجيل دخول من جديد.', allOutOk: 'اطلع من كل الأجهزة',
    deviceTitle: 'تسجيل خروج هالجهاز؟', deviceBody: 'رح يحتاج كلمة السر عشان يرجع يدخل.', deviceOk: 'سجّل خروجه',
    signOutTitle: 'تسجيل الخروج؟', signOutBody: 'بتقدر ترجع تدخل بأي وقت.', signOutOk: 'تسجيل الخروج',
    tellerTitle: 'تسجيل الحركة النقدية؟', tellerBody: '{kind} بقيمة {amount} على حساب {name}.', tellerOk: 'سجّل {amount}',
    saveTitle: 'حفظ إعدادات البنك؟', saveBody: 'التغييرات بتنطبق على كل العملاء فورًا.', saveOk: 'حفظ',
    requestTitle: 'إنشاء طلب الدفع؟', requestBody: 'أي حدا معه الكود بيقدر يدفعه لحد ما ينْدفع أو تخلص صلاحيته.', requestOk: 'أنشئ الطلب',
  },
  people: {
    edit: 'تعديل البيانات', sendReset: 'إرسال رمز إعادة تعيين', closeAccount: 'إغلاق الحساب', phone: 'الهاتف', language: 'اللغة', save: 'حفظ البيانات', saved: 'انحفظت البيانات',
    setPassword: 'تعيين كلمة مرور جديدة', setPasswordLead: 'رح يطلع من كل الأجهزة ويوصله إيميل بالتغيير.', setPasswordOk: 'عيّن كلمة المرور',
    notify: 'إرسال إشعار', notifyLead: 'بيظهرله بالإشعارات.', title: 'العنوان', message: 'الرسالة', send: 'إرسال',
    broadcast: 'إعلان للجميع', broadcastLead: 'بيظهر بإشعارات كل المستخدمين.', audience: 'لمين', everyone: 'الكل', sent: 'انبعت لـ {n} شخص',
    admins: 'المدراء', addAdmin: 'إضافة مدير', addAdminLead: 'رقّي حساب موجود بإيميله، أو أنشئ حساب جديد.',
    newAccountHint: 'حساب جديد؟ اكتب الاسم وكلمة السر كمان.', permissions: 'شو بيقدر يعمل؟', selectAll: 'تحديد الكل', clear: 'مسح',
    superAdmin: 'المدير الأعلى', superNote: 'عنده كل الصلاحيات، وهو الوحيد اللي بيقدر يضيف مدراء ويحدد صلاحياتهم.', editPerms: 'تعديل الصلاحيات',
    removeAdmin: 'سحب صلاحيات الإدارة', yourAccount: 'هاد حسابك، عدّله من صفحة الإعدادات.', protected: 'حساب محمي',
    noPerms: 'ما في صلاحيات لسا', actions: 'الإجراءات', security: 'الأمان', danger: 'انتبه',
    q: {
      suspendT: 'إيقاف حساب {name}؟', suspendB: 'رح يطلع فورًا وما بيقدر يدخل لحد ما ترجع تفعّله.', suspendOk: 'أوقف الحساب',
      activateT: 'إعادة تفعيل {name}؟', activateB: 'بيقدر يدخل من جديد فورًا.', activateOk: 'فعّل الحساب',
      revokeT: 'تسجيل خروج {name} من كل الأجهزة؟', revokeB: 'كل جهاز بيستخدمه رح يحتاج تسجيل دخول من جديد.', revokeOk: 'سجّل خروجه',
      resetT: 'إرسال رمز إعادة تعيين لـ {email}؟', resetB: 'هو بيختار كلمة السر الجديدة بنفسه باستخدام الرمز.', resetOk: 'ابعت الرمز',
      twofaT: 'إلغاء التحقق بخطوتين لـ {name}؟', twofaB: 'اعملها بس بعد ما تتأكد مين اللي بتحكي معه.', twofaOk: 'إلغاء التحقق',
      deleteT: 'حذف حساب {name}؟', deleteB: 'بيانات الشخص بتنمسح وما بيقدر يدخل بعدها. السجلات المالية بتضل للتدقيق. ما في تراجع.', deleteOk: 'احذف الحساب',
      removeAdminT: 'سحب صلاحيات الإدارة من {name}؟', removeAdminB: 'بيضل حسابه كمستخدم عادي وبيخسر صلاحيات الإدارة فورًا.', removeAdminOk: 'اسحب الصلاحيات',
      saveT: 'حفظ تعديلات {name}؟', saveB: 'إذا غيّرت الإيميل، رح يوصل تنبيه للإيميل القديم.', saveOk: 'احفظ',
      broadcastT: 'إرسال الإعلان؟', broadcastB: 'كل اللي بالفئة المختارة رح يشوفوه بإشعاراتهم.', broadcastOk: 'ابعت للكل',
      grantT: 'منح صلاحيات إدارة لـ {email}؟', grantB: 'بياخد بالضبط الصلاحيات اللي حددتها، ولا إشي زيادة.', grantOk: 'امنح الصلاحيات',
      permsT: 'تحديث صلاحيات {name}؟', permsB: 'التغيير بيسري من أول صفحة بيفتحها.', permsOk: 'حدّث',
    },
    perm: {
      'customers.view': 'عرض العملاء وحساباتهم', 'customers.edit': 'تعديل الأسماء والإيميلات وأسماء المستخدمين والأرقام', 'customers.password': 'تعيين وإعادة تعيين كلمات المرور',
      'customers.status': 'إيقاف العملاء وإعادة تفعيلهم', 'customers.delete': 'إغلاق حسابات العملاء', 'customers.security': 'تسجيل خروج العملاء وإلغاء التحقق بخطوتين',
      'accounts.freeze': 'تجميد الحسابات', teller: 'شبّاك الصرّاف (إيداع وسحب نقدي)', 'ledger.view': 'عرض كل الحركات', notify: 'إرسال إشعارات وإعلانات',
      'exchange.view': 'عرض الصرّاف والاحتياطي', 'audit.view': 'قراءة سجل التدقيق', 'settings.manage': 'تغيير إعدادات البنك',
    },
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
      const q = new URLSearchParams(location.search).get('lang');
      if (q === 'ar' || q === 'en') {
        localStorage.setItem('tb.lang', q);
        return q;
      }
      const s = localStorage.getItem('tb.lang');
      if (s === 'en' || s === 'ar') return s;
    } catch {
      /* ignore */
    }
    return 'ar';
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
      err: (e: any) => {
        if (e?.code && t.errors[e.code]) return t.errors[e.code];
        // Validation errors: show the first field message, in Arabic when we have it.
        const msg = Array.isArray(e?.details) && e.details[0]?.message ? e.details[0].message : e?.message;
        return (lang === 'ar' && serverTextAr(msg)) || msg || t.errors.NETWORK;
      },
    };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
