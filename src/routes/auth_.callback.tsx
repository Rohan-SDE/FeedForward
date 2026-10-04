import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/feedforward.functions";
import { finishOAuthSignIn } from "@/lib/oauth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Completing sign-in — FeedForward" }] }),
  component: OAuthCallback,
});
function OAuthCallback() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const callbackUrl = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    callbackUrl.current ??= window.location.href;
    setError("");
    async function complete() {
      try {
        const destination = await finishOAuthSignIn(callbackUrl.current!, {
          getSession: () => supabase.auth.getSession(),
          clearAccountCache: async () => {
            await qc.cancelQueries();
            qc.clear();
          },
          getAccount: getMe,
          clearCallbackUrl: () =>
            window.history.replaceState(window.history.state, "", "/auth/callback"),
        });
        if (active) await navigate({ to: destination, replace: true });
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to finish sign-in.");
      }
    }
    void complete();
    return () => {
      active = false;
    };
  }, [navigate, qc, attempt]);
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="surface-panel grid w-full max-w-md gap-4 p-8">
        <h1 className="text-xl font-semibold">Completing sign-in</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => setAttempt((n) => n + 1)}>Retry account loading</Button>
            <Link to="/auth" className="underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <p role="status">Checking your account. Please wait…</p>
        )}
      </div>
    </main>
  );
}
