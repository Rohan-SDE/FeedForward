import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminOverview, setVerified } from "@/lib/feedforward.functions";
import type { Row } from "@/lib/rows";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — FeedForward" },
      {
        name: "description",
        content:
          "Verify donor and NGO organisations and review platform-wide listing activity on FeedForward.",
      },
      { property: "og:title", content: "Admin — FeedForward" },
      { property: "og:description", content: "Verify organisations and review activity." },
    ],
  }),
  component: Admin,
});

function Admin() {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["adminOverview"],
    queryFn: useServerFn(adminOverview),
    retry: false,
  });
  const verify = useMutation({
    mutationFn: useServerFn(setVerified),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["adminOverview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (overview.error) {
    return <p className="text-sm text-muted-foreground">Admins only.</p>;
  }

  const roleMap = new Map<string, string[]>();
  ((overview.data?.roles ?? []) as Row[]).forEach((r) => {
    roleMap.set(r.user_id, [...(roleMap.get(r.user_id) ?? []), r.role]);
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="mt-1 text-muted-foreground">
          {(overview.data?.profiles ?? []).length} organisations ·{" "}
          {(overview.data?.listings ?? []).length} listings posted
        </p>
      </div>

      <div className="grid gap-3">
        {((overview.data?.profiles ?? []) as Row[]).map((p) => (
          <div
            key={p.id}
            className="surface-panel flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{p.org_name || p.full_name || "Unnamed"}</p>
              <p className="text-xs text-muted-foreground">
                {(roleMap.get(p.id) ?? ["no role"]).join(", ")} · {p.city ?? "no city"} ·{" "}
                {p.verified ? "verified" : "unverified"}
              </p>
            </div>
            <Button
              size="sm"
              variant={p.verified ? "outline" : "default"}
              disabled={verify.isPending}
              onClick={() => verify.mutate({ data: { id: p.id as string, verified: !p.verified } })}
            >
              {p.verified ? "Revoke verification" : "Verify"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
