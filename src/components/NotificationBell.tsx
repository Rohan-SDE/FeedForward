import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/feedforward.functions";

type Notification = {
  id: string;
  notification_type: "new_food" | "delivery_request" | "delivery_accepted";
  title: string;
  message: string;
  action_url: string;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: listNotifications,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });
  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationRead({ data: { id } }),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: refresh,
  });

  const items = (notifications.data?.items ?? []) as Notification[];
  const unreadCount = notifications.data?.unreadCount ?? 0;

  async function openNotification(item: Notification) {
    if (!item.read_at) {
      try {
        await markOne.mutateAsync(item.id);
      } catch {
        // The linked task is still useful if acknowledgement temporarily fails.
      }
    }
    window.location.assign(item.action_url);
  }

  return (
    <Popover onOpenChange={(open) => open && void notifications.refetch()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute right-0.5 top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="mr-1 size-4" /> Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {notifications.isLoading && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading notifications…
            </p>
          )}

          {!notifications.isLoading && items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          )}

          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void openNotification(item)}
              className={`block w-full border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted ${
                item.read_at ? "bg-background" : "bg-secondary/45"
              }`}
            >
              <span className="flex items-start gap-3">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    item.read_at ? "bg-transparent" : "bg-primary"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{item.message}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
