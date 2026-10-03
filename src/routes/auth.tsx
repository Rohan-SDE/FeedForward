import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Leaf, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { setMyRole } from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — FeedForward" },
      {
        name: "description",
        content:
          "Sign in or create a FeedForward account as a food donor, NGO or volunteer to start rescuing surplus food.",
      },
      { property: "og:title", content: "Sign in — FeedForward" },
      {
        property: "og:description",
        content: "Access your FeedForward donor, NGO or volunteer dashboard.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const applyRole = setMyRole;
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"donor" | "ngo" | "volunteer">("donor");
  const [pendingEmail, setPendingEmail] = useState(false);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function requestReset() {
    if (!email.trim()) {
      toast.error("Enter your email address first");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
      toast.success("If this email has an account, a reset link will arrive shortly.");
    } catch {
      toast.error("Could not request a reset. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      setRecovery(false);
      setPassword("");
      toast.success("Password updated. Sign in with your new password.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Password update failed");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/dashboard" });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Please add your name");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName, org_name: orgName, phone, role },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data.session) {
      if (data.user && data.user.identities?.length === 0) {
        toast.info("Check your inbox, or sign in if you already have an account.");
      }
      setPendingEmail(true);
      return;
    }

    try {
      await applyRole({ data: { role } });
    } catch {
      /* role already set by signup trigger */
    }
    navigate({ to: "/dashboard" });
  }

  async function resendConfirmation() {
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Confirmation email sent again.");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <fieldset disabled={!ready} className="w-full max-w-md">
        <Link
          to="/"
          className="mb-8 flex items-center justify-center gap-2 font-display text-xl font-bold"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Leaf className="size-5" />
          </span>
          FeedForward
        </Link>

        {recovery ? (
          <form onSubmit={updatePassword} className="surface-panel grid gap-4 p-8">
            <h1 className="text-xl font-semibold">Choose a new password</h1>
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button disabled={busy}>Update password</Button>
          </form>
        ) : pendingEmail ? (
          <div className="surface-panel p-8 text-center">
            <h1 className="text-xl font-semibold">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a confirmation link to <strong>{email}</strong>. Confirm it to activate your
              account, then sign in.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Nothing yet? Check your spam or promotions folder, then resend below.
            </p>
            <Button className="mt-6 w-full" onClick={resendConfirmation} disabled={busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Resend confirmation email
            </Button>
            <Button
              className="mt-3 w-full"
              variant="outline"
              onClick={() => setPendingEmail(false)}
            >
              Back to sign in
            </Button>
          </div>
        ) : (
          <div className="surface-panel p-6 sm:p-8">
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-6">
                <form onSubmit={signIn} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="si-email">Email</Label>
                    <Input
                      id="si-email"
                      type="email"
                      required
                      maxLength={255}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="si-pass">Password</Label>
                    <Input
                      id="si-pass"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={busy} className="mt-2">
                    {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Sign in
                  </Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={requestReset}>
                    Forgot password?
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-6">
                <form onSubmit={signUp} className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="su-role">I am a…</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                      <SelectTrigger id="su-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="donor">
                          Food donor (restaurant, canteen, event)
                        </SelectItem>
                        <SelectItem value="ngo">NGO / shelter</SelectItem>
                        <SelectItem value="volunteer">Volunteer / delivery agent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="su-name">Your name</Label>
                    <Input
                      id="su-name"
                      required
                      maxLength={120}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="su-org">Organisation</Label>
                    <Input
                      id="su-org"
                      maxLength={160}
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Optional for volunteers"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="su-phone">Phone</Label>
                    <Input
                      id="su-phone"
                      maxLength={32}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="su-email">Email</Label>
                    <Input
                      id="su-email"
                      type="email"
                      required
                      maxLength={255}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="su-pass">Password</Label>
                    <Input
                      id="su-pass"
                      type="password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={busy} className="mt-2">
                    {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Create account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </fieldset>
    </div>
  );
}
