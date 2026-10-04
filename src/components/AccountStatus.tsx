import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getAccountStatus } from "@/lib/feedforward.functions";
export default function AccountStatus() {
  const state = useQuery({
    queryKey: ["accountStatus"],
    queryFn: getAccountStatus,
    refetchInterval: 15000,
  });
  if (!state.data?.blocked) return null;
  const r = state.data.restriction;
  return (
    <section role="alert" className="mb-5 grid gap-2 rounded border border-destructive p-4">
      <h2 className="font-semibold">Your account is blocked</h2>
      <p>{r?.reason}</p>
      <p>
        {r?.blocked_until
          ? `Until ${new Date(r.blocked_until).toLocaleString()}`
          : "Permanent block. An administrator can review your appeal."}
      </p>
      <Link to="/support" className="underline">
        Contact support
      </Link>
    </section>
  );
}
