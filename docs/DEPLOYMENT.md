# FeedForward deployment and operations

This release contains the application, production container configuration and automated checks. It has not been deployed to your Supabase project or hosting account. Passing local tests does not verify your authentication settings, email provider, real Storage permissions, backups or infrastructure capacity.

## What changed

- CSS 3D food crate: responsive layout, pause control and reduced-motion support.
- Database-enforced roles, transactional cancellation, null-safe delivery ownership and protected workflow mutations.
- Consistent listing locks and status reconciliation: scheduling one partial claim does not hide remaining food.
- Failed PIN handovers never return collected food to available inventory.
- Server-only photo uploads: 5 MB limit, JPEG/PNG/WebP decoding, 16-megapixel limit, resizing, JPEG re-encoding and metadata removal. SVG is rejected. A database registry prevents new listings attaching arbitrary external URLs. Legacy URLs remain unchanged.
- Public food-photo bucket with restrictive client-write policy. The donation UI explains public visibility. Do not upload personal documents or faces.
- Database-backed hourly quotas: 60 successful inserts per user per table for listings/claims/pickups/feedback; 20 photo upload reservations. Failed transactions roll back insert counters. Edge limits protect the API; Supabase Auth limits must also be configured.
- Repeatable expiry worker, bounded batches, heartbeat health check, retained collected quantities and audit events.
- Password recovery, 12-character signup/reset UI requirement, and cleared cached account data on sign-in/out. Set the same password requirement in Supabase; UI validation alone is not enforcement.
- Request IDs, bounded bodies, sanitized API errors, exact HTTPS origins, bounded API concurrency and photo decoding, SSR cache/security headers.
- Non-root application containers, API/worker health checks, Caddy HTTPS, nginx limits and CI jobs.

## 1. Protect and configure the project

Back up your current code and database. This source builds on the September 11 saved project plus the work in this conversation. Compare any newer local changes before replacing your folder.

Create a separate staging Supabase project. In its Auth settings configure:

- Site URL: your staging HTTPS origin.
- Redirect allowlist: that origin and `https://YOUR_DOMAIN/auth` for recovery.
- Email confirmation, production SMTP, password minimum 12, and provider abuse limits.
- Test signup, confirmation, reset and sign-out with real inboxes. A reset link must open the new-password form.

Use only the publishable key in the frontend. The service-role/secret key belongs only on the backend. Rotate previously exposed keys. Never paste keys into a support chat or commit them.

## 2. Run local checks

From the extracted `meal-link-loop-main` folder, using Node 22 and Python 3.12:

```powershell
npm ci
npm run check
npm run test:db
npx playwright install chromium
npm run test:browser
npm run build
cd backend
py -3.12 -m venv .venv
& .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest tests -q
cd ..
```

`test:db` defaults to single-session PGlite with simplified Supabase auth/storage fixtures. It tests PostgreSQL functions and RLS, not the complete Supabase service or simultaneous transactions. CI also defines a disposable PostgreSQL 17 job and a simultaneous-claim check. The test database must be named `feedforward_test`; never give this test a production database URL.

## 3. Apply migrations to staging

```powershell
npx supabase login
npx supabase link --project-ref YOUR_STAGING_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Apply every pending migration in order, including:

- `20260926000100_workflow_boundary.sql`
- `20260926000200_production_operations.sql`

The second migration creates the photo bucket and registry, quotas/audit, workflow wrappers and expiry function. Keep `feedforward_private` out of Supabase's exposed schemas. It deliberately revokes access to underlying workflow functions. Deploy the new API alongside these migrations: old cancellation code is incompatible with the tighter table permissions.

Existing records are not rewritten. New numeric constraints use `NOT VALID` so they enforce new writes without aborting on old data; inspect and repair legacy violations before validating them on production. If the food-photos bucket already exists, this migration changes it to the public, JPEG-only application bucket; inspect existing contents first.

## 4. Deploy the supplied container stack

Requires Docker Engine with Compose, a Linux server, a domain pointed to that server, and inbound ports 80/443. Supabase remains managed externally.

```powershell
Copy-Item .env.production.example .env.production
notepad .env.production
```

Set the real domain, project URL, publishable key, backend secret key and domain-restricted map key. Use a staging domain first. On Linux, restrict this file to its owner (`chmod 600 .env.production`).

```sh
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml up -d --build
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 api maintenance
```

Only Caddy publishes ports. Do not publish nginx, API or frontend ports. Caddy obtains certificates; nginx forwards API and frontend requests and limits API traffic. The gateway trusts private-network forwarding headers because its only external entry is Caddy; review that trust configuration if your network topology changes. Stop/replace the stack through Compose rather than exposing the development server.

Build-time frontend variables require rebuilding the frontend when changed. Backend secret changes require container recreation. Containers use version-family base tags; record or pin reviewed image digests in your release process and rerun CI when updating them.

Verify `https://YOUR_DOMAIN/` and `https://YOUR_DOMAIN/health/ready`. Readiness checks the new photo-registry table, so a missing operations migration prevents a healthy API. The worker runs each minute and becomes unhealthy if no successful cycle has occurred for three minutes.

## 5. Live acceptance gate

Use donor, NGO, volunteer, unrelated volunteer and admin accounts:

1. Register and confirm email; request a password reset; verify the new password and old-session logout behavior.
2. Upload a food photo, post a donation, and check the NGO can see it. Reject a renamed SVG, oversized upload and another donor's photo URL.
3. Claim part of a listing, schedule it, and claim the remainder from a second NGO.
4. Race two claims exceeding the remaining quantity, and race two volunteers accepting one pickup. Exactly one competing operation should succeed.
5. Check notifications, assignment and both navigation legs with real addresses.
6. Reject unrelated delivery updates; verify only the receiving NGO can read the PIN.
7. Complete collection and correct PIN handover. Retrying must create only one impact record.
8. Try five incorrect PINs on a separate collected order. It must fail without making collected food available again.
9. Cancel an uncollected claim twice and verify quantity is released once. Test expiry both before and after collection.
10. Check feedback is visible only to admin; verify direct REST writes cannot bypass permissions.
11. Run the CI PostgreSQL/concurrency and container jobs, then load-test your actual deployment before selecting a user/traffic limit.

## 6. Monitoring, backups and failure handling

- Configure an external uptime monitor for `/health/ready`, and alerts on API 5xx/429 rates and maintenance container health. The code supplies logs and health checks; it does not create an alerting-provider account or contact recipients.
- Retain the request ID when reporting errors. Never include bearer tokens, PINs or service keys in logs/tickets.
- Enable managed database backups/PITR according to your recovery requirements. Separately back up Storage objects; database recovery alone does not restore image bytes. Test a restore into an isolated project and record recovery time and recovered data timestamp.
- Inspect `workflow_audit` as admin for status transitions. It stores actor IDs and statuses, never delivery PIN values. Establish retention with your operator; no automatic audit deletion is configured.
- Failed collected deliveries require operational resolution. Do not manually increase available food quantity for food that has already left the donor.
- Uploaded photos abandoned before listing creation are retained. Review unreferenced `food_photos` entries and remove objects through the Storage API as part of a controlled retention job; do not delete Storage metadata directly.
- New-food notifications match NGO service radius, with a city fallback when coordinates are missing. Ask users to save a location or city. Polling remains; measure load before expansion. Push notifications and PostGIS scaling are not implemented in this release.

## Release and rollback

Record the exact source archive hash, applied migration list, container digests and test results. Deploy to staging first. Take a backup before production migration. A migration error inside its transaction rolls back. After a successful migration, prefer a reviewed forward fix: reverting application code alone can conflict with the new permissions. Never restore unsafe grants simply to make the old API work. Keep the previous source and a verified backup as recovery inputs.

## References

- Supabase migration workflow: https://supabase.com/docs/guides/local-development/cli-workflows
- Supabase password recovery: https://supabase.com/docs/guides/auth/passwords
- Supabase production checklist: https://supabase.com/docs/guides/deployment/going-into-prod
- Docker Compose environment files: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
