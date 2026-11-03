import { useState } from 'react';
import { CalendarOff, CalendarPlus, Check, Plane, PowerOff, X } from 'lucide-react';
import { post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useData } from '../lib/hooks';
import { relative } from '../lib/format';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar, Badge, Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, cx } from '../components/ui';

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string, ar: boolean) => new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(String(d).slice(0, 10)));
const days = (a: string, b: string) => Math.round((+new Date(String(b).slice(0, 10)) - +new Date(String(a).slice(0, 10))) / 86400000) + 1;

/** Admin leave: ask for time off; the super admin approves, or puts someone on leave / off support. */
export function AdminLeaves() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const confirm = useConfirm();
  const data = useData<{ leaves: any[]; admins: any[]; isSuper: boolean }>('/api/admin/leaves');
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = data.data;
  const pending = (d?.leaves ?? []).filter((l) => l.status === 'requested');
  const rest = (d?.leaves ?? []).filter((l) => l.status !== 'requested');

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast(ok);
      void data.reload();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      if (form.adminId) await post('/api/admin/leaves/set', { adminId: form.adminId, kind: form.kind, startsOn: form.startsOn, endsOn: form.endsOn, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) });
      else await post('/api/admin/leaves', { startsOn: form.startsOn, endsOn: form.endsOn, reason: form.reason.trim() });
      toast(form.adminId ? (ar ? 'انحفظ وانبعتله إشعار' : 'Saved — they were told') : d?.isSuper ? (ar ? 'انحفظت' : 'Saved') : ar ? 'انبعت طلبك' : 'Request sent');
      setForm(null);
      void data.reload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(null);
    }
  };
  const ST: Record<string, [string, 'good' | 'warn' | 'bad' | 'neutral']> = {
    requested: [ar ? 'بستنى الموافقة' : 'Waiting', 'warn'],
    approved: [ar ? 'موافق عليها' : 'Approved', 'good'],
    declined: [ar ? 'مرفوضة' : 'Declined', 'bad'],
    cancelled: [ar ? 'ملغية' : 'Cancelled', 'neutral'],
  };

  const Row = ({ l }: { l: any }) => {
    const now = l.status === 'approved' && String(l.starts_on).slice(0, 10) <= today() && String(l.ends_on).slice(0, 10) >= today();
    return (
      <li className={cx('rounded-2xl p-3.5 ring-1', now ? 'bg-gold/[0.07] ring-gold/40' : 'ring-line')}>
        <div className="flex items-center gap-3">
          <Avatar name={l.admin_name} src={l.admin_image} size={40} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 font-semibold">
              {l.admin_name}
              {l.kind === 'off' ? <Badge tone="bad">{ar ? 'موقوف عن الدعم' : 'Off support'}</Badge> : null}
              {now && <Badge tone="warn">{ar ? 'هلّأ' : 'Now'}</Badge>}
            </p>
            <p className="text-sm">
              {fmt(l.starts_on, ar)} ← {fmt(l.ends_on, ar)} <span className="text-xs text-muted">· {ar ? `${days(l.starts_on, l.ends_on)} يوم` : `${days(l.starts_on, l.ends_on)} days`}</span>
            </p>
          </div>
          <Badge tone={ST[l.status]?.[1] ?? 'neutral'}>{ST[l.status]?.[0] ?? l.status}</Badge>
        </div>
        {l.reason && <p className="mt-2 rounded-xl bg-sunk/60 px-3 py-2 text-sm">«{l.reason}»</p>}
        {l.note && <p className="mt-1 text-xs text-muted">{ar ? 'رد:' : 'Reply:'} {l.note}</p>}
        <p className="mt-1 text-[11px] text-muted">
          {l.requested_by_name && l.requested_by_name !== l.admin_name ? (ar ? `حطّها ${l.requested_by_name}` : `Set by ${l.requested_by_name}`) : ar ? 'طلبها بنفسه' : 'Asked by them'} · {relative(l.created_at, lang)}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {l.status === 'requested' && d?.isSuper && (
            <>
              <Button size="sm" loading={busy === `a${l.id}`} icon={<Check className="h-4 w-4" />} onClick={() => run(`a${l.id}`, () => post(`/api/admin/leaves/${l.id}/decide`, { approve: true }), ar ? 'انقبلت' : 'Approved')}>
                {ar ? 'وافق' : 'Approve'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<X className="h-4 w-4" />}
                onClick={() => {
                  const note = window.prompt(ar ? 'سبب الرفض (بيوصله)' : 'Reason (they see it)') ?? undefined;
                  void run(`d${l.id}`, () => post(`/api/admin/leaves/${l.id}/decide`, { approve: false, ...(note ? { note } : {}) }), ar ? 'انرفضت' : 'Declined');
                }}
              >
                {ar ? 'ارفض' : 'Decline'}
              </Button>
            </>
          )}
          {['requested', 'approved'].includes(l.status) && String(l.ends_on).slice(0, 10) >= today() && (
            <Button
              size="sm"
              variant="secondary"
              icon={<CalendarOff className="h-4 w-4" />}
              onClick={async () => {
                if (!(await confirm({ title: ar ? 'تلغيها؟' : 'Cancel it?', body: now ? (ar ? 'بيرجع شغّال من هلّأ.' : 'They are back from now.') : '', confirmLabel: ar ? 'ألغيها' : 'Cancel it' }))) return;
                void run(`c${l.id}`, () => post(`/api/admin/leaves/${l.id}/cancel`), ar ? 'انلغت' : 'Cancelled');
              }}
            >
              {now ? (ar ? 'رجّعه' : 'End now') : ar ? 'ألغيها' : 'Cancel'}
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title={ar ? 'الإجازات' : 'Leave'}
        lead={
          d?.isSuper
            ? ar
              ? 'طلبات الإجازة من الفريق، ومين بإجازة هلّأ. بتقدر تحط حدا بإجازة أو توقفه عن الدعم لفترة — بيوصله إشعار، وبيبين تحت اسمه لما تحوّل محادثات.'
              : 'Leave requests from the team and who is away now. Put someone on leave or off support for a while — they are told, and it shows under their name when you hand chats.'
            : ar
              ? 'اطلب إجازة من السوبر أدمن. وقت ما تكون بإجازة ما بتوصلك طلبات دعم جديدة.'
              : 'Ask the super admin for leave. While away you get no new support requests.'
        }
        actions={
          <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => (setError(null), setForm({ adminId: '', kind: 'leave', startsOn: today(), endsOn: today(), reason: '' }))}>
            <span className="hidden sm:inline">{ar ? 'اطلب إجازة' : 'Ask for leave'}</span>
          </Button>
        }
      />
      {!d ? (
        <Skeleton className="h-48 rounded-3xl" />
      ) : (
        <div className="space-y-6">
          {d.isSuper && (
            <section>
              <h2 className="mb-2 text-lg">{ar ? 'الفريق' : 'The team'}</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {d.admins.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card">
                    <Avatar name={a.full_name} src={a.profile_image} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.full_name}</span>
                      <span className={cx('block text-xs', a.leave ? 'text-[rgb(150_105_10)] dark:text-gold' : 'text-olive')}>
                        {a.leave ? `${a.leave.kind === 'off' ? (ar ? 'موقوف' : 'Off') : ar ? 'إجازة' : 'Leave'} ${fmt(a.leave.starts_on, ar)} ← ${fmt(a.leave.ends_on, ar)}` : ar ? 'شغّال' : 'Working'}
                      </span>
                    </span>
                    <button
                      onClick={() => (setError(null), setForm({ adminId: a.id, name: a.full_name, kind: 'leave', startsOn: today(), endsOn: today(), reason: '' }))}
                      className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-sunk"
                      aria-label={ar ? 'إجازة أو توقيف' : 'Leave or off'}
                      title={ar ? 'إجازة أو توقيف' : 'Leave or off'}
                    >
                      <Plane className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pending.length > 0 && (
            <section>
              <h2 className="mb-2 text-lg">{ar ? 'طلبات بتستنى' : 'Waiting requests'}</h2>
              <ul className="space-y-2.5">
                {pending.map((l) => (
                  <Row key={l.id} l={l} />
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2 className="mb-2 text-lg">{d.isSuper ? (ar ? 'كل الإجازات' : 'All leave') : ar ? 'إجازاتي' : 'My leave'}</h2>
            {!rest.length ? (
              <EmptyState icon={<Plane className="h-6 w-6" />} title={ar ? 'ما في إجازات' : 'No leave yet'} />
            ) : (
              <ul className="space-y-2.5">
                {rest.map((l) => (
                  <Row key={l.id} l={l} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.adminId ? form.name : ar ? 'اطلب إجازة' : 'Ask for leave'}>
        {form && (
          <div className="space-y-4">
            {form.adminId && (
              <div className="grid grid-cols-2 gap-1 rounded-2xl bg-sunk p-1">
                {(
                  [
                    ['leave', ar ? 'إجازة' : 'Leave', Plane],
                    ['off', ar ? 'وقّفه عن الدعم' : 'Off support', PowerOff],
                  ] as const
                ).map(([k, l, I]) => (
                  <button key={k} type="button" onClick={() => setForm({ ...form, kind: k })} className={cx('flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm transition', form.kind === k ? 'bg-surface font-semibold shadow-card' : 'text-muted')}>
                    <I className="h-4 w-4" /> {l}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'من' : 'From'}</span>
                <input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value, endsOn: form.endsOn < e.target.value ? e.target.value : form.endsOn })} className="field" />
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-ink/80">{ar ? 'لحد' : 'Until'}</span>
                <input type="date" min={form.startsOn} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} className="field" />
              </label>
            </div>
            <p className="text-xs text-muted">{ar ? `${days(form.startsOn, form.endsOn)} يوم` : `${days(form.startsOn, form.endsOn)} days`}</p>
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2} maxLength={300} placeholder={form.adminId ? (ar ? 'السبب (بيوصله — اختياري)' : 'Reason (they see it — optional)') : ar ? 'السبب' : 'Reason'} className="field resize-none py-3" />
            <ErrorNote>{error}</ErrorNote>
            <Button block size="lg" loading={busy === 'save'} disabled={!form.adminId && form.reason.trim().length < 2} onClick={save}>
              {form.adminId ? (ar ? 'احفظ وخبّره' : 'Save and tell them') : d?.isSuper ? (ar ? 'احفظ' : 'Save') : ar ? 'ابعت الطلب' : 'Send request'}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
