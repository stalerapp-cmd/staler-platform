#!/usr/bin/env bash
# Local development: both APIs against a local PostgreSQL (see docs/DEVELOPMENT.md).
export SHARED_EXCHANGE_TOKEN="dev-exchange-token-0123456789abcdef0123456789"
export SHARED_WEBHOOK_SECRET="dev-webhook-secret-0123456789abcdef0123456789"
bank_env() {
  env NODE_ENV=development PORT=4000 DATABASE_URL="${BANK_DATABASE_URL:-postgres://postgres@127.0.0.1:5433/talerbank_dev}" DB_SSL=disable \
    JWT_SECRET=dev-bank-jwt-secret-0123456789abcdef ENCRYPTION_KEY=$(printf 'b%.0s' {1..32} | base64) \
    EXCHANGE_API_TOKEN=$SHARED_EXCHANGE_TOKEN WEBHOOK_SECRET=$SHARED_WEBHOOK_SECRET STALER_WEBHOOK_URL=http://127.0.0.1:5000/api/bank/webhook \
    BANK_ADMIN_EMAIL=admin@talerbank.local BANK_ADMIN_PASSWORD='Bank!Admin#2026' SIGNUP_BONUS=1000 MAIL_MODE=log PUBLIC_URL=http://localhost:4000 \
    CORS_ORIGINS=http://localhost:5174 WEB_DIST_DIR=../bank-web/dist "$@"
}
staler_env() {
  env NODE_ENV=development PORT=5000 DATABASE_URL="${STALER_DATABASE_URL:-postgres://postgres@127.0.0.1:5433/staler_dev}" DB_SSL=disable \
    JWT_SECRET=dev-staler-jwt-secret-0123456789abcdef ENCRYPTION_KEY=$(printf 's%.0s' {1..32} | base64) \
    EXCHANGE_API_TOKEN=$SHARED_EXCHANGE_TOKEN WEBHOOK_SECRET=$SHARED_WEBHOOK_SECRET BANK_API_URL=http://127.0.0.1:4000 BANK_PUBLIC_URL=http://localhost:4000 \
    ADMIN_EMAIL=admin@staler.local ADMIN_PASSWORD='Staler!Admin#2026' MAIL_MODE=log PUBLIC_URL=http://localhost:5000 \
    CORS_ORIGINS=http://localhost:5173 WEB_DIST_DIR=../staler-web/dist RECONCILE_INTERVAL_MS=30000 "$@"
}
