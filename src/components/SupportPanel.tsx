import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listSupport, openSupport, replySupport } from "@/lib/feedforward.functions";
import { useMe } from "@/hooks/useMe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Row } from "@/lib/rows";
function Ticket({ ticket, admin }: { ticket: Row; admin: boolean }) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState(String(ticket.status));
  const qc = useQueryClient();
  const reply = useMutation({
    mutationFn: replySupport,
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["support"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <article className="surface-panel grid gap-3 p-5">
      <h3 className="font-semibold">
        {ticket.subject} · {String(ticket.status).replaceAll("_", " ")}
      </h3>
      <p className="text-xs">
        Ticket {ticket.id} · {new Date(ticket.created_at).toLocaleString()}
      </p>
      {[...(ticket.support_messages ?? [])]
        .sort((a: Row, b: Row) => Date.parse(a.created_at) - Date.parse(b.created_at))
        .map((m: Row) => (
          <div key={m.id} className="rounded border p-3">
            <p className="text-xs text-muted-foreground">
              {m.is_staff ? "Administrator" : "Requester"} ·{" "}
              {new Date(m.created_at).toLocaleString()}
            </p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      <Textarea
        aria-label="Reply"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={3000}
        placeholder="Reply to this ticket"
      />
      {admin && (
        <select
          aria-label="Ticket status"
          className="rounded border bg-background p-2"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
        </select>
      )}
      <Button
        disabled={reply.isPending || body.trim().length < 3}
        onClick={() => reply.mutate({ id: ticket.id, body, ...(admin ? { status } : {}) })}
      >
        Send reply{admin ? " and update status" : ""}
      </Button>
    </article>
  );
}
export default function SupportPanel() {
  const { data: me } = useMe();
  const admin = !!me?.roles.includes("admin");
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const tickets = useQuery({ queryKey: ["support"], queryFn: listSupport, refetchInterval: 15000 });
  const create = useMutation({
    mutationFn: openSupport,
    onSuccess: () => {
      setSubject("");
      setBody("");
      toast.success("Support request created");
      void qc.invalidateQueries({ queryKey: ["support"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="grid gap-4">
      <h2 className="text-2xl font-bold">{admin ? "Support inbox" : "Help & support"}</h2>
      <p className="text-sm text-muted-foreground">
        Describe the issue and include an order ID if relevant. Replies appear here. Do not send
        passwords or private keys.
      </p>
      {!admin && (
        <div className="surface-panel grid gap-3 p-5">
          <Input
            aria-label="Subject"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={140}
          />
          <Textarea
            aria-label="Problem description"
            placeholder="What happened?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={3000}
          />
          <Button
            disabled={create.isPending || subject.trim().length < 3 || body.trim().length < 3}
            onClick={() => create.mutate({ subject, body })}
          >
            Create support request
          </Button>
        </div>
      )}
      {tickets.isLoading && <p>Loading tickets…</p>}
      {tickets.error && <p role="alert">{tickets.error.message}</p>}
      {tickets.data?.length === 0 && <p>No support requests yet.</p>}
      {tickets.data?.map((t) => (
        <Ticket key={t.id} ticket={t} admin={admin} />
      ))}
    </section>
  );
}
