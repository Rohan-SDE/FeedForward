import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";
import {
  getMyFeedbackStatus,
  listAdminFeedback,
  submitDeliveryFeedback,
} from "@/lib/feedforward.functions";
import type { Row } from "@/lib/rows";
import FoodPhoto from "@/components/FoodPhoto";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type FeedbackCategory = "delivery_partner" | "food" | "food_receiver" | "restaurant";

const LABELS: Record<FeedbackCategory, string> = {
  delivery_partner: "Delivery partner",
  food: "Food quality",
  food_receiver: "Food receiver / NGO",
  restaurant: "Restaurant / donor",
};

function categoriesFor(roles: string[]): FeedbackCategory[] {
  if (roles.includes("ngo")) return ["food", "delivery_partner"];
  if (roles.includes("volunteer")) return ["food_receiver", "restaurant"];
  if (roles.includes("donor")) return ["delivery_partner"];
  return [];
}

function displayName(profile: Row | null | undefined, fallback: string) {
  return profile?.org_name || profile?.full_name || fallback;
}

export default function FeedbackSection({ pickups, roles }: { pickups: Row[]; roles: string[] }) {
  const isAdmin = roles.includes("admin");
  const qc = useQueryClient();
  const completed = pickups.filter((pickup) => pickup.status === "completed");
  const categories = categoriesFor(roles);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});

  const status = useQuery({
    queryKey: ["myFeedbackStatus"],
    queryFn: getMyFeedbackStatus,
    enabled: !isAdmin && categories.length > 0,
  });
  const adminFeedback = useQuery({
    queryKey: ["adminFeedback"],
    queryFn: listAdminFeedback,
    enabled: isAdmin,
  });

  const submitted = useMemo(
    () => new Set((status.data ?? []).map((item) => `${item.pickup_id}:${String(item.category)}`)),
    [status.data],
  );

  const submit = useMutation({
    mutationFn: submitDeliveryFeedback,
    onSuccess: () => {
      toast.success("Feedback submitted");
      qc.invalidateQueries({ queryKey: ["myFeedbackStatus"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isAdmin) {
    return (
      <section className="grid gap-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-4" /> Admin feedback review (
          {adminFeedback.data?.length ?? 0})
        </h2>
        {(adminFeedback.data ?? []).map((feedback: Row) => (
          <article key={feedback.id} className="surface-panel grid gap-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {feedback.pickups?.claims?.food_listings?.title ?? "Completed food delivery"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {displayName(feedback.reviewer, "Reviewer")} ({feedback.reviewer_role}) reviewed{" "}
                  {displayName(feedback.subject, "Participant")} ({feedback.subject_role}) ·{" "}
                  {LABELS[feedback.category as FeedbackCategory]}
                </p>
              </div>
              <div className="flex" aria-label={`${feedback.rating} out of 5 stars`}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className="size-5 text-amber-500"
                    fill={star <= feedback.rating ? "currentColor" : "none"}
                  />
                ))}
              </div>
            </div>
            <p className="rounded-lg bg-muted p-3 text-sm">{feedback.comment}</p>
            <p className="text-xs text-muted-foreground">
              Submitted {new Date(feedback.created_at).toLocaleString()}
            </p>
          </article>
        ))}
        {!adminFeedback.isLoading && !adminFeedback.data?.length && (
          <p className="text-sm text-muted-foreground">No feedback has been submitted yet.</p>
        )}
      </section>
    );
  }

  if (!categories.length) return null;

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageSquare className="size-4" /> Delivery feedback
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          NGO food reviews are shared with the food donor and administrators. All other feedback is
          visible only to administrators.
        </p>
      </div>

      {completed.map((pickup) => {
        const listing = pickup.claims?.food_listings;
        return (
          <article key={pickup.id} className="surface-panel grid gap-4 p-5">
            <div className="flex items-center gap-3">
              <FoodPhoto
                src={listing?.photo_url}
                alt={`${listing?.title ?? "Delivered food"} photo`}
                className="size-20 shrink-0"
              />
              <div>
                <p className="font-semibold">{listing?.title ?? "Completed delivery"}</p>
                <p className="text-xs text-muted-foreground">
                  Completed {new Date(pickup.delivered_time ?? pickup.updated_at).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {categories.map((category) => {
                const key = `${pickup.id}:${category}`;
                if (submitted.has(key)) {
                  return (
                    <div key={key} className="rounded-xl border border-border bg-muted p-4">
                      <p className="font-medium">{LABELS[category]}</p>
                      <p className="mt-1 text-sm text-muted-foreground">Feedback submitted.</p>
                    </div>
                  );
                }

                const rating = ratings[key] ?? 0;
                const comment = comments[key] ?? "";
                return (
                  <div key={key} className="grid gap-3 rounded-xl border border-border p-4">
                    <p className="font-medium">Review: {LABELS[category]}</p>
                    <div className="flex gap-1" aria-label="Choose rating">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`${star} star${star === 1 ? "" : "s"}`}
                          onClick={() => setRatings((current) => ({ ...current, [key]: star }))}
                        >
                          <Star
                            className="size-6 text-amber-500"
                            fill={star <= rating ? "currentColor" : "none"}
                          />
                        </button>
                      ))}
                    </div>
                    <Textarea
                      value={comment}
                      maxLength={1000}
                      placeholder="Write at least 3 characters"
                      onChange={(event) =>
                        setComments((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                    <Button
                      size="sm"
                      disabled={submit.isPending || rating === 0 || comment.trim().length < 3}
                      onClick={() =>
                        submit.mutate({
                          data: {
                            pickup_id: pickup.id as string,
                            category,
                            rating,
                            comment: comment.trim(),
                          },
                        })
                      }
                    >
                      Submit feedback
                    </Button>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}

      {!completed.length && (
        <p className="text-sm text-muted-foreground">
          Feedback becomes available after a delivery is completed using the NGO PIN.
        </p>
      )}
    </section>
  );
}
