# Security model

## Reporting
Report vulnerabilities privately to the maintainers (GitHub → Security → "Report a vulnerability"). Do not open public issues for security problems.

## Holes fixed from the previous version
| Old behaviour | Now |
|---|---|
| Registration accepted `role` from the request (anyone could become admin/exchange) | Strict zod schemas reject unknown fields; roles are server-assigned |
| `/exchange/claim` let anyone pull money from an exchange wallet | Escrowed, single-use vouchers (`taler://exchange-claim?v=id.secret`, secret stored as a hash) |
| Balance updates were read-modify-write → double-spending under parallel requests | Atomic double-entry moves, row locks in a fixed order, `CHECK (balance >= 0)` in the database, idempotency keys; tested with 30–40 parallel spends |
| S-Taler stored users' bank passwords | Erased by migration; linking uses one-time link codes → scoped, revocable, hashed API tokens |
| New password stored in plaintext while waiting for confirmation | Removed; only hashes are stored |
| QR bank withdrawal credited the wallet before the bank confirmed | Wallet is credited only by a signed bank webhook or the reconciler, exactly once |
| Merchants could delete other merchants' products; digital file URLs were public | Ownership checks on every merchant route; files served only to buyers through `/files/:id` |
| CORS `*` | Exact origin allow-list (plus the Android app origins) |
| Published default admin password in the old TalerBank SQL | Detected and replaced on start; admin comes from environment variables |

## Controls
- **Passwords**: Argon2id; legacy bcrypt hashes verified once then upgraded. Policy: 10+ chars, mixed case, digit, symbol. Account lockout after 5 failures; constant-time comparisons; no account enumeration.
- **Sessions**: 10-minute HS256 access tokens with pinned algorithm/issuer/audience (the two apps cannot accept each other's tokens). Rotating refresh tokens; replaying an old one revokes the whole session family. Web: `HttpOnly; Secure; SameSite=Strict` cookie (`__Host-` prefix in production) + anti-CSRF header. Android: refresh token in Capacitor Preferences, never a cookie. `token_version` lets "sign out everywhere", password changes and suspensions take effect immediately. Idle sign-out in the apps (10 min bank, 20 min wallet).
- **Two-step verification**: RFC 6238 TOTP with replay protection and single-use recovery codes; required for money movement once enabled.
- **Data at rest**: AES-256-GCM with key ids and associated data (messages are bound to their conversation); one-time codes are HMAC-hashed. Key rotation via `ENCRYPTION_KEY_PREVIOUS`.
- **Database**: all tables have Row Level Security enabled and the `anon`/`authenticated` Supabase roles have no grants, so the public Supabase API cannot read them; only the server's own connection can. Migrations are idempotent, checksummed and serialized with an advisory lock.
- **HTTP**: helmet with a strict CSP, HSTS, no `X-Powered-By`, JSON body limits, rate limits (login, codes, money routes), JSON 404s, no stack traces, redacted structured logs. CSV exports neutralise spreadsheet formulas.
- **Bank ↔ wallet**: webhooks are HMAC-SHA256 signed with timestamp and replay window; the exchange uses a separate bearer token for the wire gateway; a reconciler resolves operations whose outcome was unknown; the admin console proves that wallet balances equal the exchange account at the bank.
- **Android**: HTTPS only (no cleartext, network security config), `allowBackup=false`, `FLAG_SECURE` (no screenshots / recents previews), WebView debugging off, own CSP baked into the bundle that only allows the configured API.
- **Supply chain**: exact dependency versions with lockfiles, `npm audit` (production deps) in CI, Dependabot, CodeQL (public repos), gitleaks secret scanning.

## Operator checklist
- Rotate the Supabase database password if it was ever shared; keep it only in Render's environment.
- Back up `ENCRYPTION_KEY` of both services — data encrypted with it cannot be read without it.
- Use real SMTP in production (`MAIL_MODE=smtp`); `log` prints codes to the server log.
- Never put `SUPABASE_SERVICE_KEY`, `DATABASE_URL` or any secret into the web or Android app; only `VITE_API_URL` is public.
- Enable two-step verification on the admin accounts right after the first sign-in and change the bootstrap password.
