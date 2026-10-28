# Local development

Requirements: Node.js 22, PostgreSQL 15+ (or Docker).

```bash
# 1. a local database on port 5433
docker run -d --name taler-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 5433:5432 postgres:16
createdb -h 127.0.0.1 -p 5433 -U postgres talerbank_dev
createdb -h 127.0.0.1 -p 5433 -U postgres staler_dev

# 2. install
for a in bank-api staler-api bank-web staler-web; do (cd apps/$a && npm ci); done

# 3. run the APIs (development env from scripts/dev-env.sh; e-mail codes are printed to the console)
source scripts/dev-env.sh
(cd apps/bank-api   && bank_env npm run dev) &
(cd apps/staler-api && staler_env npm run dev) &

# 4. run the web apps with hot reload
(cd apps/bank-web   && npm run dev)   # http://localhost:5174  (proxies /api to :4000)
(cd apps/staler-web && npm run dev)   # http://localhost:5173  (proxies /api to :5000)
```

Development admins: `admin@talerbank.local` / `Bank!Admin#2026` and `admin@staler.local` / `Staler!Admin#2026` (development only; `SIGNUP_BONUS=1000` gives new bank customers test money).

## Tests
```bash
(cd apps/bank-api   && npm test)   # creates talerbank_test from the legacy schema fixture
(cd apps/staler-api && npm test)   # creates staler_test (legacy) + talerbank_e2e and spawns a real bank
(cd apps/bank-web   && npm test)
(cd apps/staler-web && npm test)
```
The API tests expect PostgreSQL at `postgres://postgres@127.0.0.1:5433` (override with `TEST_DATABASE_URL_*`).

## Android on your machine
```bash
cd apps/staler-web
VITE_API_URL=https://s-taler.onrender.com npm run build:native
npx cap add android && node ../../scripts/android/prepare.mjs . taler
npx @capacitor/assets generate --android
npx cap sync android && npx cap open android   # Android Studio
```
For TalerBank use `apps/bank-web`, scheme `talerbank` and `BANK_API_URL`'s value.

## Layout
```
apps/bank-api      TalerBank REST API, migrations (src/db/migrations), tests
apps/staler-api    S-Taler REST API, migrations, end-to-end tests
apps/bank-web      TalerBank web + Android (React, Tailwind, framer-motion, Capacitor)
apps/staler-web    S-Taler web + Android
scripts/           dev environment, Android hardening
.github/workflows  CI, Android APKs, CodeQL
render.yaml        Render Blueprint
```
