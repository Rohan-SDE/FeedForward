import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Leaf, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
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
  const applyRole = useServerFn(setMyRole);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"donor" | "ngo" | "volunteer">("donor");
  const [pendingEmail, setPendingEmail] = useState(false);

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
        toast.info("This email is already registered — we resent the confirmation link.");
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

  async function google() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed. Please try again.");
      return;
    }
    if (result.redirected) return;
    setBusy(false);
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="mb-8 flex items-center justify-center gap-2 font-display text-xl font-bold"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Leaf className="size-5" />
          </span>
          FeedForward
        </Link>

        {pendingEmail ? (
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
                      minLength={6}
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

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or{" "}
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="outline" className="w-full" onClick={google} disabled={busy}>
              Continue with Google
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
