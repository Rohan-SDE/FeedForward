# Google registration for riders

New riders must use Continue with Google, then select Rider during profile onboarding.
Donor and NGO accounts retain email/password and Google registration. Existing rider
accounts are preserved; this change does not revoke existing sessions or remove their
password login.

Deployment:
1. Apply supabase/migrations/20261012000100_google_rider_registration.sql through the
   Supabase SQL Editor or your normal migration workflow.
2. Deploy the updated backend and frontend from the production branch.

The database trigger enforces the requirement on signup metadata and direct role
inserts/updates. The API checks Supabase-verified identities and gives a clear error
for email-only rider registration. Contact phone and optional organisation fields
remain in Profile.
