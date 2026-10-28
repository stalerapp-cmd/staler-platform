// HTTPS -> SMTP relay for the S-Taler / TalerBank servers (Supabase Edge Function).
//
// Render's free plan blocks outgoing SMTP ports; Supabase Edge Functions only
// block 25 and 587, so mail goes out from here over implicit TLS (port 465).
// Callers must present the shared relay secret (header x-relay-secret); the
// SMTP credentials travel in the TLS-protected request and are never stored
// or logged.
//
// Deploy:  supabase functions deploy mail-relay --no-verify-jwt
// Secret:  supabase secrets set MAIL_RELAY_SECRET=<same value as on Render>
import nodemailer from 'npm:nodemailer@6.10.1';

const RELAY_SECRET = Deno.env.get('MAIL_RELAY_SECRET') ?? '';
const ALLOWED_HOSTS = new Set([
  'smtp.gmail.com',
  'smtp-relay.brevo.com',
  'smtp.office365.com',
  'smtp-mail.outlook.com',
  'smtp.zoho.com',
  'smtp.mail.yahoo.com',
  'smtp.sendgrid.net',
  'smtp.mailgun.org',
]);

function safeEqual(a: string, b: string) {
  if (!b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const isEmail = (s: unknown) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  if (!safeEqual(req.headers.get('x-relay-secret') ?? '', RELAY_SECRET)) return json(401, { ok: false });
  let b: any;
  try {
    b = await req.json();
  } catch {
    return json(400, { ok: false, error: 'bad json' });
  }
  const s = b?.smtp ?? {};
  const m = b?.mail ?? {};
  if (!ALLOWED_HOSTS.has(String(s.host)) || !s.user || !s.pass) return json(400, { ok: false, error: 'smtp config' });
  const port = Number(s.port) === 587 || Number(s.port) === 25 ? 465 : Number(s.port) || 465;
  const t = nodemailer.createTransport({
    host: s.host,
    port,
    secure: port === 465,
    auth: { user: String(s.user), pass: String(s.pass) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2', servername: s.host },
  });
  // {verify:true}: check the SMTP login without sending anything (used at server start).
  if (b?.verify === true) {
    try {
      await t.verify();
      return json(200, { ok: true, verified: true });
    } catch (e) {
      return json(502, { ok: false, error: (e as Error)?.message?.slice(0, 200) });
    }
  }
  if (!isEmail(m.to) || typeof m.subject !== 'string' || m.subject.length > 200) return json(400, { ok: false, error: 'mail' });
  if (String(m.html ?? '').length > 200_000 || String(m.text ?? '').length > 50_000) return json(413, { ok: false });
  try {
    const info = await t.sendMail({ from: String(m.from || s.user), to: m.to, subject: m.subject, html: m.html, text: m.text });
    return json(200, { ok: true, id: info.messageId });
  } catch (e) {
    console.error('relay failed', (e as Error)?.message);
    return json(502, { ok: false, error: (e as Error)?.message?.slice(0, 200) });
  }
});
