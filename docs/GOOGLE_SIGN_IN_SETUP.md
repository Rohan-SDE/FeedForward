# Google sign-in and individual rider signup

This change requires a frontend deployment and Google provider configuration. No new SQL migration or backend deployment is required. Existing moderation migrations must already be applied.

## What users see

- Organisation is explicitly optional for riders in both signup and profile setup. Blank signup values are stored as null. Riders are labelled individual contributors, without an organisation verification requirement.
- Continue with Google is available on the participant sign-in/signup page and administrator sign-in page.
- Google authenticates identity. FeedForward reads permissions from its existing API, not from Google metadata or redirect parameters.
- First-time Google accounts have no automatic role. They arrive at Profile and choose Donor, NGO or Rider, then save contact/location details and continue to their dashboard. There is no administrator signup choice.
- Existing accounts keep their saved roles. An existing administrator using Google is routed to the separate admin dashboard.
- Donors and NGOs still require manual administrator approval. Google does not bypass approval, account blocking or workflow rules.
- Email/password login and password recovery remain available. The existing Supabase browser session flow is preserved.

## Enable Google in Supabase

1. In Google Cloud Console, select/create the project for FeedForward. Configure Google Auth Platform branding, audience and data access. Use the basic identity scopes (`openid`, email and profile); no Maps or government API key is needed.
2. Create an OAuth client of type **Web application**.
3. Set the authorized JavaScript origin to:
   `https://feedforward-web.onrender.com`
4. In Supabase, open **Authentication → Sign In / Providers → Google** (the precise sidebar label can vary). Copy the callback URL displayed there. Add that exact URL as the Google client's **Authorized redirect URI**. It normally looks like `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
5. Paste the Google **Client ID** and **Client Secret** into Supabase's Google provider settings, enable the provider and save. Keep the client secret in Supabase; do not add it to React, Render's VITE variables, GitHub or chat.
6. In **Supabase → Authentication → URL Configuration**, set Site URL to `https://feedforward-web.onrender.com` and add this exact Redirect URL:
   `https://feedforward-web.onrender.com/auth/callback`
   Preserve existing redirect URLs used for password recovery and email confirmation.
7. If Google's audience is in Testing, add the team members' Google accounts as test users. Follow Google's publishing requirements before opening sign-in to everyone.
8. Deploy the frontend update to Render's `feedforward-web` service. Both the callback route and Google button must be deployed.

The two callbacks have different purposes: Google redirects to **Supabase's callback URL**; Supabase then redirects to **FeedForward's `/auth/callback`**. Register each in the correct dashboard.

## Live acceptance checks

- Create an email rider account with Organisation empty; complete profile without an organisation.
- Sign in with a new Google account: choose Rider, save the profile without an organisation, and open the dashboard.
- With separate new Google accounts, choose Donor and NGO and confirm manual approval remains necessary.
- Sign out, then sign in again with each existing Google account; verify the saved role is retained.
- Sign in as an existing administrator using its linked Google identity; verify only existing administrator permissions provide admin access.
- Cancel Google consent and retry; confirm a readable error and no accidental role creation.
- Check existing email login and password recovery still work. If an existing email account is not linked to Google by Supabase, use its original sign-in method and inspect Auth identities; do not manually grant roles or recreate its profile.

## Verification and limits

Validation passed: frontend production build, TypeScript, lint, 9 callback tests and 36 disposable PGlite database checks.

Automated callback tests cover new and existing accounts, cache clearing on account changes, denied consent, missing sessions, initialization errors and backend failure. Database tests cover Google-style profile creation, no implicit role/admin access, one-role enforcement and riders with null organisations.

Actual Google consent and redirects require the owner's Google/Supabase configuration and a live test. Provider configuration and live Google authentication were not performed by this code change. Browser rendering remains unverified in this environment because Chromium was unavailable in the preceding release.

Reference: https://supabase.com/docs/guides/auth/social-login/auth-google
