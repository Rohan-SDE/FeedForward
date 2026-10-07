# Release verification — 28 September 2026

## Executed and passed

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript and ESLint (`npm run check`) | Passed | Application and test source |
| Backend pytest | 50 passed | API, configuration, photo processing, gateway error handling and maintenance behavior; upstream HTTP calls mocked |
| Database tests | 22 passed | All 13 migrations applied; RLS, roles, quotas, workflow transitions, cancellation, PIN, expiry and nearby notifications exercised in single-session PGlite |
| Playwright | 8 passed | Desktop/mobile public UI, 3D pause/reduced motion, signup role options/password requirement, password-reset entry |
| Production build | Passed | Nitro Node server preset |
| Node production SSR smoke | Passed during release development | Homepage renders, private/no-store and frame-denial headers present |
| npm production audit | 0 known vulnerabilities | `npm audit --omit=dev`; evidence JSON included |
| Python dependency audit | 0 known vulnerabilities | `pip-audit -r backend/requirements.txt`; evidence JSON included |

Python tests emit two dependency deprecation warnings for the HTTPX TestClient adapter and AnyIO portal alias. They do not fail the tests. FastAPI, Starlette, python-dotenv and pytest were upgraded to address findings from the earlier audit.

Visual inspection of desktop and 375-pixel mobile screenshots confirmed the 3D scene renders without horizontal overflow. The browser tests also caught early clicks before client hydration; the affected controls are now disabled until their handlers are ready.

## Not executed here

- Docker container builds and Compose/TLS startup: Docker is unavailable in this workspace. CI configuration includes container build jobs.
- Real PostgreSQL parallel-client concurrency test: CI configuration includes PostgreSQL 17 and a simultaneous-claim test, but that CI job has not run here.
- Live Supabase Auth, SMTP, Storage API, redirects, real account recovery, complete authenticated browser delivery flow and production RLS under your existing project configuration.
- Hosting load/capacity testing, external uptime alert delivery, backup/PITR configuration and restore drill.

The database fixtures approximate Supabase auth/storage schemas. PGlite is real PostgreSQL compiled to WebAssembly, but its single-session tests are not proof of multi-client concurrency or the full Supabase stack. Browser tests cover public screens; they do not constitute authenticated end-to-end testing.

The supplied code and deployment configuration are a substantially hardened release candidate. Production approval still depends on the environment-specific acceptance steps in DEPLOYMENT.md. No real user data, cloud account settings or live database were modified in this work.
