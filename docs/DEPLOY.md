# Deployment

## 1. Supabase (existing database)
Both services use the **same** Supabase database: S-Taler in schema `public`, TalerBank in schema `talerbank`. On start each service runs its migrations, which upgrade the old tables in place (additive, idempotent).

1. **Rotate the database password**: Project Settings → Database → Reset database password.
2. **Back up**: Database → Backups (or `pg_dump`) before the first deploy.
3. **Connection string**: Project → Connect → **Session pooler** (port `5432`), e.g.
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   Do not use the direct `db.<ref>.supabase.co` host on Render (it is IPv6-only). Avoid the transaction pooler (`6543`): the migrations use advisory locks.
4. Keep `DB_SSL=require`.

## 2. Render (web)
Render → New → **Blueprint** → select the repository. `render.yaml` creates:

| Service | Serves | Start |
|---|---|---|
| `talerbank` | TalerBank API + web app | `apps/bank-api/dist/server.js` |
| `s-taler` | S-Taler API + web app | `apps/staler-api/dist/server.js` |

The env group `taler-shared` generates `EXCHANGE_API_TOKEN` and `WEBHOOK_SECRET` once and gives the same values to both services. `JWT_SECRET` and `ENCRYPTION_KEY` are generated per service.

Values you are asked for (if the final `onrender.com` names differ, use the real ones):

| Variable | talerbank | s-taler |
|---|---|---|
| `DATABASE_URL` | Supabase session-pooler URL | same URL |
| `PUBLIC_URL` | `https://talerbank.onrender.com` | `https://s-taler.onrender.com` |
| `STALER_WEBHOOK_URL` | `https://s-taler.onrender.com/api/bank/webhook` | — |
| `BANK_API_URL` | — | `https://talerbank.onrender.com` |
| `BANK_ADMIN_EMAIL` / `BANK_ADMIN_PASSWORD` | first bank admin | — |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | first S-Taler super admin |
| `LEGACY_ENCRYPTION_KEY` | — | `ENCRYPTION_KEY` of the old S-Taler server (leave empty if unknown) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | e.g. Gmail: `smtp.gmail.com`, your address, an [app password](https://support.google.com/accounts/answer/185833), `TalerBank <you@gmail.com>` | same |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | — | optional, for storing product files in Supabase Storage |

After the first deploy:
- open `https://<service>/health` — it should say `ok`;
- sign in as admin, change the password, enable two-step verification;
- in TalerBank → Bank settings, decide whether new accounts are allowed;
- the free plan sleeps after inactivity; the first request then takes ~1 minute.

Moving a service later (custom domain): update its `PUBLIC_URL`, the other service's `BANK_API_URL` / `STALER_WEBHOOK_URL`, and the GitHub variables below, then rebuild the APKs.

## 3. Android
The **Android APKs** workflow runs on every push to `main` and on tags `v*`.

1. Repository → Settings → Secrets and variables → Actions → **Variables**:
   - `STALER_API_URL` = `https://s-taler.onrender.com`
   - `BANK_API_URL` = `https://talerbank.onrender.com`
   These are baked into the apps (and into their Content-Security-Policy). Without them the workflow falls back to those two addresses and prints a warning.
2. Download: Actions → latest "Android APKs" run → **Artifacts** → `s-taler-apk`, `talerbank-apk`. The debug APKs install directly ("allow unknown apps").
3. <a id="android"></a>Signed release APKs (optional, needed for Play Store and for updates without uninstalling):
   ```bash
   keytool -genkeypair -v -keystore release.jks -alias taler -keyalg RSA -keysize 4096 -validity 10000
   base64 -w0 release.jks   # macOS: base64 -i release.jks
   ```
   Add **Secrets**: `ANDROID_KEYSTORE_BASE64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`taler`), `ANDROID_KEY_PASSWORD`. Keep `release.jks` safe and out of the repository — losing it means users must reinstall.
4. Publish a release: `git tag v1.0.0 && git push origin v1.0.0` → the APKs and their SHA-256 sums appear under Releases.

The Android project is generated in CI (`npx cap add android`) and hardened by `scripts/android/prepare.mjs` (HTTPS only, no backups, `FLAG_SECURE`, camera permission for QR scanning, `taler://` / `talerbank://` deep links). App icons and splash screens come from `apps/*/assets`.
