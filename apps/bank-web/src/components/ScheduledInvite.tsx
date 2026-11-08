import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { post } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useToast } from './Toast';
import { Button } from './ui';

/** Accept or decline scheduled payments right in the notification. */
export function ScheduledInvite({ orderId }: { orderId: string }) {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'accepted' | 'declined' | 'gone'>('idle');
  const go = async (action: 'accept' | 'decline') => {
    setState('busy');
    try {
      await post(`/api/scheduled/incoming/${orderId}`, { action });
      setState(action === 'accept' ? 'accepted' : 'declined');
    } catch (e: any) {
      if (e?.status === 404) setState('gone');
      else {
        setState('idle');
        toast(err(e), 'error');
      }
    }
  };
  if (state === 'accepted') return <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-olive"><Check className="h-4 w-4" /> {ar ? 'وافقت' : 'Accepted'}</p>;
  if (state === 'declined') return <p className="mt-2 text-sm text-muted">{ar ? 'رفضت ووقفت دفعاته.' : 'Declined; their payments stopped.'}</p>;
  if (state === 'gone') return <p className="mt-2 text-sm text-muted">{ar ? 'هالطلب انتهى أو رديت عليه قبل.' : 'This request is no longer open.'}</p>;
  return (
    <div className="mt-2.5 flex gap-2" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" loading={state === 'busy'} icon={<Check className="h-4 w-4" />} onClick={() => go('accept')}>
        {ar ? 'وافق' : 'Accept'}
      </Button>
      <Button size="sm" variant="secondary" disabled={state === 'busy'} icon={<X className="h-4 w-4" />} onClick={() => go('decline')}>
        {ar ? 'ارفض' : 'Decline'}
      </Button>
    </div>
  );
}
