import { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { AMOUNT_RE } from '../lib/format';
import { QRImage, downloadDataUrl } from '../components/QR';
import { AmountInput, Button, CopyButton, Field, PageHeader, Toggle } from '../components/ui';

export function payUri(walletId: string, amount?: string, desc?: string) {
  const p = new URLSearchParams({ to: walletId });
  if (amount && AMOUNT_RE.test(amount) && Number(amount) > 0) p.set('amount', `PS:${amount}`);
  if (desc) p.set('desc', desc);
  return `taler://pay?${p.toString()}`;
}

export default function Receive() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [fixed, setFixed] = useState(false);
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const uri = useMemo(() => payUri(user?.wallet_id ?? '', fixed ? amount : undefined, desc.trim() || undefined), [user, fixed, amount, desc]);

  return (
    <div className="mx-auto grid max-w-4xl gap-8 lg:grid-cols-2 lg:items-start">
      <div>
        <PageHeader title={t.receive.title} lead={t.receive.lead} />
        <div className="card space-y-4 p-5">
          <Toggle checked={fixed} onChange={setFixed} label={t.receive.fixed} />
          {fixed && <AmountInput label={t.common.amount} value={amount} onChange={setAmount} autoFocus />}
          <Field label={`${t.receive.description} (${t.common.optional})`} value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 80))} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-5 pt-2 lg:pt-16">
        <QRImage value={uri} label={t.receive.yourCode} />
        <div className="flex items-center gap-2">
          <span className="num rounded-xl bg-sunk px-3 py-1.5 text-sm">{user?.wallet_id}</span>
          <CopyButton text={user?.wallet_id ?? ''} />
        </div>
        <Button
          variant="secondary"
          icon={<Download className="h-4 w-4" />}
          onClick={async () => downloadDataUrl(await QRCode.toDataURL(uri, { width: 800, margin: 2 }), `s-taler-${user?.wallet_id}.png`)}
        >
          {t.receive.save}
        </Button>
      </div>
    </div>
  );
}
