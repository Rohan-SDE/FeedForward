import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/lib/feedforward.functions";

export type Me = Awaited<ReturnType<typeof getMe>>;

export function useMe() {
  const fetchMe = getMe;
  return useQuery({
    queryKey: ["me"],
    queryFn: () => fetchMe(),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
}

export function hasRole(me: Me | undefined, role: string): boolean {
  return !!me?.roles.includes(role);
}
