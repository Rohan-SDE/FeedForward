import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listVerification, reviewVerification } from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Row } from "@/lib/rows";
import { toast } from "sonner";
export default function AdminReviews({ profiles }: { profiles: Row[] }) {
  const applications = useQuery({
    queryKey: ["verification"],
    queryFn: listVerification,
    refetchInterval: 15000,
  });
  const qc = useQueryClient();
  const [view, setView] = useState("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const review = useMutation({
    mutationFn: reviewVerification,
    onSuccess: () => {
      toast.success("Review saved");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="grid gap-4">
      <h2 className="text-xl font-semibold">Donor & NGO approval queue</h2>
      <p className="text-sm">
        Verify the supplied organisation details and contact the applicant before deciding. Approval
        records your manual review; it does not validate government registration.
      </p>
      {applications.error && <p role="alert">{applications.error.message}</p>}
      {applications.isLoading && <p>Loading applications…</p>}
      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "rejected"].map((status) => (
          <Button
            key={status}
            variant={view === status ? "default" : "outline"}
            onClick={() => setView(status)}
          >
            {status === "pending"
              ? "Pending"
              : status === "approved"
                ? "Approved"
                : "Rejected / revoked"}{" "}
            ({applications.data?.filter((a) => a.status === status).length ?? 0})
          </Button>
        ))}
      </div>
      {applications.data?.filter((a) => a.status === view).length === 0 && (
        <p>No {view} applications.</p>
      )}
      {applications.data
        ?.filter((a) => a.status === view)
        .map((a) => {
          const profile = profiles.find((p) => p.id === a.user_id);
          return (
            <article key={a.user_id} className="surface-panel grid gap-2 p-4">
              <h3 className="font-semibold">
                {profile?.org_name || profile?.full_name || a.user_id} · {a.status}
              </h3>
              <p className="text-sm">
                {profile?.email} · {profile?.phone} · {profile?.address} · {profile?.city}
              </p>
              <p className="whitespace-pre-wrap">{a.details}</p>
              {a.review_note && <p>Previous review: {a.review_note}</p>}
              <p className="text-xs">
                Updated {new Date(a.updated_at).toLocaleString()}
                {a.reviewed_by ? ` · Reviewed by ${a.reviewed_by}` : ""}
              </p>
              <Textarea
                aria-label="Review reason"
                placeholder="Record your verification findings or rejection reason"
                value={notes[a.user_id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [a.user_id]: e.target.value })}
                maxLength={1000}
              />
              <div className="flex gap-2">
                {[true, false].map((approved) => (
                  <Button
                    key={String(approved)}
                    variant={approved ? "default" : "outline"}
                    disabled={
                      review.isPending ||
                      (approved && a.status === "approved") ||
                      (notes[a.user_id] ?? "").trim().length < 3
                    }
                    onClick={() =>
                      review.mutate({ user_id: a.user_id, approved, note: notes[a.user_id] ?? "" })
                    }
                  >
                    {approved ? "Approve" : "Reject / revoke"}
                  </Button>
                ))}
              </div>
            </article>
          );
        })}
    </section>
  );
}
