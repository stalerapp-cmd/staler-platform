/**
 * The browser's own form bubbles ("Please fill out this field") speak the
 * browser's language, not the app's. Replace their text with ours, in the
 * language the app is showing, for every form in the app.
 */
const T = {
  ar: {
    missing: 'عبّي هالخانة',
    choose: 'اختار وحدة من الخيارات',
    email: 'اكتب إيميل صحيح، متل name@example.com',
    url: 'اكتب رابط صحيح يبدأ بـ https://',
    number: 'اكتب رقم',
    short: 'قصيرة — لازم {n} أحرف على الأقل (هلأ {c})',
    long: 'طويلة — {n} حرف كحد أقصى',
    low: 'أقل قيمة مسموحة {n}',
    high: 'أعلى قيمة مسموحة {n}',
    step: 'القيمة مش صحيحة',
    pattern: 'الصيغة مش صحيحة',
  },
  en: {
    missing: 'Please fill in this field',
    choose: 'Please choose an option',
    email: 'Enter a valid e-mail, like name@example.com',
    url: 'Enter a valid link starting with https://',
    number: 'Enter a number',
    short: 'Too short — at least {n} characters (now {c})',
    long: 'Too long — at most {n} characters',
    low: 'The lowest allowed value is {n}',
    high: 'The highest allowed value is {n}',
    step: 'This value is not valid',
    pattern: 'This format is not valid',
  },
};

type El = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function message(el: El): string {
  const w = T[document.documentElement.lang === 'en' ? 'en' : 'ar'];
  const v = el.validity;
  const fill = (s: string, n: string | number, c = 0) => s.replace('{n}', String(n)).replace('{c}', String(c));
  if (v.valueMissing) return el instanceof HTMLSelectElement || (el as HTMLInputElement).type === 'radio' ? w.choose : w.missing;
  if (v.typeMismatch) return (el as HTMLInputElement).type === 'url' ? w.url : w.email;
  if (v.badInput) return w.number;
  if (v.tooShort) return fill(w.short, (el as HTMLInputElement).minLength, el.value.length);
  if (v.tooLong) return fill(w.long, (el as HTMLInputElement).maxLength);
  if (v.rangeUnderflow) return fill(w.low, (el as HTMLInputElement).min);
  if (v.rangeOverflow) return fill(w.high, (el as HTMLInputElement).max);
  if (v.stepMismatch) return w.step;
  if (v.patternMismatch) return el.title || w.pattern;
  return '';
}

export function translateValidity() {
  document.addEventListener(
    'invalid',
    (e) => {
      const el = e.target as El;
      if (!el || !('validity' in el) || el.validity.customError) return;
      el.setCustomValidity(message(el));
    },
    true,
  );
  // Our message is "custom", so recompute it as the person edits: cleared once the value is fine,
  // and still in the app's language while the browser keeps its bubble open.
  const clear = (e: Event) => {
    const el = e.target as El;
    if (!el || !('setCustomValidity' in el)) return;
    el.setCustomValidity('');
    if (!el.validity.valid) el.setCustomValidity(message(el));
  };
  document.addEventListener('input', clear, true);
  document.addEventListener('change', clear, true);
}
