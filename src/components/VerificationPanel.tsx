import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/useMe";
import { listVerification, requestVerification } from "@/lib/feedforward.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
export default function VerificationPanel() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [details, setDetails] = useState("");
  const required = !!me?.roles.some((r) => r === "donor" || r === "ngo");
  const applications = useQuery({
    queryKey: ["verification"],
    queryFn: listVerification,
    enabled: required,
    refetchInterval: 30000,
  });
  const submit = useMutation({
    mutationFn: requestVerification,
    onSuccess: () => {
      toast.success("Sent for administrator review");
      void qc.invalidateQueries({ queryKey: ["verification"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!required || me?.profile?.verified) return null;
  const application = applications.data?.find((a) => a.user_id === me?.userId);
  return (
    <section className="surface-panel mb-6 grid gap-3 border-amber-300 p-5">
      <h2 className="font-semibold">Administrator approval required</h2>
      <p className="text-sm">
        You can browse, edit your profile and contact support. Posting or claiming food requires
        manual approval. This is a platform review, not government registration validation.
      </p>
      <p className="text-sm">
        Application: {application?.status ?? "Not submitted"}
        {application?.review_note && ` — ${application.review_note}`}
      </p>
      {applications.error && <p role="alert">{applications.error.message}</p>}
      <label htmlFor="verification-details" className="text-sm">
        Organisation or donor details and a contact the administrator can verify
      </label>
      <Textarea
        id="verification-details"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        maxLength={3000}
        placeholder="Explain who you are, where you operate, and how the administrator can contact you. Do not include passwords or sensitive identity numbers."
      />
      <Button
        disabled={submit.isPending || details.trim().length < 20}
        onClick={() => submit.mutate(details)}
      >
        {application ? "Update application" : "Request approval"}
      </Button>
    </section>
  );
}
