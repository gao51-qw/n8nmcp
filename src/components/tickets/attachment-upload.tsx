import { useState } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { TicketAttachment } from "@/lib/tickets.functions";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

type Props = {
  /** Stable folder under the user's prefix (e.g. ticket id or "drafts"). */
  folder: string;
  value: TicketAttachment[];
  onChange: (next: TicketAttachment[]) => void;
};

export function AttachmentUpload({ folder, value, onChange }: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    if (value.length + files.length > MAX_FILES) {
      toast.error(`You can attach at most ${MAX_FILES} files`);
      return;
    }
    setBusy(true);
    const next = [...value];
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_SIZE) {
          toast.error(`${file.name} exceeds 10 MB`);
          continue;
        }
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
        const path = `${user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
        const { error } = await supabase.storage
          .from("ticket-attachments")
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (error) {
          toast.error(`Upload failed: ${file.name}`);
          continue;
        }
        next.push({ path, name: file.name, size: file.size, type: file.type });
      }
      onChange(next);
    } finally {
      setBusy(false);
    }
  };

  const removeAt = async (idx: number) => {
    const att = value[idx];
    if (att) {
      await supabase.storage.from("ticket-attachments").remove([att.path]);
    }
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <label className="inline-flex">
        <input
          type="file"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" asChild disabled={busy}>
          <span className="cursor-pointer">
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip className="mr-1 h-3.5 w-3.5" />
            )}
            Add attachment
          </span>
        </Button>
      </label>
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((a, i) => (
            <li
              key={a.path}
              className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="truncate">
                {a.name}{" "}
                <span className="text-muted-foreground">({(a.size / 1024).toFixed(0)} KB)</span>
              </span>
              <button
                type="button"
                onClick={() => void removeAt(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Up to {MAX_FILES} files, each ≤ 10 MB
      </p>
    </div>
  );
}
