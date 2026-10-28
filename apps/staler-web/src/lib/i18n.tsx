import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const en = {
  brand: { name: 'S-Taler', tagline: 'Your Palestinian wallet' },
  common: {
    continue: 'Continue', cancel: 'Cancel', back: 'Back', save: 'Save changes', saved: 'Saved', close: 'Close', confirm: 'Confirm',
    copy: 'Copy', copied: 'Copied', retry: 'Try again', loading: 'Loading…', search: 'Search', all: 'All', in: 'Received', out: 'Sent',
    empty: 'Nothing here yet', optional: 'optional', amount: 'Amount', note: 'Note', delete: 'Delete', edit: 'Edit', yes: 'Yes', no: 'No',
    status: 'Status', date: 'Date', more: 'Load more', done: 'Done', open: 'Open', share: 'Share', download: 'Download', refresh: 'Refresh',
    language: 'العربية', theme: 'Theme', signOut: 'Sign out', menu: 'Menu', you: 'You', details: 'Details', total: 'Total', or: 'or',
  },
  nav: {
    home: 'Home', activity: 'Activity', scan: 'Scan', store: 'Store', more: 'More', send: 'Send', receive: 'Receive', bank: 'Bank',
    messages: 'Messages', settings: 'Settings', orders: 'My orders', merchant: 'My store', products: 'Products', storeOrders: 'Store orders',
    vouchers: 'Cash vouchers', admin: 'Admin', users: 'Users', stores: 'Stores', pending: 'Pending sign-ups', bankOps: 'Bank operations',
    audit: 'Audit log', system: 'System settings', notifications: 'Notifications', overview: 'Overview',
  },
  landing: {
    title: 'Money that moves like a message.',
    lead: 'Send, receive and pay by QR in seconds. Top up from TalerBank, shop local stores, and keep every shekel protected by bank-grade security.',
    start: 'Open a free wallet', signIn: 'Sign in', browse: 'Browse the store',
    f1t: 'Pay with a glance', f1d: 'Scan a code and the payment is done. No card numbers, no waiting.',
    f2t: 'Linked to TalerBank', f2d: 'Move money between your bank and wallet without ever sharing your bank password.',
    f3t: 'Protected by design', f3d: 'Two-factor sign-in, encrypted messages and instant alerts on every movement.',
    f4t: 'Local marketplace', f4d: 'Buy from Palestinian stores. Your payment waits safely until your order arrives.',
    stat1: 'transfer fees between wallets', stat2: 'to send money', stat3: 'encryption on sensitive data',
  },
  auth: {
    welcome: 'Welcome back', loginLead: 'Sign in to your wallet.', email: 'E-mail', password: 'Password', newPassword: 'New password',
    login: 'Sign in', noAccount: 'New here?', createOne: 'Create a wallet', haveAccount: 'Already have a wallet?', forgot: 'Forgot password?',
    registerTitle: 'Create your wallet', registerLead: 'It takes less than a minute.', fullName: 'Full name', phone: 'Phone',
    accountType: 'Account type', personal: 'Personal', personalD: 'Send, receive and shop', business: 'Business', businessD: 'Sell in the S-Taler store',
    register: 'Create wallet', verifyTitle: 'Check your e-mail', verifyLead: 'We sent a 6-digit code to', verify: 'Verify e-mail', resend: 'Send a new code',
    resent: 'A new code is on its way', mfaTitle: 'Two-step verification', mfaLead: 'Enter the 6-digit code from your authenticator app, or a recovery code.',
    mfaCode: 'Authenticator code', resetTitle: 'Reset your password', resetLead: 'We will e-mail you a code to set a new password.', sendCode: 'Send code',
    resetDone: 'Password updated. Sign in with your new password.', setPassword: 'Set new password', code: 'Code',
    pwRules: 'At least 10 characters with upper and lower case, a digit and a symbol.', strength: ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent'],
    pending: 'Please verify your e-mail first.', terms: 'By creating a wallet you agree to keep your credentials private.',
    idle: 'You were signed out after a period of inactivity.',
  },
  home: {
    hello: 'Hello', balance: 'Available balance', walletId: 'Wallet ID', income: 'In · 30 days', spending: 'Out · 30 days',
    recent: 'Recent activity', seeAll: 'See all', quick: 'Quick actions', topUp: 'Top up', toBank: 'To bank', flow: 'Money flow · 30 days',
    noTx: 'No activity yet. Top up from your bank or share your QR to receive money.', frozen: 'This wallet is frozen. Contact support.',
    linkBank: 'Link your TalerBank account to top up instantly.', linkNow: 'Link bank',
  },
  tx: {
    types: {
      transfer_in: 'Received', transfer_out: 'Sent', payment: 'QR payment', payment_received: 'QR payment received', withdraw: 'Top-up from bank',
      deposit: 'Sent to bank', deposit_refund: 'Bank transfer refund', purchase: 'Store purchase', sale: 'Store sale', refund: 'Refund',
      exchange_deposit: 'Cash voucher', exchange_payout: 'Cash payout', voucher_issued: 'Voucher issued', voucher_refund: 'Voucher returned',
    } as Record<string, string>,
    statuses: { completed: 'Completed', pending: 'Processing', failed: 'Failed' } as Record<string, string>,
    filter: 'Filter', searchPh: 'Search name, wallet or note', reference: 'Reference', balanceAfter: 'Balance after', from: 'From', to: 'To',
  },
  send: {
    title: 'Send money', to: 'Recipient', toPh: 'Wallet ID or e-mail', check: 'Check recipient', found: 'Sending to', note: 'Add a note',
    review: 'Review transfer', send: 'Send', sent: 'Money sent', sentLead: 'is on its way to', another: 'Send again', limit: 'Max per transfer',
    scanInstead: 'Scan a QR instead',
  },
  receive: {
    title: 'Receive money', lead: 'Show this code. Anyone with S-Taler can scan it and pay you.', fixed: 'Ask for a specific amount',
    description: 'What is it for?', yourCode: 'Your payment code', save: 'Save image',
  },
  scan: {
    title: 'Scan a code', lead: 'Point your camera at an S-Taler, TalerBank or voucher QR code.', camera: 'Start camera', paste: 'Or paste a code',
    pastePh: 'taler://…', use: 'Use code', denied: 'Camera access was blocked. Allow it in your browser or phone settings, or paste the code.',
    unknown: 'This QR code is not supported by S-Taler.', payTitle: 'Confirm payment', payTo: 'Paying', voucherTitle: 'Claim cash voucher',
    voucherFrom: 'Voucher from', claim: 'Claim voucher', claimed: 'Voucher claimed', paid: 'Payment sent',
  },
  bank: {
    title: 'TalerBank', linkTitle: 'Link your bank account', linkLead: 'Link once, then top up or send money back to your bank in one tap.',
    viaCode: 'With a link code', viaCodeD: 'Recommended. Create a code in TalerBank → Linked apps. Your bank password never leaves the bank.',
    viaLogin: 'With bank sign-in', viaLoginD: 'Your credentials go straight to TalerBank once and are never stored here.',
    code: 'Link code', codePh: 'ABCD-EFGH', login: 'Bank e-mail or username', link: 'Link account', linked: 'Linked account',
    holder: 'Account holder', iban: 'IBAN', bankBalance: 'Bank balance', unlink: 'Unlink', unlinkConfirm: 'Unlink TalerBank? You can link again anytime.',
    topUp: 'Top up from bank', topUpLead: 'Moves money from your TalerBank account into this wallet.', toBank: 'Send to bank',
    toBankLead: 'Moves money from this wallet to your TalerBank account.', processing: 'The bank is processing this. Your balance will update automatically.',
    done: 'Done', openBank: 'Open TalerBank', qrTitle: 'Withdraw with a bank QR', qrLead: 'In TalerBank choose “Send to S-Taler”, then scan the QR it shows.',
    waiting: 'Waiting for you to confirm in TalerBank…', waitingLead: 'Open TalerBank and confirm the withdrawal. This page updates by itself.',
    credited: 'added to your wallet', aborted: 'The withdrawal was cancelled or expired.', operations: 'Recent bank operations',
    kinds: { link_withdraw: 'Top-up', qr_withdraw: 'QR top-up', deposit: 'To bank' } as Record<string, string>,
    opStatus: { pending: 'Processing', completed: 'Completed', failed: 'Failed', aborted: 'Cancelled' } as Record<string, string>,
    expires: 'Link valid until',
  },
  store: {
    title: 'Store', lead: 'Local shops, paid from your wallet.', search: 'Search products or stores', digital: 'Digital', physical: 'Delivered',
    inStock: 'in stock', soldOut: 'Sold out', add: 'Add to cart', cart: 'Cart', checkout: 'Pay now', emptyCart: 'Your cart is empty.',
    by: 'by', sort: { new: 'Newest', price_asc: 'Price: low to high', price_desc: 'Price: high to low', name: 'Name' } as Record<string, string>,
    paid: 'Order paid', paidLead: 'Physical items: the store is paid when you confirm delivery.', loginToBuy: 'Sign in to buy',
    escrow: 'Your payment is held safely until you confirm the order arrived.', qty: 'Qty', remove: 'Remove', noProducts: 'No products match.',
  },
  orders: {
    title: 'My orders', none: 'No orders yet.', confirm: 'I received it', cancel: 'Cancel order', download: 'Download',
    st: { pending: 'Pending', processing: 'Preparing', shipped: 'On the way', completed: 'Completed', cancelled: 'Cancelled' } as Record<string, string>,
    confirmQ: 'Release the payment to the store?', cancelQ: 'Cancel and get a full refund?',
  },
  merchant: {
    title: 'My store', setup: 'Set up your store', setupLead: 'Give your store a name to start selling.', storeName: 'Store name', description: 'Description',
    create: 'Create store', revenue: 'Revenue', escrow: 'In escrow', toShip: 'To ship', completed: 'Completed', sales: 'Sales · 14 days', top: 'Best sellers',
    products: 'Products', newProduct: 'New product', name: 'Name', price: 'Price', stock: 'Stock', category: 'Category', image: 'Image', digital: 'Digital product',
    file: 'File for buyers', uploadImage: 'Upload image', uploadFile: 'Upload file', hidden: 'Hidden', active: 'Visible', ship: 'Mark as shipped',
    cancelRefund: 'Cancel & refund', orders: 'Store orders', buyer: 'Buyer', noProducts: 'No products yet — add your first one.', deleteQ: 'Remove this product from the store?',
  },
  vouchers: {
    title: 'Cash vouchers', lead: 'Hand out cash value: the amount leaves your wallet now and the customer claims it by scanning.', create: 'Create voucher',
    active: 'Show to customer', expires: 'Expires', cancel: 'Cancel voucher', st: { active: 'Active', claimed: 'Claimed', cancelled: 'Cancelled', expired: 'Expired' } as Record<string, string>,
  },
  messages: {
    title: 'Messages', newChat: 'New conversation', support: 'Contact support', searchPeople: 'Search people by name', placeholder: 'Write a message',
    send: 'Send', none: 'No conversations yet.', closed: 'This conversation is closed.', closeChat: 'Close conversation', edited: 'edited', supportTitle: 'Support',
    pick: 'Choose a conversation',
  },
  settings: {
    title: 'Settings', profile: 'Profile', security: 'Security', fullName: 'Full name', phone: 'Phone', language: 'Language', appearance: 'Appearance',
    light: 'Light', dark: 'Dark', avatar: 'Photo', changePhoto: 'Change photo', removePhoto: 'Remove', email: 'E-mail', changeEmail: 'Change e-mail',
    newEmail: 'New e-mail', emailCode: 'Code sent to the new e-mail', password: 'Password', currentPassword: 'Current password', changePassword: 'Change password',
    pwChanged: 'Password changed. Other devices were signed out.', twofa: 'Two-step verification', twofaOn: 'On', twofaOff: 'Off',
    twofaLead: 'Protects sign-in and every money movement with a code from your phone.', enable: 'Turn on', disable: 'Turn off',
    scanApp: 'Scan with Google Authenticator, Authy or 1Password, then enter the code.', secretKey: 'Setup key', recovery: 'Recovery codes',
    recoveryLead: 'Save these somewhere safe. Each works once if you lose your phone.', sessions: 'Signed-in devices', thisDevice: 'This device',
    revoke: 'Sign out', signOutAll: 'Sign out everywhere', danger: 'Delete account', dangerLead: 'Your wallet must be empty and have no open orders.',
    deleteSend: 'Send confirmation code', deleteConfirm: 'Delete my account', lastUsed: 'Last active',
  },
  admin: {
    overview: 'Overview', users: 'Users', wallets: 'Money in wallets', tx24: 'Transactions · 24h', vol: 'Volume · 14 days', newUsers: 'New · 7 days',
    with2fa: 'With 2FA', bankOps: 'Bank operations', pendingOps: 'pending', failedOps: 'failed', reconcile: 'Proof of reserves', reconcileRun: 'Check pending now',
    exchangeAcc: 'Exchange account at TalerBank', walletsTotal: 'Wallets', vouchers: 'Vouchers in escrow', escrow: 'Orders in escrow', pendingDeposits: 'Pending deposits',
    role: 'Role', roles: { user: 'Personal', merchant: 'Business', exchange: 'Cash agent', admin: 'Admin' } as Record<string, string>, suspended: 'Suspended', active: 'Active',
    suspend: 'Suspend', activate: 'Reactivate', revokeSessions: 'Sign out all devices', reset2fa: 'Reset 2FA', sendReset: 'Send password reset', freeze: 'Freeze wallet',
    unfreeze: 'Unfreeze wallet', deleteUser: 'Delete user', createUser: 'Create user', adminLevel: 'Admin level', clearExpired: 'Clear expired', siteName: 'Site name',
    maintenance: 'Maintenance mode', maintenanceD: 'Pauses all money movements for users.', registrations: 'Allow new sign-ups', announcement: 'Announcement banner',
    action: 'Action', ip: 'IP', owner: 'Owner', products: 'Products', attempts: 'Attempts', expires: 'Expires', kind: 'Type', error: 'Error',
  },
  errors: {
    NETWORK: 'No connection. Check your internet and try again.', INSUFFICIENT_FUNDS: 'Not enough balance for this.', MFA_REQUIRED: 'Enter your authenticator code to continue.',
    MFA_INVALID: 'That authenticator code is not correct.', INVALID_CREDENTIALS: 'E-mail or password is not correct.', RATE_LIMITED: 'Too many tries. Wait a moment and try again.',
    ACCOUNT_TEMPORARILY_LOCKED: 'Too many failed attempts. Try again later or reset your password.', SESSION_EXPIRED: 'Your session ended. Please sign in again.',
    BANK_NOT_LINKED: 'Link your TalerBank account first.', BANK_UNAVAILABLE: 'TalerBank is not reachable right now. Try again in a moment.',
    MAINTENANCE: 'S-Taler is under maintenance. Please try again soon.', DAILY_LIMIT: 'You reached today’s limit.',
  } as Record<string, string>,
};

type Dict = typeof en;

const ar: Dict = {
  brand: { name: 'S-Taler', tagline: 'محفظتك الفلسطينية' },
  common: {
    continue: 'متابعة', cancel: 'إلغاء', back: 'رجوع', save: 'حفظ التغييرات', saved: 'تم الحفظ', close: 'إغلاق', confirm: 'تأكيد', copy: 'نسخ', copied: 'تم النسخ',
    retry: 'حاول مجددًا', loading: 'جارٍ التحميل…', search: 'بحث', all: 'الكل', in: 'وارد', out: 'صادر', empty: 'لا شيء هنا بعد', optional: 'اختياري', amount: 'المبلغ',
    note: 'ملاحظة', delete: 'حذف', edit: 'تعديل', yes: 'نعم', no: 'لا', status: 'الحالة', date: 'التاريخ', more: 'عرض المزيد', done: 'تم', open: 'فتح', share: 'مشاركة',
    download: 'تنزيل', refresh: 'تحديث', language: 'English', theme: 'المظهر', signOut: 'تسجيل الخروج', menu: 'القائمة', you: 'أنت', details: 'التفاصيل', total: 'المجموع', or: 'أو',
  },
  nav: {
    home: 'الرئيسية', activity: 'الحركات', scan: 'مسح', store: 'المتجر', more: 'المزيد', send: 'تحويل', receive: 'استلام', bank: 'البنك', messages: 'الرسائل',
    settings: 'الإعدادات', orders: 'طلباتي', merchant: 'متجري', products: 'المنتجات', storeOrders: 'طلبات المتجر', vouchers: 'قسائم نقدية', admin: 'الإدارة',
    users: 'المستخدمون', stores: 'المتاجر', pending: 'تسجيلات معلّقة', bankOps: 'عمليات البنك', audit: 'سجل التدقيق', system: 'إعدادات النظام',
    notifications: 'الإشعارات', overview: 'نظرة عامة',
  },
  landing: {
    title: 'مصاري بتتحرك متل الرسالة.',
    lead: 'حوّل واستلم وادفع بالـ QR بثواني. اشحن محفظتك من TalerBank، تسوّق من متاجر محلية، وكل شيكل محمي بأمان بمستوى البنوك.',
    start: 'افتح محفظة مجانًا', signIn: 'تسجيل الدخول', browse: 'تصفّح المتجر',
    f1t: 'ادفع بنظرة', f1d: 'امسح الكود وخلصت الدفعة. لا أرقام بطاقات ولا انتظار.',
    f2t: 'مربوطة بـ TalerBank', f2d: 'انقل المصاري بين بنكك ومحفظتك بدون ما تشارك كلمة سر البنك أبدًا.',
    f3t: 'محمية من الأساس', f3d: 'تحقق بخطوتين، رسائل مشفّرة، وتنبيه فوري مع كل حركة.',
    f4t: 'سوق محلي', f4d: 'اشترِ من متاجر فلسطينية. دفعتك بتستنى بأمان لحتى يوصلك طلبك.',
    stat1: 'رسوم التحويل بين المحافظ', stat2: 'لتحويل المصاري', stat3: 'تشفير للبيانات الحساسة',
  },
  auth: {
    welcome: 'أهلًا من جديد', loginLead: 'سجّل دخولك لمحفظتك.', email: 'البريد الإلكتروني', password: 'كلمة المرور', newPassword: 'كلمة مرور جديدة', login: 'دخول',
    noAccount: 'جديد هون؟', createOne: 'افتح محفظة', haveAccount: 'عندك محفظة؟', forgot: 'نسيت كلمة المرور؟', registerTitle: 'افتح محفظتك', registerLead: 'بتاخد أقل من دقيقة.',
    fullName: 'الاسم الكامل', phone: 'رقم الهاتف', accountType: 'نوع الحساب', personal: 'شخصي', personalD: 'حوّل واستلم وتسوّق', business: 'تجاري', businessD: 'بيع في متجر S-Taler',
    register: 'إنشاء المحفظة', verifyTitle: 'افحص بريدك', verifyLead: 'بعتنا رمز من 6 أرقام إلى', verify: 'تأكيد البريد', resend: 'أرسل رمزًا جديدًا', resent: 'الرمز الجديد بالطريق',
    mfaTitle: 'التحقق بخطوتين', mfaLead: 'أدخل الرمز من تطبيق المصادقة، أو أحد رموز الاسترداد.', mfaCode: 'رمز المصادقة', resetTitle: 'إعادة تعيين كلمة المرور',
    resetLead: 'رح نبعتلك رمز لتعيين كلمة مرور جديدة.', sendCode: 'أرسل الرمز', resetDone: 'تم تحديث كلمة المرور. سجّل دخولك بالكلمة الجديدة.', setPassword: 'تعيين كلمة المرور', code: 'الرمز',
    pwRules: '10 أحرف على الأقل، فيها حرف كبير وصغير ورقم ورمز.', strength: ['ضعيفة جدًا', 'ضعيفة', 'مقبولة', 'قوية', 'ممتازة'], pending: 'لازم تأكّد بريدك أولًا.',
    terms: 'بإنشاء المحفظة بتلتزم تحافظ على سرية بيانات دخولك.', idle: 'تم تسجيل خروجك بعد فترة من عدم النشاط.',
  },
  home: {
    hello: 'مرحبا', balance: 'الرصيد المتاح', walletId: 'رقم المحفظة', income: 'وارد · 30 يوم', spending: 'صادر · 30 يوم', recent: 'آخر الحركات', seeAll: 'عرض الكل',
    quick: 'إجراءات سريعة', topUp: 'شحن', toBank: 'للبنك', flow: 'حركة المال · 30 يوم', noTx: 'ما في حركات بعد. اشحن من بنكك أو شارك الـ QR تبعك لتستلم.',
    frozen: 'هاي المحفظة مجمّدة. تواصل مع الدعم.', linkBank: 'اربط حسابك في TalerBank لتشحن فورًا.', linkNow: 'اربط البنك',
  },
  tx: {
    types: {
      transfer_in: 'وارد', transfer_out: 'تحويل صادر', payment: 'دفع QR', payment_received: 'دفعة QR واردة', withdraw: 'شحن من البنك', deposit: 'تحويل للبنك',
      deposit_refund: 'استرجاع تحويل بنكي', purchase: 'شراء من المتجر', sale: 'مبيعات المتجر', refund: 'استرجاع', exchange_deposit: 'قسيمة نقدية', exchange_payout: 'صرف نقدي',
      voucher_issued: 'إصدار قسيمة', voucher_refund: 'إرجاع قسيمة',
    },
    statuses: { completed: 'مكتملة', pending: 'قيد المعالجة', failed: 'فشلت' },
    filter: 'تصفية', searchPh: 'ابحث بالاسم أو المحفظة أو الملاحظة', reference: 'المرجع', balanceAfter: 'الرصيد بعدها', from: 'من', to: 'إلى',
  },
  send: {
    title: 'تحويل مصاري', to: 'المستلم', toPh: 'رقم المحفظة أو البريد', check: 'تحقق من المستلم', found: 'التحويل إلى', note: 'أضف ملاحظة', review: 'مراجعة التحويل',
    send: 'حوّل', sent: 'تم التحويل', sentLead: 'بالطريق إلى', another: 'تحويل جديد', limit: 'الحد للتحويل الواحد', scanInstead: 'امسح QR بدلًا من ذلك',
  },
  receive: {
    title: 'استلام مصاري', lead: 'اعرض هذا الكود. أي حدا عنده S-Taler بيقدر يمسحه ويدفعلك.', fixed: 'اطلب مبلغًا محددًا', description: 'شو الغرض؟',
    yourCode: 'كود الدفع تبعك', save: 'حفظ الصورة',
  },
  scan: {
    title: 'امسح كود', lead: 'وجّه الكاميرا على كود S-Taler أو TalerBank أو قسيمة نقدية.', camera: 'تشغيل الكاميرا', paste: 'أو الصق الكود', pastePh: 'taler://…',
    use: 'استخدم الكود', denied: 'تم منع الوصول للكاميرا. اسمح فيه من إعدادات المتصفح أو الجوال، أو الصق الكود.', unknown: 'هذا الكود غير مدعوم في S-Taler.',
    payTitle: 'تأكيد الدفع', payTo: 'الدفع إلى', voucherTitle: 'استلام قسيمة نقدية', voucherFrom: 'قسيمة من', claim: 'استلم القسيمة', claimed: 'تم استلام القسيمة', paid: 'تم الدفع',
  },
  bank: {
    title: 'TalerBank', linkTitle: 'اربط حسابك البنكي', linkLead: 'اربط مرة وحدة، وبعدها اشحن أو رجّع المصاري لبنكك بضغطة.',
    viaCode: 'برمز ربط', viaCodeD: 'الطريقة الموصى بها. أنشئ رمزًا من TalerBank ← التطبيقات المرتبطة. كلمة سر البنك ما بتطلع من البنك أبدًا.',
    viaLogin: 'بتسجيل دخول البنك', viaLoginD: 'بياناتك بتروح مباشرة لـ TalerBank مرة وحدة وما بتنحفظ هون.', code: 'رمز الربط', codePh: 'ABCD-EFGH',
    login: 'بريد البنك أو اسم المستخدم', link: 'ربط الحساب', linked: 'الحساب المربوط', holder: 'صاحب الحساب', iban: 'IBAN', bankBalance: 'رصيد البنك', unlink: 'فك الربط',
    unlinkConfirm: 'فك ربط TalerBank؟ بتقدر تربطه من جديد بأي وقت.', topUp: 'شحن من البنك', topUpLead: 'بينقل مصاري من حسابك في TalerBank لهاي المحفظة.',
    toBank: 'تحويل للبنك', toBankLead: 'بينقل مصاري من هاي المحفظة لحسابك في TalerBank.', processing: 'البنك بعالج العملية. رصيدك رح يتحدّث تلقائيًا.', done: 'تم',
    openBank: 'افتح TalerBank', qrTitle: 'سحب بكود البنك', qrLead: 'من TalerBank اختار «إرسال إلى S-Taler»، وامسح الكود اللي بيظهر.',
    waiting: 'بنستنى تأكيدك في TalerBank…', waitingLead: 'افتح TalerBank وأكّد السحب. هاي الصفحة بتتحدّث لحالها.', credited: 'انضافت لمحفظتك',
    aborted: 'تم إلغاء السحب أو انتهت صلاحيته.', operations: 'آخر العمليات البنكية', kinds: { link_withdraw: 'شحن', qr_withdraw: 'شحن بالـ QR', deposit: 'للبنك' },
    opStatus: { pending: 'قيد المعالجة', completed: 'مكتملة', failed: 'فشلت', aborted: 'ملغاة' }, expires: 'الربط صالح حتى',
  },
  store: {
    title: 'المتجر', lead: 'متاجر محلية، والدفع من محفظتك.', search: 'ابحث عن منتج أو متجر', digital: 'رقمي', physical: 'توصيل', inStock: 'متوفر', soldOut: 'نفدت الكمية',
    add: 'أضف للسلة', cart: 'السلة', checkout: 'ادفع الآن', emptyCart: 'سلتك فاضية.', by: 'من',
    sort: { new: 'الأحدث', price_asc: 'السعر: من الأقل', price_desc: 'السعر: من الأعلى', name: 'الاسم' }, paid: 'تم دفع الطلب',
    paidLead: 'المنتجات المادية: المتجر بيستلم المبلغ لما تأكد وصول طلبك.', loginToBuy: 'سجّل دخولك لتشتري', escrow: 'دفعتك محفوظة بأمان لحتى تأكد إنه طلبك وصل.',
    qty: 'الكمية', remove: 'إزالة', noProducts: 'ما في منتجات مطابقة.',
  },
  orders: {
    title: 'طلباتي', none: 'ما في طلبات بعد.', confirm: 'استلمت الطلب', cancel: 'إلغاء الطلب', download: 'تنزيل',
    st: { pending: 'معلّق', processing: 'قيد التجهيز', shipped: 'بالطريق', completed: 'مكتمل', cancelled: 'ملغى' }, confirmQ: 'تحويل المبلغ للمتجر؟', cancelQ: 'إلغاء الطلب واسترجاع كامل المبلغ؟',
  },
  merchant: {
    title: 'متجري', setup: 'جهّز متجرك', setupLead: 'اختار اسم لمتجرك لتبدأ البيع.', storeName: 'اسم المتجر', description: 'الوصف', create: 'إنشاء المتجر', revenue: 'الإيرادات',
    escrow: 'محجوز للضمان', toShip: 'بانتظار الشحن', completed: 'مكتملة', sales: 'المبيعات · 14 يوم', top: 'الأكثر مبيعًا', products: 'المنتجات', newProduct: 'منتج جديد',
    name: 'الاسم', price: 'السعر', stock: 'الكمية', category: 'الفئة', image: 'الصورة', digital: 'منتج رقمي', file: 'الملف للمشترين', uploadImage: 'رفع صورة', uploadFile: 'رفع ملف',
    hidden: 'مخفي', active: 'ظاهر', ship: 'تم الشحن', cancelRefund: 'إلغاء واسترجاع', orders: 'طلبات المتجر', buyer: 'المشتري', noProducts: 'ما في منتجات بعد — أضف أول منتج.',
    deleteQ: 'إزالة المنتج من المتجر؟',
  },
  vouchers: {
    title: 'قسائم نقدية', lead: 'سلّم قيمة نقدية: المبلغ بينخصم من محفظتك هلّق، والزبون بيستلمه بمسح الكود.', create: 'إنشاء قسيمة', active: 'اعرضها للزبون',
    expires: 'تنتهي', cancel: 'إلغاء القسيمة', st: { active: 'فعّالة', claimed: 'مستلمة', cancelled: 'ملغاة', expired: 'منتهية' },
  },
  messages: {
    title: 'الرسائل', newChat: 'محادثة جديدة', support: 'تواصل مع الدعم', searchPeople: 'ابحث عن أشخاص بالاسم', placeholder: 'اكتب رسالة', send: 'إرسال',
    none: 'ما في محادثات بعد.', closed: 'هاي المحادثة مغلقة.', closeChat: 'إغلاق المحادثة', edited: 'معدّلة', supportTitle: 'الدعم', pick: 'اختار محادثة',
  },
  settings: {
    title: 'الإعدادات', profile: 'الملف الشخصي', security: 'الأمان', fullName: 'الاسم الكامل', phone: 'رقم الهاتف', language: 'اللغة', appearance: 'المظهر', light: 'فاتح',
    dark: 'داكن', avatar: 'الصورة', changePhoto: 'تغيير الصورة', removePhoto: 'إزالة', email: 'البريد الإلكتروني', changeEmail: 'تغيير البريد', newEmail: 'البريد الجديد',
    emailCode: 'الرمز المرسل للبريد الجديد', password: 'كلمة المرور', currentPassword: 'كلمة المرور الحالية', changePassword: 'تغيير كلمة المرور',
    pwChanged: 'تم تغيير كلمة المرور وتسجيل خروج الأجهزة الأخرى.', twofa: 'التحقق بخطوتين', twofaOn: 'مفعّل', twofaOff: 'غير مفعّل',
    twofaLead: 'بيحمي تسجيل الدخول وكل حركة مصاري برمز من جوالك.', enable: 'تفعيل', disable: 'إيقاف',
    scanApp: 'امسح بـ Google Authenticator أو Authy أو 1Password، وبعدين أدخل الرمز.', secretKey: 'مفتاح الإعداد', recovery: 'رموز الاسترداد',
    recoveryLead: 'احفظها بمكان آمن. كل رمز بيشتغل مرة وحدة إذا ضاع جوالك.', sessions: 'الأجهزة المسجّلة', thisDevice: 'هذا الجهاز', revoke: 'تسجيل خروج',
    signOutAll: 'تسجيل الخروج من كل الأجهزة', danger: 'حذف الحساب', dangerLead: 'لازم تكون محفظتك فاضية وما في طلبات مفتوحة.', deleteSend: 'أرسل رمز التأكيد',
    deleteConfirm: 'احذف حسابي', lastUsed: 'آخر نشاط',
  },
  admin: {
    overview: 'نظرة عامة', users: 'المستخدمون', wallets: 'المال في المحافظ', tx24: 'الحركات · 24 ساعة', vol: 'الحجم · 14 يوم', newUsers: 'جدد · 7 أيام', with2fa: 'مع التحقق بخطوتين',
    bankOps: 'عمليات البنك', pendingOps: 'معلّقة', failedOps: 'فاشلة', reconcile: 'إثبات الاحتياطي', reconcileRun: 'افحص المعلّق الآن', exchangeAcc: 'حساب الصرّاف في TalerBank',
    walletsTotal: 'المحافظ', vouchers: 'قسائم محجوزة', escrow: 'طلبات محجوزة', pendingDeposits: 'تحويلات للبنك قيد المعالجة', role: 'الدور',
    roles: { user: 'شخصي', merchant: 'تجاري', exchange: 'وكيل صرف', admin: 'مدير' }, suspended: 'موقوف', active: 'نشط', suspend: 'إيقاف', activate: 'إعادة تفعيل',
    revokeSessions: 'تسجيل خروج كل الأجهزة', reset2fa: 'إعادة ضبط التحقق بخطوتين', sendReset: 'إرسال إعادة تعيين كلمة المرور', freeze: 'تجميد المحفظة', unfreeze: 'فك التجميد',
    deleteUser: 'حذف المستخدم', createUser: 'إنشاء مستخدم', adminLevel: 'مستوى الإدارة', clearExpired: 'حذف المنتهية', siteName: 'اسم الموقع', maintenance: 'وضع الصيانة',
    maintenanceD: 'بيوقف كل حركات المال للمستخدمين.', registrations: 'السماح بالتسجيل', announcement: 'شريط الإعلان', action: 'الإجراء', ip: 'IP', owner: 'المالك',
    products: 'المنتجات', attempts: 'المحاولات', expires: 'ينتهي', kind: 'النوع', error: 'الخطأ',
  },
  errors: {
    NETWORK: 'ما في اتصال. افحص الإنترنت وحاول مجددًا.', INSUFFICIENT_FUNDS: 'رصيدك ما بكفي لهاي العملية.', MFA_REQUIRED: 'أدخل رمز المصادقة للمتابعة.',
    MFA_INVALID: 'رمز المصادقة غير صحيح.', INVALID_CREDENTIALS: 'البريد أو كلمة المرور غير صحيحة.', RATE_LIMITED: 'محاولات كثيرة. استنى شوي وحاول مجددًا.',
    ACCOUNT_TEMPORARILY_LOCKED: 'محاولات فاشلة كثيرة. حاول لاحقًا أو أعد تعيين كلمة المرور.', SESSION_EXPIRED: 'انتهت جلستك. سجّل دخولك من جديد.',
    BANK_NOT_LINKED: 'اربط حسابك في TalerBank أولًا.', BANK_UNAVAILABLE: 'TalerBank غير متاح حاليًا. حاول بعد شوي.', MAINTENANCE: 'S-Taler تحت الصيانة. حاول قريبًا.',
    DAILY_LIMIT: 'وصلت للحد اليومي.',
  },
};

export type Lang = 'en' | 'ar';
interface I18n {
  lang: Lang;
  t: Dict;
  dir: 'rtl' | 'ltr';
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** Human message for an API error: localized by code when we have one, server text otherwise. */
  err: (e: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (read('st.lang') as Lang) ?? (navigator.language?.startsWith('en') ? 'en' : 'ar'));
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('st.lang', l);
    } catch {
      /* private mode */
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

export const dictionaries = { en, ar };
