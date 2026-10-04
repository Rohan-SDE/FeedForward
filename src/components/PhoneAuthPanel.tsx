import { useEffect, useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { requestPhoneCode, verifyPhoneCode } from "@/lib/phone-auth";
import { getMe } from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PhoneAuthPanel({ link = false }: { link?: boolean }) {
  const id = useId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [phone, setPhone] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [verified, setVerified] = useState(false);
  const [currentPhone, setCurrentPhone] = useState("");
  useEffect(() => {
    if (!link) return;
    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      if (data.user?.phone_confirmed_at) setCurrentPhone(data.user.phone || "");
    });
    return () => {
      active = false;
    };
  }, [link]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function send() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const target = await requestPhoneCode(
        supabase.auth,
        sentPhone || phone,
        link ? "link" : mode,
      );
      setSentPhone(target);
      setCode("");
      setCooldown(60);
      setStatus(`SMS code requested for ${target}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a code. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function complete() {
    setBusy(true);
    setError("");
    try {
      if (!verified) {
        await verifyPhoneCode(supabase.auth, sentPhone, code, link);
        setVerified(true);
      }
      if (link) {
        setCurrentPhone(sentPhone);
        setStatus("Mobile number verified. You can now use it to sign in to this account.");
      } else {
        await qc.cancelQueries();
        qc.clear();
        const account = await getMe();
        await navigate({
          to: account.roles.includes("admin")
            ? "/admin"
            : account.roles.length
              ? "/dashboard"
              : "/profile",
          replace: true,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setSentPhone("");
    setCode("");
    setVerified(false);
    setError("");
    setStatus("");
  }
  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">
        {link ? "Mobile login number" : "Sign in with a mobile number"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {link
          ? "Verify a number to sign in to this same account using an SMS code. Your contact phone alone does not enable login."
          : "Already use email or Google? Sign in that way first, then verify your mobile number in Profile to keep the same account."}
      </p>
      {link && currentPhone && (
        <p className="text-sm">Verified login number: +{currentPhone.replace(/^\+/, "")}</p>
      )}
      {!link && !sentPhone && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mode === "signin" ? "default" : "outline"}
            disabled={busy}
            onClick={() => setMode("signin")}
          >
            Sign in
          </Button>
          <Button
            type="button"
            variant={mode === "signup" ? "default" : "outline"}
            disabled={busy}
            onClick={() => setMode("signup")}
          >
            New account
          </Button>
        </div>
      )}
      {!sentPhone ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Label htmlFor={`${id}-phone`}>Mobile number with country code</Label>
          <Input
            id={`${id}-phone`}
            type="tel"
            autoComplete="tel"
            placeholder="+91 9876543210"
            required
            maxLength={32}
            value={phone}
            disabled={busy}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button disabled={busy || cooldown > 0}>
            {busy
              ? "Sending…"
              : cooldown
                ? `Wait ${cooldown}s`
                : mode === "signup" && !link
                  ? "Create account with SMS"
                  : "Send SMS code"}
          </Button>
        </form>
      ) : verified ? (
        !link && (
          <Button disabled={busy} onClick={() => void complete()}>
            Retry account loading
          </Button>
        )
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void complete();
          }}
        >
          <Label htmlFor={`${id}-code`}>6-digit code sent to {sentPhone}</Label>
          <Input
            id={`${id}-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
            maxLength={6}
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <Button disabled={busy}>{busy ? "Verifying…" : "Verify code"}</Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || cooldown > 0}
            onClick={() => void send()}
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
          </Button>
        </form>
      )}
      {sentPhone && (!verified || link) && (
        <Button type="button" variant="ghost" disabled={busy} onClick={reset}>
          Use another number
        </Button>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!link && mode === "signup" && (
        <p className="text-xs text-muted-foreground">
          After verification, choose Donor, NGO or Rider and complete your profile. Donors and NGOs
          need administrator approval.
        </p>
      )}
    </section>
  );
}
