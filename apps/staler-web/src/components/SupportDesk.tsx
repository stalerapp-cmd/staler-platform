import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeHelp, ChevronDown, Clock3, Hand, HandCoins, Inbox, KeyRound, Landmark, ShieldAlert, ShoppingBag, Star, Store, Wallet, type LucideIcon } from 'lucide-react';
import { get, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { usePolling } from '../lib/hooks';
import { relative } from '../lib/format';
import { useToast } from './Toast';
import { Avatar, Button, cx } from './ui';

export const TOPICS: { k: string; icon: LucideIcon; ar: string; en: string; c: string }[] = [
  { k: 'wallet', icon: Wallet, ar: 'المحفظة والتحويلات', en: 'Wallet & transfers', c: 'bg-night/10 text-night dark:bg-white/10 dark:text-white' },
  { k: 'bank', icon: Landmark, ar: 'البنك والشحن', en: 'Bank & top-ups', c: 'bg-olive/12 text-olive' },
  { k: 'orders', icon: ShoppingBag, ar: 'طلب أو مشكلة بطلب', en: 'An order or a problem', c: 'bg-sky/10 text-sky' },
  { k: 'stores', icon: Store, ar: 'متجري', en: 'My store', c: 'bg-[#7A2E8C]/10 text-[#7A2E8C] dark:text-[#d7a3e2]' },
  { k: 'agents', icon: HandCoins, ar: 'وكلاء الصرف', en: 'Cash agents', c: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold' },
  { k: 'account', icon: KeyRound, ar: 'الحساب والأمان', en: 'Account & security', c: 'bg-[#3B2F5E]/10 text-[#3B2F5E] dark:text-[#b9acee]' },
  { k: 'report', icon: ShieldAlert, ar: 'بلاغ أو شكوى', en: 'A report or complaint', c: 'bg-stitch/10 text-stitch' },
  { k: 'other', icon: BadgeHelp, ar: 'إشي ثاني', en: 'Something else', c: 'bg-sunk text-ink/80' },
];
export const topicOf = (k: string | null | undefined) => TOPICS.find((x) => x.k === k);

/** "What do you need help with?" — the request goes to the team that handles it. */
export function SupportTopics({ onPick }: { onPick: (topic: string) => void }) {
  const { lang } = useI18n();
  return (
    <div>
      <p className="mb-2.5 text-sm font-medium text-ink/80">{lang === 'ar' ? 'بشو بدك مساعدة؟' : 'What do you need help with?'}</p>
      <div className="grid grid-cols-2 gap-2">
        {TOPICS.map((x) => (
          <button key={x.k} type="button" onClick={() => onPick(x.k)} className="flex items-center gap-2.5 rounded-2xl bg-surface p-2.5 text-start ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-ink/25">
            <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', x.c)}>
              <x.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="text-sm font-medium leading-tight">{lang === 'ar' ? x.ar : x.en}</span>
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-muted">{lang === 'ar' ? 'طلبك بيوصل للفريق المختص، وأول واحد بيستلمه بيضل معك للآخر.' : 'Your request reaches the right team; whoever takes it stays with you to the end.'}</p>
    </div>
  );
}

/** For the support team: requests nobody took yet, that you may take. Taking one makes it yours alone. */
export function SupportQueue({ open: startOpen, onClaimed }: { open?: boolean; onClaimed: () => void }) {
  const { lang, err } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState(!!startOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    try {
      setItems((await get<{ items: any[] }>('/api/messages/support/queue')).items);
    } catch {
      setItems([]);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  usePolling(load, 15_000);
  if (!items) return null;
  const claim = async (id: string) => {
    setBusy(id);
    try {
      await post(`/api/messages/support/${id}/claim`);
      toast(lang === 'ar' ? 'صار الطلب إلك' : 'The request is yours');
      onClaimed();
      void load();
      nav(`/app/messages/${id}`);
    } catch (e) {
      toast(err(e), 'error');
      void load();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="border-b border-line p-2">
      <button type="button" onClick={() => setOpen(!open)} className={cx('flex w-full items-center gap-3 rounded-2xl p-3 text-start transition', items.length ? 'bg-gold/10 hover:bg-gold/15' : 'hover:bg-sunk')}>
        <span className={cx('grid h-10 w-10 place-items-center rounded-full', items.length ? 'bg-gold text-night' : 'bg-sunk text-muted')}>
          <Inbox className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{lang === 'ar' ? 'طلبات دعم بتستنى' : 'Waiting support requests'}</span>
          <span className="block text-xs text-muted">{items.length ? (lang === 'ar' ? `${items.length} طلب لفريقك` : `${items.length} for your team`) : lang === 'ar' ? 'ما في إشي هلّأ' : 'Nothing right now'}</span>
        </span>
        {items.length > 0 && <span className="num grid h-6 min-w-6 place-items-center rounded-full bg-stitch px-1.5 text-xs font-bold text-white">{items.length}</span>}
        <ChevronDown className={cx('h-4 w-4 text-muted transition', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && items.length > 0 && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            {items.map((x) => {
              const T = topicOf(x.topic);
              return (
                <li key={x.id} className="mt-1.5 rounded-2xl bg-surface p-3 ring-1 ring-line">
                  <div className="flex items-start gap-2.5">
                    <Avatar name={x.customer_name} src={x.customer_image} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{x.customer_name}</p>
                      {T && (
                        <span className={cx('mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', T.c)}>
                          <T.icon className="h-3 w-3" /> {lang === 'ar' ? T.ar : T.en}
                        </span>
                      )}
                      {x.last && <p className="mt-1 line-clamp-2 text-xs text-muted">{x.last}</p>}
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                        <Clock3 className="h-3 w-3" /> {relative(x.created_at, lang)}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" block className="mt-2.5" loading={busy === x.id} icon={<Hand className="h-4 w-4" />} onClick={() => claim(x.id)}>
                    {lang === 'ar' ? 'استلم الطلب' : 'Take it'}
                  </Button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** After a support chat closes, the customer may rate the help — or say they'd rather not. */
export function SupportRating({ conversationId, rating, onDone }: { conversationId: string; rating: { stars: number | null; comment: string | null; declined: boolean } | null; onDone: () => void }) {
  const { lang, err } = useI18n();
  const toast = useToast();
  const [stars, setStars] = useState(rating?.stars ?? 0);
  const [comment, setComment] = useState(rating?.comment ?? '');
  const [edit, setEdit] = useState(!rating);
  const [busy, setBusy] = useState(false);
  const ar = lang === 'ar';
  const send = async (declined = false) => {
    setBusy(true);
    try {
      await post(`/api/messages/conversations/${conversationId}/rate`, declined ? { declined: true } : { stars, comment: comment.trim() || undefined });
      toast(declined ? (ar ? 'تمام، ما في مشكلة' : 'No problem') : ar ? 'شكرًا على تقييمك' : 'Thanks for rating');
      setEdit(false);
      onDone();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  if (!edit)
    return (
      <div className="flex items-center justify-center gap-2 border-t border-line bg-surface px-4 py-2.5 text-sm text-muted">
        {rating?.declined ? (ar ? 'اخترت ما تقيّم' : 'You chose not to rate') : <span className="inline-flex items-center gap-1">{ar ? 'قيّمت المساعدة' : 'You rated'} <span className="num font-semibold text-gold">{'★'.repeat(rating?.stars ?? stars)}</span></span>}
        <button type="button" onClick={() => setEdit(true)} className="font-semibold text-sky hover:underline">
          {ar ? 'عدّل' : 'Change'}
        </button>
      </div>
    );
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="border-t border-line bg-surface px-4 py-4">
      <p className="text-center font-semibold">{ar ? 'كيف كانت المساعدة؟' : 'How was the help?'}</p>
      <p className="text-center text-xs text-muted">{ar ? 'تقييمك بيوصل للإدارة بس، وبيساعدنا نحسّن الخدمة.' : 'Only the management sees it; it helps us do better.'}</p>
      <div className="mt-3 flex justify-center gap-1.5" role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <motion.button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n}`} whileTap={{ scale: 0.85 }} onClick={() => setStars(n)} className="p-1">
            <Star className={cx('h-8 w-8 transition', n <= stars ? 'fill-gold text-gold' : 'text-line')} />
          </motion.button>
        ))}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={2} placeholder={ar ? 'كلمة عن تجربتك (اختياري)' : 'A word about it (optional)'} className="field mt-3 resize-none py-2.5 text-sm" />
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" disabled={!stars} loading={busy} onClick={() => send(false)}>
          {ar ? 'ابعت التقييم' : 'Send rating'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => send(true)}>
          {ar ? 'ما بدي أقيّم' : 'Rather not'}
        </Button>
      </div>
    </motion.div>
  );
}
