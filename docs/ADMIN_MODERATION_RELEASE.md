# Administrator moderation update

## Release order

This branch builds on `production/hardening-3d-20260928` at `7ca322e`.

1. In Supabase SQL Editor, run **only** `supabase/migrations/20261004000200_admin_moderation.sql` once. It runs in a transaction and preserves existing approvals, tickets and conversations. Do not rerun the older beta-operations migration.
2. Verify the new database objects with the read-only query below.
3. Merge this update into `production/hardening-3d-20260928`, then deploy that commit for both `feedforward-api` and `feedforward-web` in Render.
4. Refresh the site and test using separate admin and participant accounts.

Apply the migration before deploying the API: every authenticated request now checks the restriction function. Deploying the API first would cause authenticated requests to fail until the migration exists. The existing deployed API remains compatible with this additive migration.

```sql
SELECT
 to_regclass('public.account_restrictions') IS NOT NULL AS restrictions_table,
 to_regclass('public.moderation_actions') IS NOT NULL AS action_history,
 to_regprocedure('public.account_is_blocked(uuid)') IS NOT NULL AS block_check,
 to_regprocedure('public.moderate_account(uuid,text,text,timestamp with time zone,uuid)') IS NOT NULL AS moderation_function;
```

All four results should be true. If execution reports an error, save the error and stop; do not delete tables to retry.

## Behaviour

- Users: separate Donor, NGO and Rider sections, searchable by name/email/phone/ID. Expand a user to inspect all saved profile fields, verification, current restrictions, active deliveries and moderation history. Other accounts are listed separately; administrator accounts cannot be blocked here.
- Feedback: three sections grouped by the **reviewed participant's role**. Reviewer identity and role remain visible. Expand a review to inspect the participant and issue a warning, temporary block, permanent block or unblock. Each action records its administrator, reason, timestamp and source feedback ID. The database rejects a feedback action against a different participant.
- Blocks: 24 hours, 7 days, 30 days, a custom local-time expiry, or permanent. Temporary expiry uses database time and needs no scheduled cleanup. Permanent blocks last until an administrator unblocks. Blocks apply to existing sessions on subsequent API requests and are also enforced on database workflow RPCs and direct operational writes. Warnings notify the participant without blocking them.
- Blocked participants can still view account status and contact support to appeal. Supabase authentication itself remains available for these purposes. Historical records are not deleted.
- Blocking a rider disables availability and clears live location. Existing orders remain recorded; the detail view lists active deliveries requiring administrator coordination. Blocking does not automatically cancel or reassign collected food.
- Approvals: Pending, Approved, and Rejected/revoked sections. Successful reviews leave Pending immediately. Revoking in Users updates the verification request too. Participant approval status refreshes every 15 seconds while the page is active.
- Support: Active tickets and searchable Resolved archive. Resolved conversations retain all messages, ticket ID and timestamps. Admins can reply with Open/In progress to reopen; a participant reply also reopens a resolved ticket.
- User directory and support tickets traverse API result pages so older records are not silently hidden by the previous ticket limit.

## Validation

- 70 backend tests passed, including existing-session block checks, support exceptions, administrator authorization and archive pagination.
- 34 database checks passed in disposable PGlite, including all migrations, block expiry, direct-write/RPC enforcement, admin protection, feedback linkage, support access and ticket reopening. This is not a production concurrency/load test.
- Frontend production build, TypeScript and lint passed.
- Rendered browser checks could not run: the Chromium download returned an invalid/truncated archive. Complete live desktop/mobile checks after deployment.

## Live checks

1. Check the three user sections, search and expanded profiles.
2. Approve a test NGO: it should leave Pending, appear in Approved and gain access without a new sign-in after the profile refresh.
3. From feedback, warn the reviewed user, then temporarily block them. Verify the participant sees the reason and can still open support, but cannot post, claim or accept deliveries. Review the recorded action, then unblock.
4. Verify custom expiry and permanent blocking on test accounts. Do not use an account with a real ongoing delivery for this check.
5. Resolve a support ticket: it should leave Active and appear in Resolved archive. Search by ticket ID, expand it, confirm message history, then reopen it.
