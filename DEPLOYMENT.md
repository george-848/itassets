# AssetVault IT — Multi-Tenant SaaS Deployment Guide

## 1. Architecture & Firebase Starter Tier Notes

- **Firebase Project**: `carbon-minutia-470404-m5` (Google-hosted **Starter Tier**)
- **Firestore Database**: `ai-studio-assetvaultit-cf274ac0-bca0-4c24-86d5-b1fcba1aa648` (`firebase-applet-config.json`)
- **Firestore Security Rules**: Enforced via `/firestore.rules` with tenant/org isolation, `isSuperAdmin()` override, and owner/membership checks.
- **Starter Tier Constraint**: Do **not** configure `firebase-admin` Firestore or Firebase Auth IAM Admin calls against `carbon-minutia-470404-m5` (Starter Tier denies IAM/admin SDK calls with `7 PERMISSION_DENIED`). Client-side Firebase SDK initialization is handled in `src/lib/firebase.ts`, while the Express backend (`server/*`) handles multi-tenant APIs, RBAC, Paystack billing, and SQLite/MongoDB Atlas persistence.

## 2. Environment Variables & Secret Manager

Configure all production secrets via Cloud Run Secret Manager or your deployment secret store (never commit real values to git):

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public HTTPS origin (used for Paystack redirect callbacks & GitHub OAuth) |
| `SESSION_SECRET` | Minimum 32-char HMAC secret for `av_session` tokens and OAuth state |
| `MONGODB_URI` / `MONGODB_DB_NAME` | Production MongoDB Atlas cluster URI (falls back to persistent SQLite `./data/` if omitted) |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | Live or test Paystack GH₵ keys (`sk_live_...` / `sk_test_...`). Without `PAYSTACK_SECRET_KEY`, billing runs in explicit `test_simulation` mode |
| `CRON_SECRET` | Shared secret verified on `X-Cron-Secret` header for `POST /api/jobs/run` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Outbound transactional SMTP for workspace invites and password resets |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional GitHub OAuth credentials |
| `SUPER_ADMIN_INITIAL_PASSWORD` | Override initial seed password for `georgearthur848@gmail.com` |

## 3. Cloud Run Container Deployment

```bash
# Build and push container image
gcloud builds submit --tag gcr.io/carbon-minutia-470404-m5/assetvault-it

# Deploy to Cloud Run on port 3000
gcloud run deploy assetvault-it \
  --image gcr.io/carbon-minutia-470404-m5/assetvault-it \
  --platform managed \
  --region europe-west1 \
  --port 3000 \
  --allow-unauthenticated \
  --set-env-vars APP_URL=https://your-service-url.run.app,MONGODB_DB_NAME=assetvault_it \
  --set-secrets SESSION_SECRET=assetvault-session-secret:latest,PAYSTACK_SECRET_KEY=paystack-secret:latest,CRON_SECRET=assetvault-cron-secret:latest
```

## 4. Paystack GH₵ Webhook Configuration

1. In your **Paystack Dashboard** -> **Settings -> API Keys & Webhooks**, set the Webhook URL to:
   `https://<YOUR_APP_URL>/api/billing/paystack/webhook`
2. Paystack signs each webhook payload with `X-Paystack-Signature` (HMAC-SHA512 using `PAYSTACK_SECRET_KEY`).
3. `POST /api/billing/paystack/webhook` validates the signature via timing-safe comparison and records `processedWebhookRefs` for idempotent subscription activation (`active`), period extension, and invoice generation.

## 5. Automated SLA Breach, Warranty & Contract Expiry Sweep

Schedule **Google Cloud Scheduler** (every 15 minutes) to invoke the compliance sweep endpoint with `CRON_SECRET`:

```bash
gcloud scheduler jobs create http assetvault-compliance-sweep \
  --schedule="*/15 * * * *" \
  --uri="https://<YOUR_APP_URL>/api/jobs/run" \
  --http-method=POST \
  --headers="X-Cron-Secret=<CRON_SECRET>"
```

This checks open helpdesk tickets against SLA `firstResponseDueAt` / `resolutionDueAt`, flags `slaBreached`, increments `escalationLevel`, and logs warranty/licence/contract expiry reminders.

## 6. Dedicated Enterprise Tenant Topology

Tenants on the **Enterprise** plan (`deploymentMode: "dedicated_enterprise"`) support configurable isolation metadata in the Platform Super Admin Console:
- `dedicatedConfig.dedicatedProjectId`
- `dedicatedConfig.dedicatedRegion`
- `dedicatedConfig.customDomain`
- `dedicatedConfig.isolationTier`: `"dedicated_schema"` or `"dedicated_cluster"`

For single-tenant isolated deployments, deploy a dedicated Cloud Run service + dedicated MongoDB database (`MONGODB_DB_NAME=assetvault_enterprise_<slug>`) + custom domain mapping pointing to that container.
