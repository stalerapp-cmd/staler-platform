import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Check, Copy, Mail, Send, Share2 } from 'lucide-react';
import { Share as NativeShare } from '@capacitor/share';
import { get, isNative, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { fill } from '../lib/format';
import { useToast } from './Toast';
import { Avatar, Sheet, cx } from './ui';

function Brand({ d, bg }: { d: string; bg: string }) {
  return (
    <span className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-sm" style={{ background: bg }}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
        <path d={d} />
      </svg>
    </span>
  );
}
// Simple brand marks (paths are generic glyphs, drawn for this app).
const WA = 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2s-1 .2-3.4-.7a12 12 0 0 1-4.6-4.1c-.4-.6-1-1.7-1-2.9s.6-1.9.9-2.2.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6a9 9 0 0 0 1.6 2 8 8 0 0 0 2.3 1.4c.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z';
const TG = 'M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5L18 6.2c.4-.4-.1-.6-.6-.2L6.2 13 1.4 11.5c-1-.3-1-1 .2-1.5l18.8-7.2c.9-.3 1.7.2 1.5 1.5Z';
const FB = 'M14 8V6.2c0-.8.2-1.2 1.4-1.2H17V2h-2.6C11.3 2 10 3.5 10 6v2H8v3h2v11h4V11h2.7l.3-3h-3Z';
const IG = 'M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 4.7a5.1 5.1 0 1 0 0 10.2 5.1 5.1 0 0 0 0-10.2Zm0 8.4a3.3 3.3 0 1 1 0-6.6 3.3 3.3 0 0 1 0 6.6Zm5.3-9.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z';
const TT = 'M16.6 2h-3.3v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .8.1V9.2a6.3 6.3 0 1 0 5.4 6.2V8.6a7.9 7.9 0 0 0 4.6 1.5V6.8a4.7 4.7 0 0 1-4.6-4.8Z';
const XX = 'M17.8 3H21l-7 8 8.2 10H16l-5-6.2L5.4 21H2.2l7.5-8.6L1.8 3h6.4l4.5 5.7L17.8 3Zm-1.1 16h1.8L7.4 4.9H5.5L16.7 19Z';

export function ShareSheet({ open, onClose, url, title }: { open: boolean; onClose: () => void; url: string; title: string }) {
  const { t, err } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const text = fill(t.shop.shareText, { name: title });
  const enc = encodeURIComponent;

  useEffect(() => {
    if (!open || !user) return;
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const term = q.trim();
        const contacts = await get<{ contacts: any[] }>(`/api/contacts${term ? `?q=${enc(term)}` : ''}`);
        let list = contacts.contacts.map((c) => ({ id: c.user_id, full_name: c.nickname || c.full_name, profile_image: c.profile_image }));
        if (term.length >= 2) {
          const found = await get<{ users: any[] }>(`/api/messages/search-users?q=${enc(term)}`);
          list = [...list, ...found.users.filter((u) => !list.some((x) => x.id === u.id))];
        }
        if (alive) setPeople(list.slice(0, 20));
      } catch {
        if (alive) setPeople([]);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [open, q, user]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const i = document.createElement('textarea');
      i.value = url;
      document.body.appendChild(i);
      i.select();
      document.execCommand('copy');
      i.remove();
    }
    setCopied(true);
    toast(t.shop.copied);
    setTimeout(() => setCopied(false), 1800);
  };

  // Instagram and TikTok have no "share a link" address: copy the link, then open the app to paste it.
  const viaApp = async (app: string, href: string) => {
    await copy();
    toast(fill(t.social.copiedFor, { app }));
    if (isNative) {
      try {
        await NativeShare.share({ title, text, url, dialogTitle: t.shop.share });
        return;
      } catch {
        /* fall back to the website */
      }
    }
    window.open(href, '_blank', 'noopener');
  };
  const nativeShare = isNative
    ? () => NativeShare.share({ title, text, url, dialogTitle: t.shop.share }).catch(() => {})
    : typeof navigator.share === 'function'
      ? () => navigator.share({ title, text, url }).catch(() => {})
      : null;

  const socials = [
    { name: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text}\n${url}`)}`, icon: <Brand d={WA} bg="#25D366" /> },
    { name: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`, icon: <Brand d={TG} bg="#229ED9" /> },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, icon: <Brand d={FB} bg="#1877F2" /> },
    { name: 'X', href: `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`, icon: <Brand d={XX} bg="#111" /> },
    {
      name: 'E-mail',
      href: `mailto:?subject=${enc(title)}&body=${enc(`${text}\n${url}`)}`,
      icon: (
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-sky text-white">
          <Mail className="h-6 w-6" />
        </span>
      ),
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} title={t.shop.share}>
      <div className="space-y-6">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-sunk/60 p-2 ps-4">
          <span className="num min-w-0 flex-1 truncate text-sm" dir="ltr">
            {url.replace(/^https?:\/\//, '')}
          </span>
          <button onClick={copy} className={cx('flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition', copied ? 'bg-olive text-white' : 'bg-ink text-bg hover:opacity-90')}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t.shop.copied : t.shop.copy}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-x-2 gap-y-4 min-[380px]:grid-cols-5 sm:grid-cols-6">
          {nativeShare && (
            <button onClick={() => void nativeShare()} className="flex flex-col items-center gap-1.5 text-xs text-muted transition hover:text-ink">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-stitch text-white">
                <Share2 className="h-6 w-6" />
              </span>
              {t.shop.share}
            </button>
          )}
          {socials.map((s, i) => (
            <motion.a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileHover={{ y: -3 }}
              className="flex flex-col items-center gap-1.5 text-xs text-muted transition hover:text-ink"
            >
              {s.icon}
              {s.name}
            </motion.a>
          ))}
          {[
            { name: t.social.shareIg, href: 'https://www.instagram.com/', icon: <Brand d={IG} bg="linear-gradient(45deg,#F58529,#DD2A7B 50%,#8134AF)" /> },
            { name: t.social.shareTt, href: 'https://www.tiktok.com/', icon: <Brand d={TT} bg="#111" /> },
          ].map((s, i) => (
            <motion.button
              key={s.name}
              type="button"
              onClick={() => void viaApp(s.name, s.href)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.04 }}
              whileHover={{ y: -3 }}
              className="flex flex-col items-center gap-1.5 text-xs text-muted transition hover:text-ink"
            >
              {s.icon}
              {s.name}
            </motion.button>
          ))}
        </div>
        {user && (
          <div>
            <p className="mb-2 text-sm font-medium">{t.shop.sendToContact}</p>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.messages.searchPeople} className="field" />
            <ul className="mt-2 max-h-60 overflow-y-auto">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-sunk">
                  <Avatar name={p.full_name} src={p.profile_image} size={36} />
                  <span className="min-w-0 flex-1 truncate">{p.full_name}</span>
                  <button
                    disabled={sent.includes(p.id)}
                    onClick={async () => {
                      try {
                        await post('/api/messages/share', { recipientId: p.id, url, title });
                        setSent((s) => [...s, p.id]);
                      } catch (e) {
                        toast(err(e), 'error');
                      }
                    }}
                    className={cx('flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition', sent.includes(p.id) ? 'bg-olive/15 text-olive' : 'bg-sunk hover:bg-ink hover:text-bg')}
                  >
                    {sent.includes(p.id) ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4 flip-rtl" />}
                    {sent.includes(p.id) ? t.shop.sent : t.messages.send}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
