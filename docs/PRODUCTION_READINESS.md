# Production readiness audit

Historical September 11 assessment. See [the September 26 release audit](RELEASE_2026_09_26.md) for current changes and validation limits.

Audit date: 11 September 2026

## Current assessment

The project is suitable for a supervised mentor demonstration and, after environment setup and migration deployment, a small private pilot. It is not yet ready for an unrestricted public launch because notification delivery, monitoring, backups, browser-level end-to-end testing and operational policies still need production verification.

## Fixed in this pass

| Area | Improvement |
| --- | --- |
| Release security | Removed real environment files, service keys, dependencies, caches, build output and backup files from the release archive. |
| Delivery consistency | Moved delivery progress updates into one row-locked PostgreSQL function so pickup, claim and listing status changes are atomic. |
| PIN security | Replaced PostgreSQL `random()` for new delivery PINs with `pgcrypto` random bytes. Existing five-attempt locking remains enforced. |
| API performance | Reused pooled HTTP connections to Supabase rather than creating a new client for every request. |
| API resilience | Added a 15-second frontend timeout and one retry for idempotent GET requests. |
| Privacy | Removed unnecessary profile and listing queries from the platform impact endpoint. |
| Configuration | Separated frontend-visible variables from backend secrets and validated explicit HTTPS CORS origins in production. |
| Operations | Added a database readiness endpoint, container health check, non-root container user and CI workflow. |
| Admin UX | Added private feedback review directly to the Admin page. |
| Dependency security | Updated the lockfile; `npm audit --omit=dev` reports zero known vulnerabilities. |
| Quality | Frontend typecheck/lint/build and backend tests/compilation pass. |

## Required before a private pilot

1. Rotate the Supabase service-role key because a live key was present in the supplied archive.
2. Replace the local `.env` values after rotation; never copy them into a release ZIP.
3. Push migration `20260911000100_atomic_delivery_security.sql`.
4. Configure HTTPS frontend/backend URLs and exact CORS origin.
5. Restrict the Ola Maps browser key to the production domain.
6. Configure Supabase Auth site URL, redirect URLs and a production SMTP provider.
7. Test a complete donor → NGO → volunteer → PIN flow with three separate accounts.
8. Enable Supabase point-in-time recovery or scheduled backups and perform one restore test.
9. Connect application error monitoring and an uptime check for `/health/ready`.

## Remaining risks

| Priority | Risk | Recommended work |
| --- | --- | --- |
| P0 | No browser-level end-to-end suite | Add Playwright tests for signup, role separation, claim concurrency, delivery and PIN completion. |
| P0 | Notifications are polling-based | Add Supabase Realtime or push notifications with a durable notification table. |
| P0 | External food-photo URLs are unreliable | Upload validated images to Supabase Storage with size/type limits and signed transformations. |
| P0 | Limited operational visibility | Add structured logs, request IDs, error monitoring, uptime alerts and a deployment runbook. |
| P1 | Distance filtering happens in Python | Use PostGIS geography columns and an indexed radius query as data volume grows. |
| P1 | No scheduled expiry worker | Expire unsafe listings and unaccepted requests automatically. |
| P1 | Limited abuse controls | Add per-user/API rate limits, audit logs and admin suspension tools. |
| P1 | Accessibility not audited | Run keyboard, screen-reader and contrast testing. |
| P2 | Large map bundle | Lazy-load the map SDK and review bundle splitting. |

## Realistic schedule for one developer

| Target | Working time |
| --- | ---: |
| Mentor-ready demonstration | Already ready after configuration and smoke testing: 0.5–1 day |
| Small private pilot | 7–10 working days |
| Responsible public launch | 15–25 working days |

The private-pilot estimate includes E2E tests, production deployment, SMTP, Storage uploads, notifications, monitoring and backup verification. The public-launch estimate additionally includes abuse controls, privacy/data-retention work, accessibility, load testing and operational documentation.

## Recommended feature roadmap

1. In-app and push notifications for new donations, accepted deliveries and delivery status changes.
2. Supabase Storage photo upload with camera capture, compression and moderation.
3. Live volunteer tracking visible only during an active delivery.
4. Donor/NGO availability calendar and pickup time negotiation.
5. Automatic expiry alerts and safe-disposal guidance.
6. Admin analytics for fulfilment rate, average pickup time, failed deliveries and high-performing partners.
7. NGO demand profiles and rule-based matching by food type, capacity and distance.
8. Downloadable impact certificates for donors after completed deliveries.

Start with notifications, Storage uploads and E2E tests; they produce the largest reliability improvement for the least product complexity.
