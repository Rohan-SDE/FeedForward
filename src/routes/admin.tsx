import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/feedforward.functions";
import AdminUserDetails from "@/components/AdminUserDetails";
import AdminReviews from "@/components/AdminReviews";
import SupportPanel from "@/components/SupportPanel";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminOverview, setVerified } from "@/lib/feedforward.functions";
import type { Row } from "@/lib/rows";
import { Button } from "@/components/ui/button";
import FeedbackSection from "@/components/FeedbackSection";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/admin/login" });
    const me = await getMe();
    if (!me.roles.includes("admin")) throw redirect({ to: "/admin/login" });
  },
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
  const navigate = useNavigate();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [section, setSection] = useState("Overview");
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    await qc.cancelQueries();
    qc.clear();
    await navigate({ to: "/admin/login", replace: true });
  }
  const overview = useQuery({
    queryKey: ["adminOverview"],
    queryFn: adminOverview,
    retry: false,
  });
  const verify = useMutation({
    mutationFn: setVerified,
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["adminOverview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (overview.error) {
    return (
      <div className="p-8" role="alert">
        <p>Unable to load administration: {overview.error.message}</p>
        <Button onClick={() => overview.refetch()}>Retry</Button>
        <Link to="/admin/login">Admin sign in</Link>
      </div>
    );
  }

  const roleMap = new Map<string, string[]>();
  ((overview.data?.roles ?? []) as Row[]).forEach((r) => {
    roleMap.set(r.user_id, [...(roleMap.get(r.user_id) ?? []), r.role]);
  });

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b bg-secondary/40 p-5 lg:border-r">
        <Link to="/admin" className="text-xl font-bold">
          FeedForward
        </Link>
        <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
          Administration
        </p>
        <nav aria-label="Administration" className="mt-8 flex flex-wrap gap-2 lg:grid">
          {["Overview", "Approvals", "Users", "Listings", "Feedback", "Support"].map((item) => (
            <Button
              key={item}
              variant={section === item ? "default" : "ghost"}
              className="justify-start"
              aria-current={section === item ? "page" : undefined}
              onClick={() => setSection(item)}
            >
              {item}
            </Button>
          ))}
        </nav>
        <Button variant="outline" className="mt-8 w-full" onClick={signOut}>
          Sign out
        </Button>
      </aside>
      <main className="min-w-0 space-y-6 p-4 sm:p-8 lg:p-10">
        <div>
          <h1 className="text-3xl font-bold">{section}</h1>
          <p className="mt-1 text-muted-foreground">
            {(overview.data?.profiles ?? []).length} user profiles ·{" "}
            {(overview.data?.listings ?? []).length} listings posted
          </p>
        </div>

        {overview.isLoading && <p role="status">Loading administration…</p>}
        {section === "Overview" && (
          <div className="surface-panel p-6">
            <h2 className="text-xl font-semibold">Review and resolve</h2>
            <p className="mt-2 text-muted-foreground">
              Review donor and NGO applications, inspect platform activity and respond to
              participant support requests.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={() => setSection("Approvals")}>Review applications</Button>
              <Button variant="outline" onClick={() => setSection("Support")}>
                Open support inbox
              </Button>
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              Counts reflect records returned by the administration API.
            </p>
          </div>
        )}
        {section === "Approvals" && <AdminReviews profiles={overview.data?.profiles ?? []} />}
        {section === "Users" && (
          <div className="grid gap-6">
            <label className="grid gap-2">
              Search users
              <input
                className="rounded border bg-background p-3"
                placeholder="Name, email, phone or user ID"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </label>
            {[
              ["donor", "Donors"],
              ["ngo", "NGOs"],
              ["volunteer", "Riders"],
            ].map(([role, label]) => {
              const users = ((overview.data?.profiles ?? []) as Row[]).filter(
                (p) =>
                  roleMap.get(p.id)?.includes(role!) &&
                  [p.org_name, p.full_name, p.email, p.phone, p.id]
                    .join(" ")
                    .toLowerCase()
                    .includes(userSearch.toLowerCase()),
              );
              return (
                <section key={role} className="surface-panel p-5">
                  <h2 className="mb-4 text-xl font-semibold">
                    {label} ({users.length})
                  </h2>
                  {!users.length && <p>No matching users.</p>}
                  {users.map((p) => (
                    <article key={p.id} className="border-t py-4">
                      <p className="font-semibold">{p.org_name || p.full_name || "Unnamed"}</p>
                      <p className="break-words text-sm">
                        {p.email} · {p.city || "No city"} ·{" "}
                        {p.verified ? "Approved" : "Not approved"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setSelectedUser(selectedUser === p.id ? null : p.id)}
                        >
                          {selectedUser === p.id ? "Close details" : "View details & actions"}
                        </Button>
                        {p.verified && (
                          <Button
                            variant="outline"
                            disabled={verify.isPending}
                            onClick={() => {
                              if (window.confirm("Revoke approval for this account?"))
                                verify.mutate({ data: { id: p.id, verified: false } });
                            }}
                          >
                            Revoke approval
                          </Button>
                        )}
                      </div>
                      {selectedUser === p.id && <AdminUserDetails key={p.id} id={p.id} />}
                    </article>
                  ))}
                </section>
              );
            })}
            <details className="surface-panel p-5">
              <summary>Administrators and accounts without a participant role</summary>
              {((overview.data?.profiles ?? []) as Row[])
                .filter(
                  (p) =>
                    !(roleMap.get(p.id) ?? []).some((r) =>
                      ["donor", "ngo", "volunteer"].includes(r),
                    ),
                )
                .map((p) => (
                  <div key={p.id} className="mt-3">
                    <p>
                      {p.full_name || p.org_name || p.id} · {p.email}
                    </p>
                    <details>
                      <summary>Profile details</summary>
                      <dl>
                        {Object.entries(p).map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd className="break-words">{String(value ?? "Not provided")}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </div>
                ))}
            </details>
          </div>
        )}
        {section === "Listings" && (
          <div className="grid gap-3">
            {(overview.data?.listings ?? []).length === 0 && <p>No listings found.</p>}
            {((overview.data?.listings ?? []) as Row[]).map((l) => (
              <article key={l.id} className="surface-panel p-5">
                <h2 className="font-semibold">{l.title || l.food_name || "Food listing"}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {l.status || "Status unavailable"} ·{" "}
                  {l.created_at ? new Date(l.created_at).toLocaleString() : "Date unavailable"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Listing ID: {l.id}</p>
              </article>
            ))}
          </div>
        )}
        {section === "Feedback" && <FeedbackSection pickups={[]} roles={["admin"]} />}
        {section === "Support" && <SupportPanel />}
      </main>
    </div>
  );
}
