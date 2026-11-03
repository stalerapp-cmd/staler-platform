import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertOctagon, Ban, CreditCard, Flag, HelpCircle, MessageSquareWarning, PackageX, Quote, Star, ThumbsDown, UserX } from 'lucide-react';
import { get, put, post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { relative } from '../lib/format';
import { useToast } from './Toast';
import { Button, Sheet, Toggle, cx } from './ui';

export const REASONS = [
  { k: 'fraud', icon: AlertOctagon, ar: 'احتيال أو نصب', en: 'Fraud or scam', c: 'bg-stitch/10 text-stitch' },
  { k: 'not_delivered', icon: PackageX, ar: 'ما وصلني الطلب', en: 'Order never arrived', c: 'bg-sky/10 text-sky' },
  { k: 'bad_quality', icon: ThumbsDown, ar: 'جودة سيئة أو غير الموصوف', en: 'Poor or not as described', c: 'bg-gold/15 text-[rgb(150_105_10)] dark:text-gold' },
  { k: 'abuse', icon: MessageSquareWarning, ar: 'إساءة أو قلة احترام', en: 'Abuse or disrespect', c: 'bg-[#7A2E8C]/10 text-[#7A2E8C] dark:text-[#d7a3e2]' },
  { k: 'fake', icon: UserX, ar: 'حساب أو متجر وهمي', en: 'Fake account or store', c: 'bg-night/10 text-night dark:bg-white/10 dark:text-white' },
  { k: 'spam', icon: Ban, ar: 'إزعاج أو رسائل كثير', en: 'Spam', c: 'bg-sunk text-ink/80' },
  { k: 'payment', icon: CreditCard, ar: 'مشكلة بالدفع', en: 'A payment problem', c: 'bg-olive/12 text-olive' },
  { k: 'other', icon: HelpCircle, ar: 'إشي ثاني', en: 'Something else', c: 'bg-sunk text-ink/80' },
];

/** Report a store or a person to the team. */
export function ReportSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: { storeId?: string; userId?: string; name: string } }) {
  const { lang, err } = useI18n();
  const toast = useToast();
  const ar = lang === 'ar';
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await post('/api/feedback/reports', { ...(target.storeId ? { storeId: target.storeId } : { userId: target.userId }), reason, details: details.trim() });
      toast(ar ? 'وصل بلاغك للإدارة — رح يوصلك إشعار لما ينحل' : 'Your report reached the team — you’ll be notified');
      setReason(null);
      setDetails('');
      onClose();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={ar ? `بلّغ عن ${target.name}` : `Report ${target.name}`}>
      <p className="mb-3 text-sm text-muted">{ar ? 'البلاغ بيوصل للإدارة بس، وما حدا غيرهم بيعرف مين بلّغ.' : 'Only the team sees it; nobody else learns who reported.'}</p>
      <div className="grid grid-cols-2 gap-2">
        {REASONS.map((r) => (
          <button key={r.k} type="button" onClick={() => setReason(r.k)} className={cx('flex items-center gap-2 rounded-2xl p-2.5 text-start text-sm ring-1 transition', reason === r.k ? 'bg-night text-white ring-transparent dark:bg-white/15' : 'bg-surface ring-line hover:ring-ink/25')}>
            <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', reason === r.k ? 'bg-white/15' : r.c)}>
              <r.icon className="h-4 w-4" />
            </span>
            {ar ? r.ar : r.en}
          </button>
        ))}
      </div>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder={ar ? 'احكيلنا شو صار (رقم الطلب، التاريخ، أي تفاصيل بتساعد)' : 'Tell us what happened (order number, date, anything that helps)'}
        className="field mt-3 resize-none py-3 text-sm"
      />
      <Button block className="mt-3" variant="stitch" icon={<Flag className="h-4 w-4" />} disabled={!reason || details.trim().length < 10} loading={busy} onClick={send}>
        {ar ? 'ابعت البلاغ' : 'Send report'}
      </Button>
    </Sheet>
  );
}

export function StarsInput({ value, onChange, size = 'h-9 w-9' }: { value: number; onChange: (n: number) => void; size?: string }) {
  return (
    <div className="flex justify-center gap-1" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <motion.button key={n} type="button" role="radio" aria-checked={value === n} aria-label={String(n)} whileTap={{ scale: 0.8 }} onClick={() => onChange(n)} className="p-0.5">
          <Star className={cx(size, 'transition', n <= value ? 'fill-gold text-gold drop-shadow-[0_2px_6px_rgba(233,192,96,.45)]' : 'text-line')} />
        </motion.button>
      ))}
    </div>
  );
}

/** One review per person per store: writing again edits it. */
export function ReviewSheet({ open, onClose, storeId, storeName, onSaved }: { open: boolean; onClose: () => void; storeId: string; storeName: string; onSaved?: () => void }) {
  const { lang, err } = useI18n();
  const toast = useToast();
  const ar = lang === 'ar';
  const [state, setState] = useState<{ review: any; canReview: boolean } | null>(null);
  const [stars, setStars] = useState(0);
  const [body, setBody] = useState('');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setState(null);
    get<{ review: any; canReview: boolean }>(`/api/feedback/stores/${storeId}/my-review`)
      .then((r) => {
        setState(r);
        setStars(r.review?.stars ?? 0);
        setBody(r.review?.body ?? '');
        setAnon(!!r.review?.anonymous);
      })
      .catch(() => setState({ review: null, canReview: false }));
  }, [open, storeId]);
  const save = async () => {
    setBusy(true);
    try {
      await put(`/api/feedback/stores/${storeId}/my-review`, { stars, body: body.trim() || undefined, anonymous: anon });
      toast(state?.review ? (ar ? 'انعدّل تقييمك' : 'Your review was updated') : ar ? 'شكرًا على تقييمك' : 'Thanks for your review');
      onSaved?.();
      onClose();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={ar ? `قيّم ${storeName}` : `Rate ${storeName}`}>
      {!state ? (
        <div className="h-40" />
      ) : !state.canReview ? (
        <p className="py-6 text-center text-sm text-muted">{ar ? 'بتقدر تقيّم المتجر بعد ما تشتري منه.' : 'You can rate a store after buying from it.'}</p>
      ) : (
        <div className="space-y-4">
          {state.review && (
            <p className="rounded-2xl bg-sky/[0.07] px-3.5 py-2.5 text-sm text-ink/85">
              {ar
                ? `سبق وقيّمت هالمتجر (${relative(state.review.updated_at, lang)}). إذا تغيّر رأيك، عدّل تقييمك هون — بيضل تقييم واحد إلك.`
                : `You rated this store before (${relative(state.review.updated_at, 'en')}). If you changed your mind, edit it here — you keep one review.`}
            </p>
          )}
          <StarsInput value={stars} onChange={setStars} />
          <p className="text-center text-sm font-medium text-muted">
            {stars ? (ar ? ['', 'سيئ', 'مقبول', 'منيح', 'منيح كثير', 'ممتاز'] : ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'])[stars] : ar ? 'اختار عدد النجوم' : 'Choose the stars'}
          </p>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={1000} placeholder={ar ? 'رأيك بالمتجر (اختياري)' : 'Your opinion (optional)'} className="field resize-none py-3 text-sm" />
          <div className="rounded-2xl bg-sunk/60 p-3">
            <Toggle checked={anon} onChange={setAnon} label={ar ? 'اخفي اسمي' : 'Hide my name'} />
            <p className="mt-1 text-xs text-muted">{ar ? 'اسمك ما بيبين للناس ولا لصاحب المتجر. الإدارة بس بتشوفه.' : 'Your name is hidden from people and the owner; only the team sees it.'}</p>
          </div>
          <Button block size="lg" disabled={!stars} loading={busy} onClick={save}>
            {state.review ? (ar ? 'عدّل تقييمي' : 'Update my review') : ar ? 'ابعت التقييم' : 'Send review'}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** The store's reviews on its page — only when the team allows and the owner chose to show them. */
export function StoreReviewsBlock({ reviews }: { reviews: { avg: number; count: number; stars: Record<string, number>; level: string; latest: any[] } | null }) {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  if (!reviews?.count) return null;
  const total = reviews.count;
  return (
    <section className="card overflow-hidden">
      <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:p-6">
        <div className="text-center sm:pe-6 sm:text-start">
          <p className="num font-display text-5xl leading-none">{Number(reviews.avg).toFixed(1)}</p>
          <div className="mt-1.5 flex justify-center sm:justify-start">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={cx('h-5 w-5', n <= Math.round(reviews.avg) ? 'fill-gold text-gold' : 'text-line')} />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{ar ? `من ${total} تقييم لزباين اشتروا فعلًا` : `from ${total} reviews by real buyers`}</p>
        </div>
        <div className="space-y-1">
          {[5, 4, 3, 2, 1].map((n) => {
            const c = Number(reviews.stars?.[n] ?? 0);
            return (
              <div key={n} className="flex items-center gap-2 text-xs">
                <span className="num w-3 text-muted">{n}</span>
                <Star className="h-3 w-3 fill-gold text-gold" />
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunk">
                  <motion.span initial={{ width: 0 }} animate={{ width: `${(c / total) * 100}%` }} className="block h-full rounded-full bg-gold" />
                </span>
                <span className="num w-6 text-end text-muted">{c}</span>
              </div>
            );
          })}
        </div>
      </div>
      {reviews.latest?.length > 0 && (
        <div className="-mx-1 flex gap-3 overflow-x-auto border-t border-line px-5 py-4 [scrollbar-width:none]">
          {reviews.latest.map((r, i) => (
            <figure key={i} className="w-64 shrink-0 rounded-2xl bg-bg/70 p-3.5 ring-1 ring-line">
              <Quote className="h-4 w-4 text-gold" />
              <blockquote className="mt-1 line-clamp-4 text-sm leading-relaxed">{r.body}</blockquote>
              <figcaption className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{r.name ?? (ar ? 'زبون' : 'A customer')}</span>
                <span className="inline-flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={cx('h-3 w-3', n <= r.stars ? 'fill-gold text-gold' : 'text-line')} />
                  ))}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

