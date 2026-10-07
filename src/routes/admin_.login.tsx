import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { getMe } from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/admin_/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "Administrator sign in — FeedForward" }] }),
  component: AdminLogin,
});
function AdminLogin() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      await qc.cancelQueries();
      qc.clear();
      const me = await getMe();
      if (!me.roles.includes("admin")) {
        await supabase.auth.signOut();
        throw new Error("This account does not have administrator access.");
      }
      await navigate({ to: "/admin", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-secondary/30 px-4 py-12">
      <form onSubmit={submit} className="surface-panel grid w-full max-w-md gap-5 p-8">
        <ShieldCheck className="size-10 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Administrator sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            FeedForward administration. Access is granted by the platform owner.
          </p>
        </div>
        <label className="grid gap-2 text-sm">
          Email
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm">
          Password
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button disabled={busy}>{busy ? "Checking access…" : "Sign in to administration"}</Button>
        <GoogleSignInButton disabled={busy} />
        <p className="text-xs text-muted-foreground">
          Google sign-in uses your existing account permissions; it does not grant administrator
          access.
        </p>
        <Link to="/auth" className="text-sm underline">
          Participant sign in / password recovery
        </Link>
      </form>
    </main>
  );
}
