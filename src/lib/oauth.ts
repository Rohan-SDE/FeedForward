/** Resolve access from the authenticated API, never from Google metadata or URL roles. */
export async function finishOAuthSignIn(
  callbackUrl: string,
  dependencies: {
    getSession: () => Promise<{ data: { session: unknown }; error: { message: string } | null }>;
    clearAccountCache: () => Promise<void>;
    getAccount: () => Promise<{ roles: string[] }>;
    clearCallbackUrl: () => void;
  },
): Promise<"/admin" | "/profile" | "/dashboard"> {
  const url = new URL(callbackUrl);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const error = url.searchParams.get("error") || fragment.get("error");
  if (error) {
    dependencies.clearCallbackUrl();
    throw new Error(
      error === "access_denied"
        ? "Google sign-in was cancelled or permission was denied. Please try again."
        : "Google sign-in could not be completed. Please return to sign in and try again.",
    );
  }
  // The existing Supabase browser client detects the callback and establishes the
  // session during initialization. getSession waits for that work; do not exchange twice.
  const result = await dependencies.getSession().finally(dependencies.clearCallbackUrl);
  if (result.error || !result.data.session) {
    throw new Error("Your Google sign-in session is missing or expired. Please sign in again.");
  }
  await dependencies.clearAccountCache();
  const account = await dependencies.getAccount();
  if (account.roles.includes("admin")) return "/admin";
  return account.roles.length ? "/dashboard" : "/profile";
}
