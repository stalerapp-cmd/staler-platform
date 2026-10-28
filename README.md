# S-Taler + TalerBank

محفظة رقمية (**S-Taler**) وبنك (**TalerBank**) مربوطين ببعض، مع تطبيق ويب وتطبيق أندرويد لكل واحد منهم.
A digital wallet (**S-Taler**) and a bank (**TalerBank**) wired to each other, each with a web app and an Android app.

| | S-Taler | TalerBank |
|---|---|---|
| API | `apps/staler-api` (Express + TypeScript) | `apps/bank-api` (Express + TypeScript) |
| Web / Android | `apps/staler-web` (React + Capacitor) | `apps/bank-web` (React + Capacitor) |
| Database | Supabase, schema `public` | same database, schema `talerbank` |
| Android id | `ps.staler.wallet` | `ps.talerbank.app` |

---

## بالعربي — خطوات التشغيل

### 1) قبل أي شي: أمان قاعدة البيانات
- **غيّري كلمة سر قاعدة بيانات Supabase** (Project Settings → Database → Reset password)، لأنها انكتبت بمحادثات قديمة. الكلمة الجديدة بتنحط بس كمتغير بيئة على Render، ولا مرة بالكود.
- خذي نسخة احتياطية (Database → Backups) قبل أول تشغيل، لأنه أول تشغيل بيرقّي الجداول القديمة تلقائيًا (بيضيف جداول وأعمدة وقيود، وبيمسح كلمات سر البنك اللي كانت S-Taler مخزنتها — هاي كانت ثغرة).

### 2) ارفعي المشروع على GitHub
```bash
unzip staler-platform.zip && cd staler-platform
git init -b main && git add -A && git commit -m "S-Taler + TalerBank"
git remote add origin https://github.com/<user>/staler-platform.git
git push -u origin main
```
أول ما ينرفع، GitHub Actions بيشتغل لحاله:
- **Android APKs** ← بيطلع `s-taler-debug.apk` و `talerbank-debug.apk` (من تبويب Actions ← آخر تشغيل ← Artifacts).
- **CI** ← بيشغّل 75 اختبار تكامل على Postgres حقيقي + اختبارات الواجهات + فحص الثغرات بالمكتبات + فحص تسريب أسرار.

حتى يحكي التطبيق مع سيرفرك الصحيح، حطي بـ Settings → Secrets and variables → Actions → **Variables**:
- `STALER_API_URL` = رابط S-Taler على Render (مثل `https://s-taler.onrender.com`)
- `BANK_API_URL` = رابط TalerBank على Render

للنسخة الموقّعة (Release) ضيفي هدول كـ **Secrets** (اختياري): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` — التفاصيل في [docs/DEPLOY.md](docs/DEPLOY.md#android).
لما تعملي tag مثل `v1.0.0` بيطلعوا الـ APKs بصفحة Releases.

### 3) الويب على Render
Render → New → **Blueprint** → اختاري الـ repo. ملف `render.yaml` بيعمل خدمتين (`talerbank` و `s-taler`) وبيولّد الأسرار المشتركة لحاله، وبيسألك بس عن:
`DATABASE_URL` (رابط الـ **pooler** من Supabase، مش الرابط المباشر)، `PUBLIC_URL`، `BANK_API_URL`، `STALER_WEBHOOK_URL`، حسابات المدير، وإعدادات البريد (SMTP).
الشرح الكامل خطوة بخطوة: [docs/DEPLOY.md](docs/DEPLOY.md).

### 4) ربط البنك بالمحفظة
- من **TalerBank ← التطبيقات المرتبطة** اعملي رمز ربط، واكتبيه بـ **S-Taler ← البنك ← الربط برمز**. التطبيق ما بيشوف كلمة سر البنك أبدًا.
- أو من **TalerBank ← إرسال إلى S-Taler**: اعملي كود QR، امسحيه من S-Taler، وأكّدي من البنك. المصاري ما بتتحرك إلا بعد تأكيدك.
- الروابط القديمة اللي كانت مخزّنة بكلمة سر انمسحت لأسباب أمنية؛ كل مستخدم بيعيد الربط مرة وحدة.

---

## English — quick start

1. **Rotate the Supabase database password** (it appeared in old chats) and take a backup. The first start upgrades the old tables in place.
2. Push to GitHub → the **Android APKs** workflow builds both APKs (Actions → run → Artifacts). Set repository variables `STALER_API_URL` / `BANK_API_URL` so the apps talk to your servers.
3. Render → New → **Blueprint** → this repo. Fill in the prompted values (see [docs/DEPLOY.md](docs/DEPLOY.md)).
4. Link the apps with a one-time link code (TalerBank → Linked apps) or a withdrawal QR (TalerBank → Send to S-Taler).

Local development: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Security model: [SECURITY.md](SECURITY.md).

## What's inside

**S-Taler** — wallet with animated balance and cash-flow chart, send by wallet ID, e-mail or QR, payment-request QR codes, bank top-up (link code or withdrawal QR) and pay-out to the bank, marketplace with escrowed orders and digital goods, merchant dashboard, encrypted messages, exchange vouchers, notifications, two-step verification with recovery codes, device list, admin console with reserves reconciliation (every wallet unit backed by the exchange account at TalerBank), Arabic/English (RTL), light/dark.

**TalerBank** — current accounts with Palestinian IBANs (mod-97 checked), transfers by IBAN/account/@username with limits, statements with filters and CSV export, payment-request QR codes, Taler-style withdrawal operations to S-Taler, scoped and revocable app links, wire gateway for the exchange, two-step verification, admin console (customers, freeze/suspend, teller desk, ledger, exchange reserves, audit log, maintenance mode).

## Tests

```
apps/bank-api     45 integration tests  (legacy schema upgrade, auth, MFA, ledger races, links, wire gateway, admin)
apps/staler-api   30 end-to-end tests   (spawns a real TalerBank: linking, QR withdrawal, deposits, escrow, webhooks, reconciliation)
apps/*-web        unit tests            (amount parsing, QR routing, translations)
```
