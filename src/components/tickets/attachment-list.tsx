import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Paperclip, Loader2 } from "lucide-react";
import { getAttachmentUrls, type TicketAttachment } from "@/lib/tickets.functions";

export function AttachmentList({
  attachments,
  ticketId,
}: {
  attachments: TicketAttachment[];
  ticketId: string;
}) {
  const fetchUrls = useServerFn(getAttachmentUrls);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (attachments.length === 0) return;
    setLoading(true);
    fetchUrls({ data: { ticket_id: ticketId, paths: attachments.map((a) => a.path) } })
      .then(setUrls)
      .finally(() => setLoading(false));
  }, [attachments, ticketId, fetchUrls]);

  if (attachments.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1">
      {attachments.map((a) => {
        const url = urls[a.path];
        return (
          <li key={a.path}>
            {loading || !url ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {a.name}
              </span>
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Paperclip className="h-3 w-3" /> {a.name}{" "}
                <span className="text-muted-foreground">({(a.size / 1024).toFixed(0)} KB)</span>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
