import { useEffect, useState } from 'react';
import { BellRing, Volume2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { announce, disablePush, enablePush, permission, prefs, setSound, support } from '../lib/alerts';
import { useToast } from './Toast';
import { Button, Toggle } from './ui';

/** Settings → notifications on this device: pop-ups and sound, both off until turned on here. */
export function AlertSettings() {
  const { lang, err } = useI18n();
  const ar = lang === 'ar';
  const toast = useToast();
  const [p, setP] = useState(prefs());
  const [perm, setPerm] = useState<'granted' | 'denied' | 'default'>('default');
  const [busy, setBusy] = useState(false);
  const s = support();
  useEffect(() => {
    const on = () => setP(prefs());
    window.addEventListener('app:alert-prefs', on);
    void permission().then(setPerm).catch(() => undefined);
    return () => window.removeEventListener('app:alert-prefs', on);
  }, []);

  const why =
    s === 'ios-install'
      ? ar
        ? 'على الآيفون: من المتصفح اكبس «مشاركة» ← «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من هناك وفعّلها.'
        : 'On iPhone: tap Share → “Add to Home Screen”, open it from there and turn this on.'
      : s === 'unsupported'
        ? ar
          ? 'هالمتصفح ما بيدعم الإشعارات. جرّب Chrome أو Edge أو Safari حديث.'
          : 'This browser doesn’t support notifications. Try a recent Chrome, Edge or Safari.'
        : perm === 'denied'
          ? ar
            ? 'الإشعارات ممنوعة لهالموقع من إعدادات المتصفح/الجوال. اسمحلها من هناك (القفل جنب العنوان ← الإشعارات) وبعدين فعّلها هون.'
            : 'Notifications are blocked for this site in the browser/phone settings. Allow them there (the lock by the address → Notifications), then turn this on.'
          : null;

  return (
    <div className="space-y-1">
      <Toggle
        checked={p.push}
        label={ar ? 'إشعارات منبثقة على هالجهاز' : 'Pop-up notifications on this device'}
        description={
          ar
            ? 'بتطلعلك فورًا حتى لو كنت بتاب ثانية أو التطبيق مسكّر بالخلفية. ولما تكون جوا التطبيق بتطلع فوق بالصفحة.'
            : 'They appear right away even in another tab or with the app in the background. Inside the app they slide in at the top.'
        }
        onChange={async (v) => {
          if (busy) return;
          setBusy(true);
          try {
            if (!v) {
              await disablePush();
              toast(ar ? 'وقّفنا الإشعارات المنبثقة على هالجهاز' : 'Pop-ups are off on this device');
            } else {
              const r = await enablePush(lang);
              setPerm(await permission());
              if (r === 'ok') toast(ar ? 'تمام! رح تطلعلك الإشعارات على هالجهاز' : 'Done — notifications will pop up on this device');
              else if (r === 'denied') toast(ar ? 'ما سمحت بالإشعارات. بتقدر تسمحلها من إعدادات المتصفح.' : 'Notifications weren’t allowed. You can allow them in the browser settings.', 'error');
              else if (r === 'off') toast(ar ? 'الإشعارات مش مفعّلة على السيرفر هلّأ' : 'Notifications aren’t set up on the server yet', 'error');
            }
          } catch (e) {
            toast(err(e), 'error');
          } finally {
            setP(prefs());
            setBusy(false);
          }
        }}
      />
      {why && <p className="rounded-xl bg-gold/10 px-3 py-2 text-xs leading-relaxed text-ink/80">{why}</p>}
      <Toggle
        checked={p.sound}
        label={ar ? 'صوت الإشعار' : 'Notification sound'}
        description={ar ? 'نغمة قصيرة لما يوصلك إشي وانت جوا التطبيق.' : 'A short chime when something arrives while you’re in the app.'}
        onChange={(v) => {
          setSound(v);
          setP(prefs());
        }}
      />
      {(p.push || p.sound) && (
        <div className="pt-2">
          <Button
            variant="secondary"
            size="sm"
            icon={p.push ? <BellRing className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            onClick={() =>
              void announce(
                { id: `test-${Date.now()}`, title: ar ? 'هيك بيطلع الإشعار ✨' : 'This is how it looks ✨', body: ar ? 'تجربة: ما في إشي جديد فعليًا.' : 'Just a test — nothing new really.', link: '/app/settings' },
                { hidden: false },
              )
            }
          >
            {ar ? 'جرّب' : 'Try it'}
          </Button>
        </div>
      )}
    </div>
  );
}
