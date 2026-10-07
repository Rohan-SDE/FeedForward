# Beta operations release

Apply `supabase/migrations/20261004000100_beta_operations.sql` once, after the previous migrations, then deploy the API and frontend from the production branch.

Existing profiles marked `verified=true` retain approval. Other donor/NGO accounts must request manual review using the form shown after login. New listings and claims are blocked by database triggers until approved. Revoking approval prevents new activity; existing deliveries remain accessible for safe resolution.

## Administrator access

Use an existing administrator account. If none exists, the Supabase project owner can grant access to a trusted existing Auth user in SQL Editor. Replace the UUID below with that account's exact ID from Authentication > Users; never use a client-facing role picker to grant admin.

```sql
BEGIN;
INSERT INTO public.user_roles(user_id,role)
VALUES ('REPLACE_WITH_AUTH_USER_UUID'::uuid,'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.admin_users(user_id)
VALUES ('REPLACE_WITH_AUTH_USER_UUID'::uuid) ON CONFLICT DO NOTHING;
COMMIT;
```

Sign out and in, then open `/admin`. Review applicant details and contact information, enter findings, and approve or reject. This is platform approval, not government identity or registration certification. Review changes retain the latest decision and reviewer; they are not a complete application-version history.

## User-visible changes

- Donors see Nearby NGOs navigation instead of Nearby food. NGOs retain Nearby food.
- Food search calculates distance before rounding displayed coordinates, excludes full/unapproved listings, shows loading/errors and retry, and excludes unknown distances from radius filtering.
- NGO order tracking exposes cancellation until physical collection, even after rider assignment. Collected deliveries require administrator assistance.
- NGO food reviews are visible to their donor and administrators. Other reviews remain administrator-only, including all donor/rider-authored reviews.
- History shows dated listing, claim and delivery records, including cancelled records. This is record history, not every state-transition event.
- Support provides private in-app ticket conversations for each user and a shared admin inbox, with open/in-progress/resolved states. Replies are shown in the app; no email delivery is claimed.
- Tracking offers a Google Maps link to the latest reported rider position. Google Maps does not auto-refresh that external link; the in-app map continues polling. Browser GPS limitations remain.

## Smoke test

1. Pending donor cannot post and pending NGO cannot claim, including direct API calls.
2. Administrator reviews both; they can then post and claim.
3. NGO cancels after rider acceptance but before collection; rider becomes free and quantities reconcile.
4. Completed NGO food review appears in the donor History section; rider-authored review does not.
5. Support tickets cannot be read or replied to by a different account; admin response appears to the requester.
6. Check nearby food with saved coordinates, missing coordinates, radius filters and a temporary network failure.
7. Check History date filters and Google Maps position links on mobile.

The list endpoints are bounded by backend/provider limits; this release is intended for beta volumes. Full archive pagination and a complete audit of application review revisions are follow-up work.
