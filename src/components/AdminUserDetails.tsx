import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAdminUser, moderateUser } from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function AdminUserDetails({ id, feedbackId }: { id: string; feedbackId?: string }) {
  const qc = useQueryClient();
  const details = useQuery({
    queryKey: ["adminUser", id],
    queryFn: () => getAdminUser(id),
    refetchInterval: 15000,
  });
  const [action, setAction] = useState<"warning" | "block" | "unblock">("warning");
  const [duration, setDuration] = useState("24");
  const [customUntil, setCustomUntil] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: moderateUser,
    onSuccess: () => {
      setReason("");
      toast.success("Action recorded");
      void qc.invalidateQueries({ queryKey: ["adminUser", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (details.isPending) return <p role="status">Loading user details…</p>;
  if (details.error)
    return (
      <div role="alert">
        {details.error.message} <Button onClick={() => details.refetch()}>Retry</Button>
      </div>
    );
  const data = details.data;
  const restriction = data.restrictions[0];
  const blocked =
    restriction?.blocked &&
    (!restriction.blocked_until || Date.parse(restriction.blocked_until) > Date.now());
  function submit() {
    let until: string | null = null;
    if (action === "block" && duration !== "permanent") {
      const expiry =
        duration === "custom"
          ? new Date(customUntil)
          : new Date(Date.now() + Number(duration) * 3600000);
      if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        toast.error("Choose a future expiry");
        return;
      }
      until = expiry.toISOString();
    }
    if (
      !window.confirm(
        `${action === "block" ? (until ? "Temporarily block" : "Permanently block") : action === "unblock" ? "Unblock" : "Warn"} ${data.profile.org_name || data.profile.full_name || id}?\nReason: ${reason.trim()}${data.active_pickups.length ? "\nThis user has active deliveries. Coordinate them through support." : ""}`,
      )
    )
      return;
    save.mutate({
      id,
      action,
      reason: reason.trim(),
      blocked_until: until,
      ...(feedbackId ? { feedback_id: feedbackId } : {}),
    });
  }
  return (
    <div className="mt-4 grid gap-4 border-t pt-4">
      <h4 className="font-semibold">User details</h4>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {Object.entries(data.profile).map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="capitalize text-muted-foreground">{key.replaceAll("_", " ")}</dt>
            <dd className="break-words">
              {value == null || value === ""
                ? "Not provided"
                : Array.isArray(value)
                  ? value.join(", ") || "None"
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="font-medium">
        Account:{" "}
        {blocked
          ? restriction.blocked_until
            ? `Blocked until ${new Date(restriction.blocked_until).toLocaleString()}`
            : "Permanently blocked"
          : "Active"}
      </p>
      {restriction && <p className="text-sm">Last restriction reason: {restriction.reason}</p>}
      {data.verification.map((v) => (
        <p key={v.user_id} className="text-sm">
          Application: {v.status} · {v.details} · Review: {v.review_note || "Not reviewed"}
        </p>
      ))}
      {data.active_pickups.length > 0 && (
        <div className="rounded border border-amber-400 p-3">
          <p className="font-semibold">Active deliveries need coordination</p>
          {data.active_pickups.map((p) => (
            <p key={p.id} className="break-all text-sm">
              {p.claims?.food_listings?.title} · {p.status} · {p.id}
            </p>
          ))}
          <p className="text-sm">
            Blocking stops this user's delivery actions. Contact the participants through support;
            orders are preserved.
          </p>
        </div>
      )}
      <h4 className="font-semibold">Take action{feedbackId ? " on this feedback" : ""}</h4>
      <label className="grid gap-1 text-sm">
        Action
        <select
          className="rounded border bg-background p-2"
          value={action}
          onChange={(e) => setAction(e.target.value as typeof action)}
        >
          <option value="warning">Send warning</option>
          <option value="block">Block user</option>
          <option value="unblock">Unblock user</option>
        </select>
      </label>
      {action === "block" && (
        <label className="grid gap-1 text-sm">
          Duration
          <select
            className="rounded border bg-background p-2"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            <option value="24">24 hours</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
            <option value="custom">Choose expiry</option>
            <option value="permanent">Permanent (until admin unblocks)</option>
          </select>
        </label>
      )}
      {action === "block" && duration === "custom" && (
        <label className="grid gap-1 text-sm">
          Expiry (your local time)
          <Input
            type="datetime-local"
            value={customUntil}
            onChange={(e) => setCustomUntil(e.target.value)}
          />
        </label>
      )}
      <Textarea
        aria-label="Action reason"
        placeholder="Record the evidence and reason for this action"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
      />
      <Button disabled={save.isPending || reason.trim().length < 3} onClick={submit}>
        Confirm action
      </Button>
      <h4 className="font-semibold">Action history</h4>
      {!data.actions.length && <p className="text-sm">No moderation actions.</p>}
      {data.actions.map((a) => (
        <article key={a.id} className="rounded border p-3 text-sm">
          <p>
            {a.action} · {new Date(a.created_at).toLocaleString()}
          </p>
          <p className="whitespace-pre-wrap">{a.reason}</p>
          <p>Administrator: {a.admin_id}</p>
          {a.blocked_until && <p>Expiry: {new Date(a.blocked_until).toLocaleString()}</p>}
          {a.feedback_id && <p className="break-all">Feedback: {a.feedback_id}</p>}
        </article>
      ))}
    </div>
  );
}
