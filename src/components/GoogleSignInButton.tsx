import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function GoogleSignInButton({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const result = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (result.error) throw result.error;
      if (!result.data.url)
        throw new Error("Google sign-in is unavailable. Please try email sign-in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <Button type="button" variant="outline" disabled={disabled || busy} onClick={signIn}>
        <svg aria-hidden="true" focusable="false" className="size-4 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.73-.06-1.42-.19-2.09H12v3.96h5.92a5.07 5.07 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.75 3.28-7.95Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.8l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.87 0-5.3-1.94-6.17-4.54H2.15v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.83 13.96A6.6 6.6 0 0 1 5.48 12c0-.68.12-1.34.35-1.96V7.2H2.15A11 11 0 0 0 1 12c0 1.78.43 3.47 1.15 4.8l3.68-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.5c1.62 0 3.07.56 4.21 1.64l3.16-3.16A10.57 10.57 0 0 0 12 1a11 11 0 0 0-9.85 6.2l3.68 2.84C6.7 7.44 9.13 5.5 12 5.5Z"
          />
        </svg>
        {busy ? "Opening Google…" : "Continue with Google"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
