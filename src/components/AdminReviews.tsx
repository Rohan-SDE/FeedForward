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
      {applications.data?.length === 0 && <p>No applications yet.</p>}
      {applications.data?.map((a) => {
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
                  disabled={review.isPending || (notes[a.user_id] ?? "").trim().length < 3}
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
