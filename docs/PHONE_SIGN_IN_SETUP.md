# Mobile-number sign-in

The authentication page has a Mobile tab for SMS-code sign-in and explicit new-account creation. New users complete their name and choose Donor, NGO or Rider in Profile. Existing roles, approval requirements and account blocks still apply.

Existing email/Google users must first sign in with their existing method, open Profile, and verify a Mobile login number. This attaches the number to the same authentication identity. The editable Contact phone field does not establish ownership and cannot enable sign-in. We never merge accounts based on that field.

## Supabase configuration

In Authentication → Sign In / Providers → Phone:

1. Enable Phone and select your SMS provider.
2. For Twilio, enter your Account SID, Auth Token and Messaging Service SID from your Twilio console. Configure the service with an SMS-capable sender and permitted destinations. Keep credentials in the provider configuration, never frontend environment variables or source control.
3. Keep phone confirmations enabled. Set OTP length to 6 digits. Codes expire according to the configured Supabase expiry; users can request a replacement after the 60-second UI cooldown (server rate limits still apply).
4. Save and test delivery with a real number including its country code. Twilio trial accounts may restrict recipient numbers. SMS delivery requires a configured provider and may incur charges.

No new SQL migration or backend deployment is required. Deploy the updated frontend. Google and email authentication remain available.

## Acceptance checks

- Existing email/Google account: Profile → verify mobile → sign out → Mobile → Sign in. Confirm the same role, approval and history remain.
- New number: Mobile → New account → code → Profile. Complete profile and select a participant role. Riders can leave organisation blank; Donor/NGO approval is still required.
- Incorrect/expired codes show errors. Resend and changing the number work. Retry account loading after a backend failure does not consume the OTP again.
- Test blocked accounts and already-registered numbers. Never attempt to merge different identities through contact details.
- When Supabase requires confirmation at both old and new numbers for a phone change, complete both confirmations; the UI only reports success after the auth service confirms the target number.

Automated tests mock SMS delivery. Real SMS delivery and account linking must be checked after provider setup.

Reference: https://supabase.com/docs/guides/auth/phone-login
