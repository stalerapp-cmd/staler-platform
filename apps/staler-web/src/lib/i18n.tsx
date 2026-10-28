import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const en = {
  brand: { name: 'S-Taler', tagline: 'Your Palestinian wallet' },
  disp: { title: 'Disputes', none: 'No disputes. Everyone’s happy.', buyer: 'Buyer', store: 'Store', reason: 'Reason', release: 'Pay the store', refund: 'Refund the buyer', note: 'Decision note (both sides see it)', releaseQ: 'Pay the store?', refundQ: 'Refund the buyer?', decideB: 'This settles the order for good.', resolved: 'Resolved', open: 'Open' },
  shop: {
    storesTitle: 'Stores', storesLead: 'Real shops from around Palestine — every payment held safely until your order arrives.',
    searchStores: 'Search stores, owners or cities', allStores: 'All stores', products: 'products', branches: 'branches', by: 'by',
    cat: { food: 'Food', fashion: 'Fashion', electronics: 'Electronics', books: 'Books', beauty: 'Beauty', home: 'Home', crafts: 'Crafts', digital: 'Digital', services: 'Services', other: 'Other' } as Record<string, string>,
    visit: 'Visit store', share: 'Share', shareStore: 'Share this store', shareProduct: 'Share this product', copy: 'Copy link', copied: 'Link copied',
    sendToContact: 'Send to someone on S-Taler', sent: 'Sent', shareText: 'Have a look at {name} on S-Taler',
    call: 'Call', whatsapp: 'WhatsApp', owner: 'Owner', allBranches: 'All branches', branch: 'Branch', mainBranch: 'Main store', noStores: 'No stores here yet.',
    storeNotFound: 'This store doesn’t exist or is closed.', back: 'Back', explore: 'Explore S-Taler', yourOrders: 'Your orders here',
    deposit: 'Deposit {p}%', depositLong: 'Pay {amount} now as a deposit, the rest ({rest}) on delivery or at pickup.',
    depositNonRefundable: 'The deposit isn’t refundable once the store accepts the order.', fewLeft: 'Only {n} left', save: 'Save {p}%',
    viewOnly: 'Read in the app', downloadable: 'Download', digitalProtected: 'Your copy is personalised with your account and protected.',
    removeQ: 'Remove from cart?', removeB: '{name} will be taken out of your cart.', removeOk: 'Remove', clearCart: 'Empty cart', clearQ: 'Empty your cart?', clearB: 'All items will be removed.', clearOk: 'Empty cart',
    howGet: 'How do you want it?', delivery: 'Delivery', pickup: 'Pick up from store', address: 'Delivery address', addressPh: 'City, street, building — a landmark helps',
    phone: 'Phone for the courier', note: 'Note for the store (optional)', useLocation: 'Use my location', located: 'Location added', locating: 'Locating…',
    payNow: 'Pay now', laterBalance: 'Pay later', totalLater: 'Rest on delivery',
    ads: 'Offers',
  },
  ord: {
    timeline: 'Tracking', handover: 'Handover code', handoverLead: 'Give this code to the courier (or at the store) only when you have your order in hand. It releases the payment.',
    payBalance: 'Pay the rest {amount}', balanceDue: 'Left to pay', paidSoFar: 'Paid', dispute: 'Report a problem', disputeLead: 'Tell us what happened. The payment stays frozen until support resolves it.',
    disputeReason: 'What went wrong?', disputeSend: 'Send report', disputed: 'Under review', open: 'Open', downloadsLeft: '{n} downloads left', reader: 'Reader',
    pickupAt: 'Pick up at', deliverTo: 'Deliver to', map: 'Map', storePin: 'Store', youPin: 'You', lastSeen: 'Last update',
    ev: { placed: 'Order placed', accepted: 'Store accepted', shipped: 'Shipped', ready_for_pickup: 'Ready for pickup', location: 'Location update', note: 'Store note', out_for_delivery: 'Out for delivery', balance_paid: 'Balance paid', delivered: 'Delivered', confirmed: 'You confirmed receipt', released: 'Store paid', cancelled: 'Cancelled', disputed: 'Problem reported', resolved: 'Resolved by support' } as Record<string, string>,
    st: { processing: 'Preparing', shipped: 'On the way', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled', pending: 'Pending' } as Record<string, string>,
    confirmQ: 'Did you get everything?', confirmB: 'The store gets paid {amount} now. Only confirm once the order is in your hands.', confirmOk: 'Yes, I received it',
    cancelQ: 'Cancel this order?', cancelB: 'Your money comes back to your wallet straight away.', cancelBKeep: 'The store already accepted: the non-refundable deposit stays with the store, the rest comes back.', cancelOk: 'Cancel order',
    payQ: 'Pay the rest now?', payB: '{amount} leaves your wallet and is held until delivery.', payOk: 'Pay {amount}',
    protect: 'Protected by S-Taler: the store only gets paid after delivery.',
  },
  mstore: {
    stores: 'Stores & branches', newStore: 'New store', newBranch: 'New branch', branchName: 'Branch name', branchOf: 'Branch of', current: 'Working in',
    switch: 'Switch store', editStore: 'Store details', logo: 'Logo', cover: 'Cover', city: 'City', address: 'Address', storePhone: 'Store phone', showPhone: 'Show phone on the store page',
    accent: 'Store colour', pickupOn: 'Customers can pick up', deliveryOn: 'We deliver', deliveryNote: 'Delivery note', category: 'Category', pin: 'Store location', pinHint: 'Tap the map to place your store.',
    closeStore: 'Close store', closeQ: 'Close {name}?', closeB: 'It disappears from the directory with its branches. Open orders must be finished first.', closeOk: 'Close store',
    ads: 'Ads', newAd: 'New ad', adMedia: 'Image or video', adTitle: 'Headline', adBody: 'Short text', adProduct: 'Link to a product (optional)', adActive: 'Showing', adDeleteQ: 'Delete this ad?', adDeleteOk: 'Delete ad',
    deposit: 'Deposit (عربون)', depositPct: 'Deposit %', depositHelp: '0 = full payment. Otherwise the buyer pays this share now and the rest on delivery or pickup.', depositRefundable: 'Refund the deposit if the buyer cancels',
    compareAt: 'Was (optional)', digitalMode: 'How buyers get the file', modeDownload: 'Personalised download', modeView: 'Read in the app only', downloadLimit: 'Download limit',
    stampNote: 'PDFs are stamped with each buyer’s e-mail and licence code on every page.',
    accept: 'Accept order', ship: 'Mark as shipped', readyPickup: 'Ready for pickup', track: 'Update tracking', sendLocation: 'Send my location', outForDelivery: 'Out for delivery', addNote: 'Add a note',
    deliver: 'Hand over', deliverLead: 'Ask the buyer for their 6-digit handover code. It proves they received the order and pays you instantly.',
    code: 'Handover code', cashBalance: 'I collected the balance {amount} in cash', deliverOk: 'Confirm handover', allStores: 'All my stores',
    licence: 'Find a leaked copy', licenceLead: 'Enter the licence code printed on a shared file to see who bought it.', licenceFind: 'Look up',
    buyerOwes: 'Buyer still owes', disputeOpen: 'Problem reported — support will contact you', acceptQ: 'Accept this order?', acceptB: 'The buyer will be told you’re preparing it.',
  },
  bio: { unlockTitle: 'Unlock', unlockReason: 'Confirm it’s you', unlock: 'Unlock with fingerprint', usePassword: 'Sign in with password instead', lockedLead: 'Locked to keep your money safe.', enableTitle: 'Open with your fingerprint?', enableLead: 'Next time, unlock with your fingerprint or phone PIN instead of typing your password. You can turn this off in Settings.', enable: 'Turn on', notNow: 'Not now', enabled: 'Fingerprint unlock is on', toggle: 'Unlock with fingerprint', toggleD: 'Use your fingerprint, face or phone PIN instead of your password on this phone.' },
  account: { user: 'Personal account', merchant: 'Business account', exchange: 'Cash agent', admin: 'Admin', super: 'Super admin' } as Record<string, string>,
  dl: {
    title: 'Take it with you.', lead: 'Our Android apps, always the newest version — straight from here, no store needed.',
    wallet: 'Wallet', bank: 'Bank', walletD: 'Send, receive and pay by QR from your pocket.', bankD: 'Your account, transfers and statements in one tap.',
    download: 'Download APK', updated: 'Updated',
    android: 'First install? Android will ask you to allow installs from your browser — that’s expected.',
    iphone: 'On iPhone? Open the site in Safari, tap Share, then “Add to Home Screen”. It works just like an app.',
  },
  foot: { store: 'Store', open: 'Open a wallet', bank: 'TalerBank', wallet: 'S-Taler', about: 'A Palestinian wallet and bank that work as one.', aboutBank: 'Digital banking that works hand in hand with the S-Taler wallet.', privacy: 'Your data stays encrypted, always.' },
  common: {
    continue: 'Continue', cancel: 'Cancel', areYouSure: 'Are you sure you want to continue?', back: 'Back', save: 'Save changes', saved: 'Saved', close: 'Close', confirm: 'Confirm',
    copy: 'Copy', copied: 'Copied', retry: 'Try again', loading: 'Loading…', search: 'Search', all: 'All', in: 'Received', out: 'Sent',
    empty: 'Nothing here yet', optional: 'optional', amount: 'Amount', note: 'Note', delete: 'Delete', edit: 'Edit', yes: 'Yes', no: 'No',
    status: 'Status', date: 'Date', more: 'Load more', done: 'Done', open: 'Open', share: 'Share', download: 'Download', refresh: 'Refresh',
    language: 'العربية', theme: 'Theme', signOut: 'Sign out', menu: 'Menu', you: 'You', details: 'Details', total: 'Total', or: 'or',
  },
  nav: {
    help: 'How it works', contacts: 'Contacts', disputes: 'Disputes', myStores: 'Stores & branches', ads: 'Ads', cash: 'Cash vouchers',
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
    or: 'or', viaEmail: 'E-mail', viaSms: 'SMS', sendVia: 'Send my code by', smsNeedsPhone: 'Add your phone number to get the code by SMS.', verifyLeadSms: 'We sent a 6-digit code by SMS to',
    resendIn: 'Send a new code in', noMailTitle: 'No code yet?', noMail1: 'Check Spam, Promotions and Updates — first e-mails often land there.', noMail2: 'It can take up to a minute to arrive.', noMail3: 'Typo in the address?', changeEmail: 'Change e-mail', reviewTitle: 'Is this e-mail right?', reviewBody: 'We’ll send your 6-digit code to {email}. Make sure it’s an inbox you can open now.', reviewOk: 'Yes, send the code',
    confirmPassword: 'Confirm password', mismatch: 'The two passwords don’t match.',
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
    title: 'Store', lead: 'Local shops, paid from your wallet.', search: 'Search products or stores', digital: 'Digital', physical: 'Delivered', sortBy: 'Sort by',
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
    pick: 'Choose a conversation', searchPeopleAny: 'Name, e-mail or wallet ID', reply: 'Reply', edit: 'Edit', delete: 'Delete', copy: 'Copy', deleted: 'Message deleted',
    deleteQ: 'Delete this message?', deleteB: 'It will be removed for everyone in the chat.', deleteOk: 'Delete', editing: 'Editing message', replyingTo: 'Replying to',
    today: 'Today', yesterday: 'Yesterday', emoji: 'Emoji', openLink: 'Open', saveContact: 'Save to contacts', saved: 'Saved to contacts', contacts: 'Your contacts', everyone: 'People on S-Taler',
    editWindow: 'You can edit for 15 minutes after sending.',
  },
  contacts: {
    title: 'Contacts', lead: 'The people you pay and message most — named your way.', add: 'Add contact', search: 'Search contacts', none: 'No contacts yet. Save people from chats or after sending money.',
    nickname: 'Name it your way', who: 'E-mail or wallet ID', pay: 'Send money', message: 'Message', remove: 'Remove', removeQ: 'Remove {name} from contacts?', removeB: 'You can add them again any time.',
    favourite: 'Favourite', rename: 'Rename', found: 'Saved',
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
  ask: {
    buyTitle: 'Confirm your order', buyBody: 'You are paying {total} from your wallet for {count} item(s). Physical orders stay protected until you confirm delivery.', buyOk: 'Pay {total}',
    topupTitle: 'Top up from TalerBank', topupBody: '{amount} will move from your linked bank account into your wallet.', topupOk: 'Top up {amount}',
    toBankTitle: 'Send to your bank', toBankBody: '{amount} will leave your wallet and arrive in your TalerBank account.', toBankOk: 'Send {amount}',
    voucherCancelTitle: 'Cancel this voucher?', voucherCancelBody: 'Its {amount} goes back to your wallet and the code stops working.', voucherCancelOk: 'Cancel voucher',
    photoTitle: 'Remove your photo?', photoBody: 'Your initials will show instead.', photoOk: 'Remove photo',
    allOutTitle: 'Sign out on every device?', allOutBody: 'Every phone and browser — including this one — will need to sign in again.', allOutOk: 'Sign out everywhere',
    deviceTitle: 'Sign this device out?', deviceBody: 'That device will need your password to get back in.', deviceOk: 'Sign it out',
    signOutTitle: 'Sign out?', signOutBody: 'You can sign back in anytime.', signOutOk: 'Sign out',
    closeChatTitle: 'Close this conversation?', closeChatBody: 'You can still read it, but no one can reply anymore.', closeChatOk: 'Close conversation',
    shipTitle: 'Mark as shipped?', shipBody: 'The buyer is notified and can confirm delivery to release your payment.', shipOk: 'Mark shipped',
    merchCancelTitle: 'Cancel this order?', merchCancelBody: 'The buyer gets a full refund and the stock is restored.', merchCancelOk: 'Cancel order',
    claimTitle: 'Redeem this voucher?', claimBody: '{amount} will be added to your wallet.', claimOk: 'Redeem {amount}',
    saveTitle: 'Save these settings?', saveBody: 'Changes apply to everyone right away.', saveOk: 'Save',
  },
  people: {
    edit: 'Edit details', phone: 'Phone', language: 'Language', save: 'Save details', saved: 'Details saved',
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
      'orders.disputes': 'Settle order disputes',
      'users.view': 'See users and their activity', 'users.edit': 'Edit names, e-mails and phones', 'users.password': 'Set or reset passwords',
      'users.status': 'Suspend and reactivate accounts', 'users.delete': 'Delete accounts', 'users.security': 'Sign users out, reset 2FA',
      'users.role': 'Change the account type', 'wallets.freeze': 'Freeze wallets', 'stores.manage': 'Manage stores', 'pending.manage': 'Manage unfinished sign-ups',
      notify: 'Send notifications and announcements', support: 'Answer support chats', 'bank.ops': 'Bank operations & proof of reserves', 'audit.view': 'Read the audit log',
      'settings.manage': 'Change system settings',
    } as Record<string, string>,
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
  disp: { title: 'النزاعات', none: 'ما في نزاعات. الكل مبسوط.', buyer: 'المشتري', store: 'المتجر', reason: 'السبب', release: 'ادفع للمتجر', refund: 'رجّع للمشتري', note: 'ملاحظة القرار (بشوفها الطرفين)', releaseQ: 'تدفع للمتجر؟', refundQ: 'ترجّع المبلغ للمشتري؟', decideB: 'هيك الطلب بتسكّر نهائيًا.', resolved: 'محلول', open: 'مفتوح' },
  shop: {
    storesTitle: 'المتاجر', storesLead: 'متاجر حقيقية من كل فلسطين — وكل دفعة محفوظة بأمان لحتى يوصلك طلبك.',
    searchStores: 'ابحث عن متجر أو صاحبه أو مدينة', allStores: 'كل المتاجر', products: 'منتجات', branches: 'فروع', by: 'لصاحبه',
    cat: { food: 'أكل', fashion: 'أزياء', electronics: 'إلكترونيات', books: 'كتب', beauty: 'تجميل', home: 'بيت', crafts: 'حِرف يدوية', digital: 'رقمي', services: 'خدمات', other: 'غير ذلك' },
    visit: 'زور المتجر', share: 'شارك', shareStore: 'شارك المتجر', shareProduct: 'شارك المنتج', copy: 'انسخ الرابط', copied: 'انتسخ الرابط',
    sendToContact: 'ابعته لحدا على S-Taler', sent: 'انبعت', shareText: 'شوف {name} على S-Taler',
    call: 'اتصل', whatsapp: 'واتساب', owner: 'صاحب المتجر', allBranches: 'كل الفروع', branch: 'الفرع', mainBranch: 'المتجر الرئيسي', noStores: 'ما في متاجر هون لسا.',
    storeNotFound: 'هالمتجر مش موجود أو مسكّر.', back: 'رجوع', explore: 'اكتشف S-Taler', yourOrders: 'طلباتك من هون',
    deposit: 'عربون {p}٪', depositLong: 'ادفع {amount} عربون هلّأ، والباقي ({rest}) عند التوصيل أو الاستلام.',
    depositNonRefundable: 'العربون ما بيرجع بعد ما يقبل المتجر الطلب.', fewLeft: 'باقي {n} بس', save: 'وفّر {p}٪',
    viewOnly: 'قراءة داخل التطبيق', downloadable: 'تنزيل', digitalProtected: 'نسختك مخصّصة باسم حسابك ومحمية.',
    removeQ: 'تشيله من السلة؟', removeB: 'رح ينشال {name} من سلتك.', removeOk: 'شيله', clearCart: 'فضّي السلة', clearQ: 'تفضّي السلة؟', clearB: 'كل المنتجات رح تنشال.', clearOk: 'فضّيها',
    howGet: 'كيف بدك تستلمه؟', delivery: 'توصيل', pickup: 'استلام من المتجر', address: 'عنوان التوصيل', addressPh: 'المدينة، الشارع، البناية — وعلامة مميزة بتساعد',
    phone: 'رقم للمندوب', note: 'ملاحظة للمتجر (اختياري)', useLocation: 'استخدم موقعي', located: 'انضاف الموقع', locating: 'عم نحدد موقعك…',
    payNow: 'تدفع هلّأ', laterBalance: 'بتدفع بعدين', totalLater: 'الباقي عند الاستلام',
    ads: 'عروض',
  },
  ord: {
    timeline: 'تتبّع الطلب', handover: 'رمز الاستلام', handoverLead: 'أعطِ هالرمز للمندوب (أو بالمتجر) بس لما يكون الطلب بإيدك. هو اللي بيحرّر الدفعة للمتجر.',
    payBalance: 'ادفع الباقي {amount}', balanceDue: 'باقي عليك', paidSoFar: 'مدفوع', dispute: 'بلّغ عن مشكلة', disputeLead: 'احكيلنا شو صار. الدفعة بتضل مجمّدة لحد ما يحلّها الدعم.',
    disputeReason: 'شو المشكلة؟', disputeSend: 'ابعت البلاغ', disputed: 'قيد المراجعة', open: 'افتح', downloadsLeft: 'باقي {n} تنزيلات', reader: 'القارئ',
    pickupAt: 'الاستلام من', deliverTo: 'التوصيل إلى', map: 'الخريطة', storePin: 'المتجر', youPin: 'إنت', lastSeen: 'آخر تحديث',
    ev: { placed: 'انطلب', accepted: 'المتجر قبل الطلب', shipped: 'انشحن', ready_for_pickup: 'جاهز للاستلام', location: 'تحديث الموقع', note: 'ملاحظة من المتجر', out_for_delivery: 'المندوب بالطريق لعندك', balance_paid: 'انْدفع الباقي', delivered: 'انسلّم', confirmed: 'أكّدت الاستلام', released: 'وصلت الدفعة للمتجر', cancelled: 'انلغى', disputed: 'تم التبليغ عن مشكلة', resolved: 'حلّها الدعم' },
    st: { processing: 'قيد التجهيز', shipped: 'بالطريق', delivered: 'انسلّم', completed: 'مكتمل', cancelled: 'ملغى', pending: 'معلّق' },
    confirmQ: 'وصلك كل إشي؟', confirmB: 'المتجر رح يستلم {amount} هلّأ. أكّد بس لما يكون الطلب بإيدك.', confirmOk: 'آه، استلمته',
    cancelQ: 'تلغي الطلب؟', cancelB: 'مصاريك برجعوا لمحفظتك فورًا.', cancelBKeep: 'المتجر قبل الطلب: العربون غير المسترد بيضل للمتجر، والباقي برجعلك.', cancelOk: 'ألغِ الطلب',
    payQ: 'تدفع الباقي هلّأ؟', payB: 'بينخصم {amount} من محفظتك وبيضل محفوظ لحد التسليم.', payOk: 'ادفع {amount}',
    protect: 'محمي من S-Taler: المتجر ما بيقبض إلا بعد التسليم.',
  },
  mstore: {
    stores: 'المتاجر والفروع', newStore: 'متجر جديد', newBranch: 'فرع جديد', branchName: 'اسم الفرع', branchOf: 'فرع من', current: 'شغّال على',
    switch: 'بدّل المتجر', editStore: 'تفاصيل المتجر', logo: 'الشعار', cover: 'صورة الغلاف', city: 'المدينة', address: 'العنوان', storePhone: 'رقم المتجر', showPhone: 'اعرض الرقم بصفحة المتجر',
    accent: 'لون المتجر', pickupOn: 'الزبون بيقدر يستلم من المتجر', deliveryOn: 'منوصّل', deliveryNote: 'ملاحظة التوصيل', category: 'التصنيف', pin: 'موقع المتجر', pinHint: 'اكبس على الخريطة لتحدد مكان متجرك.',
    closeStore: 'سكّر المتجر', closeQ: 'تسكّر {name}؟', closeB: 'بيختفي من دليل المتاجر مع فروعه. لازم تخلّص الطلبات المفتوحة أول.', closeOk: 'سكّر المتجر',
    ads: 'الإعلانات', newAd: 'إعلان جديد', adMedia: 'صورة أو فيديو', adTitle: 'العنوان', adBody: 'نص قصير', adProduct: 'اربطه بمنتج (اختياري)', adActive: 'ظاهر', adDeleteQ: 'تحذف هالإعلان؟', adDeleteOk: 'احذف الإعلان',
    deposit: 'العربون', depositPct: 'نسبة العربون ٪', depositHelp: '0 = دفع كامل. غير هيك المشتري بيدفع هالنسبة هلّأ والباقي عند التوصيل أو الاستلام.', depositRefundable: 'رجّع العربون إذا المشتري لغى',
    compareAt: 'السعر قبل الخصم (اختياري)', digitalMode: 'كيف بيوصل الملف للمشتري', modeDownload: 'تنزيل مخصّص باسمه', modeView: 'قراءة داخل التطبيق بس', downloadLimit: 'عدد مرات التنزيل',
    stampNote: 'ملفات PDF بتنختم بإيميل كل مشتري ورقم ترخيصه على كل صفحة.',
    accept: 'اقبل الطلب', ship: 'تم الشحن', readyPickup: 'جاهز للاستلام', track: 'حدّث التتبّع', sendLocation: 'ابعت موقعي', outForDelivery: 'المندوب طالع', addNote: 'أضف ملاحظة',
    deliver: 'سلّم الطلب', deliverLead: 'اطلب من المشتري رمز الاستلام المكوّن من 6 أرقام. هو إثبات إنه استلم، وبتوصلك الدفعة فورًا.',
    code: 'رمز الاستلام', cashBalance: 'استلمت الباقي {amount} كاش', deliverOk: 'أكّد التسليم', allStores: 'كل متاجري',
    licence: 'تتبّع نسخة مسرّبة', licenceLead: 'اكتب رقم الترخيص المطبوع على الملف المنتشر لتعرف مين اشتراه.', licenceFind: 'ابحث',
    buyerOwes: 'باقي على المشتري', disputeOpen: 'في بلاغ عن مشكلة — الدعم رح يتواصل معك', acceptQ: 'تقبل الطلب؟', acceptB: 'رح نخبّر المشتري إنك عم تجهّزه.',
  },
  bio: { unlockTitle: 'فتح القفل', unlockReason: 'أكّد إنه إنت', unlock: 'افتح بالبصمة', usePassword: 'ادخل بكلمة المرور بدلها', lockedLead: 'مقفول عشان تضل مصاريك بأمان.', enableTitle: 'بدك تفتح ببصمتك؟', enableLead: 'المرة الجاية افتح ببصمتك أو رمز قفل الجوال بدل ما تكتب كلمة المرور. بتقدر تطفيها من الإعدادات.', enable: 'شغّلها', notNow: 'مش هلّأ', enabled: 'تم تفعيل الفتح بالبصمة', toggle: 'الفتح بالبصمة', toggleD: 'استخدم بصمتك أو وجهك أو رمز قفل الجوال بدل كلمة المرور على هالجوال.' },
  account: { user: 'حساب شخصي', merchant: 'حساب تاجر', exchange: 'وكيل صرف', admin: 'مدير', super: 'المدير العام' },
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
    note: 'ملاحظة', delete: 'حذف', edit: 'تعديل', yes: 'نعم', no: 'لا', status: 'الحالة', date: 'التاريخ', more: 'عرض المزيد', done: 'تم', open: 'فتح', share: 'مشاركة',
    download: 'تنزيل', refresh: 'تحديث', language: 'English', theme: 'المظهر', signOut: 'تسجيل الخروج', menu: 'القائمة', you: 'أنت', details: 'التفاصيل', total: 'المجموع', or: 'أو',
  },
  nav: {
    help: 'كيف بتشتغل', contacts: 'جهات الاتصال', disputes: 'النزاعات', myStores: 'المتاجر والفروع', ads: 'الإعلانات', cash: 'قسائم نقدية',
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
    or: 'أو', viaEmail: 'الإيميل', viaSms: 'رسالة SMS', sendVia: 'ابعتلي الرمز على', smsNeedsPhone: 'أضف رقم جوالك لتستلم الرمز برسالة SMS.', verifyLeadSms: 'بعتنالك رمز من 6 أرقام برسالة SMS على',
    resendIn: 'رمز جديد بعد', noMailTitle: 'ما وصلك الرمز؟', noMail1: 'افحص البريد المزعج (Spam) والعروض (Promotions) — أول رسالة كثير بتروح هناك.', noMail2: 'ممكن تاخد لحد دقيقة لتوصل.', noMail3: 'في غلط بالإيميل؟', changeEmail: 'غيّر الإيميل', reviewTitle: 'الإيميل صحيح؟', reviewBody: 'رح نبعت الرمز المكوّن من 6 أرقام على {email}. تأكد إنه إيميل بتقدر تفتحه هلّأ.', reviewOk: 'آه، ابعت الرمز',
    confirmPassword: 'تأكيد كلمة المرور', mismatch: 'كلمتا المرور مش متطابقتين.',
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
    title: 'المتجر', lead: 'متاجر محلية، والدفع من محفظتك.', search: 'ابحث عن منتج أو متجر', digital: 'رقمي', physical: 'توصيل', sortBy: 'الترتيب', inStock: 'متوفر', soldOut: 'نفدت الكمية',
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
    none: 'ما في محادثات بعد.', closed: 'هاي المحادثة مغلقة.', closeChat: 'إغلاق المحادثة', edited: 'معدّلة', supportTitle: 'الدعم', pick: 'اختار محادثة', searchPeopleAny: 'الاسم أو الإيميل أو رقم المحفظة', reply: 'رد', edit: 'تعديل', delete: 'حذف', copy: 'نسخ', deleted: 'انحذفت الرسالة',
    deleteQ: 'تحذف الرسالة؟', deleteB: 'رح تنحذف عند كل اللي بالمحادثة.', deleteOk: 'احذفها', editing: 'عم تعدّل الرسالة', replyingTo: 'رد على',
    today: 'اليوم', yesterday: 'مبارح', emoji: 'إيموجي', openLink: 'افتح', saveContact: 'احفظ بجهات الاتصال', saved: 'انحفظ بجهات الاتصال', contacts: 'جهات اتصالك', everyone: 'ناس على S-Taler',
    editWindow: 'بتقدر تعدّل لمدة 15 دقيقة بعد الإرسال.',
  },
  contacts: {
    title: 'جهات الاتصال', lead: 'الناس اللي بتدفعلهم وبتراسلهم كثير — بالأسماء اللي بتحبها.', add: 'أضف جهة اتصال', search: 'ابحث بجهات الاتصال', none: 'ما عندك جهات اتصال لسا. احفظ ناس من المحادثات أو بعد ما تحوّلهم مصاري.',
    nickname: 'سمّيه على كيفك', who: 'الإيميل أو رقم المحفظة', pay: 'حوّل مصاري', message: 'راسل', remove: 'احذف', removeQ: 'تحذف {name} من جهات الاتصال؟', removeB: 'بتقدر ترجع تضيفه وقت ما بدك.',
    favourite: 'مفضّل', rename: 'غيّر الاسم', found: 'انحفظ',
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
  ask: {
    buyTitle: 'تأكيد الطلب', buyBody: 'رح تدفع {total} من محفظتك مقابل {count} منتج. الطلبات اللي بتنشحن بتضل فلوسها محفوظة لحد ما تأكّد الاستلام.', buyOk: 'ادفع {total}',
    topupTitle: 'شحن من TalerBank', topupBody: 'رح ينتقل {amount} من حسابك البنكي المربوط لمحفظتك.', topupOk: 'اشحن {amount}',
    toBankTitle: 'تحويل لحسابك البنكي', toBankBody: 'رح يطلع {amount} من محفظتك ويوصل لحسابك في TalerBank.', toBankOk: 'حوّل {amount}',
    voucherCancelTitle: 'إلغاء القسيمة؟', voucherCancelBody: 'مبلغها {amount} برجع لمحفظتك، والكود بيوقف عن الشغل.', voucherCancelOk: 'إلغاء القسيمة',
    photoTitle: 'حذف صورتك؟', photoBody: 'رح تظهر أحرف اسمك بدالها.', photoOk: 'احذف الصورة',
    allOutTitle: 'تسجيل الخروج من كل الأجهزة؟', allOutBody: 'كل جوال ومتصفح، ومنهم هاد الجهاز، رح يحتاج تسجيل دخول من جديد.', allOutOk: 'اطلع من كل الأجهزة',
    deviceTitle: 'تسجيل خروج هالجهاز؟', deviceBody: 'رح يحتاج كلمة السر عشان يرجع يدخل.', deviceOk: 'سجّل خروجه',
    signOutTitle: 'تسجيل الخروج؟', signOutBody: 'بتقدر ترجع تدخل بأي وقت.', signOutOk: 'تسجيل الخروج',
    closeChatTitle: 'إغلاق المحادثة؟', closeChatBody: 'بتضل تقدر تقرأها، بس ما حدا بيقدر يرد بعد هيك.', closeChatOk: 'أغلق المحادثة',
    shipTitle: 'تأكيد الشحن؟', shipBody: 'رح يوصل المشتري إشعار، ولما يأكّد الاستلام بتنزل الفلوس بمحفظتك.', shipOk: 'تم الشحن',
    merchCancelTitle: 'إلغاء الطلب؟', merchCancelBody: 'المشتري بيرجعله كامل المبلغ والكمية بترجع للمخزون.', merchCancelOk: 'إلغاء الطلب',
    claimTitle: 'صرف القسيمة؟', claimBody: 'رح ينضاف {amount} لمحفظتك.', claimOk: 'اصرف {amount}',
    saveTitle: 'حفظ الإعدادات؟', saveBody: 'التغييرات بتنطبق على الكل فورًا.', saveOk: 'حفظ',
  },
  people: {
    edit: 'تعديل البيانات', phone: 'الهاتف', language: 'اللغة', save: 'حفظ البيانات', saved: 'انحفظت البيانات',
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
      'orders.disputes': 'حل نزاعات الطلبات',
      'users.view': 'عرض المستخدمين ونشاطهم', 'users.edit': 'تعديل الأسماء والإيميلات والأرقام', 'users.password': 'تعيين وإعادة تعيين كلمات المرور',
      'users.status': 'إيقاف الحسابات وإعادة تفعيلها', 'users.delete': 'حذف الحسابات', 'users.security': 'تسجيل خروج المستخدمين وإلغاء التحقق بخطوتين',
      'users.role': 'تغيير نوع الحساب', 'wallets.freeze': 'تجميد المحافظ', 'stores.manage': 'إدارة المتاجر', 'pending.manage': 'إدارة التسجيلات اللي ما كملت',
      notify: 'إرسال إشعارات وإعلانات', support: 'الرد على محادثات الدعم', 'bank.ops': 'عمليات البنك وإثبات الاحتياطي', 'audit.view': 'قراءة سجل التدقيق',
      'settings.manage': 'تغيير إعدادات النظام',
    },
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
  const [lang, setLangState] = useState<Lang>(() => {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
    if (q === 'ar' || q === 'en') {
      try {
        localStorage.setItem('st.lang', q);
      } catch {
        /* private mode */
      }
      return q;
    }
    return (read('st.lang') as Lang) ?? 'ar';
  });
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
