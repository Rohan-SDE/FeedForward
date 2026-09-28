import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Leaf, LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useMe } from "@/hooks/useMe";
import { NotificationBell } from "@/components/NotificationBell";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/listings", label: "Nearby food" },
  { to: "/donate", label: "Post surplus" },
  { to: "/pickups", label: "Pickups" },
  { to: "/impact", label: "Impact" },
  { to: "/profile", label: "Profile" },
] as const;

export function AppNav() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const isAdmin = !!me?.roles.includes("admin");
  const canDonate = isAdmin || !!me?.roles.includes("donor");

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const roleLinks = links.filter((link) => link.to !== "/donate" || canDonate);
  const items = isAdmin ? [...roleLinks, { to: "/admin", label: "Admin" } as const] : roleLinks;

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link to="/dashboard" className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Leaf className="size-4" />
          </span>
          FeedForward
        </Link>

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {items.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground",
                path === l.to && "bg-secondary text-secondary-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <NotificationBell />
          <span className="hidden max-w-[14rem] truncate text-sm text-muted-foreground sm:block">
            {me?.profile?.org_name || me?.profile?.full_name || ""}
          </span>
          <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Open menu"
          >
            <Menu className="size-4" />
          </Button>
        </div>
      </div>

      {open && (
        <nav className="grid gap-1 border-t border-border px-4 py-3 md:hidden">
          {items.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
