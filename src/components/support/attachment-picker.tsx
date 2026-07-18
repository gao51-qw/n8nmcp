"use client";

import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function validateSupportFiles(files: readonly File[]): string | null {
  if (files.length > MAX_FILES) return "You can attach up to 5 files.";
  if (files.some((file) => file.size > MAX_FILE_SIZE)) {
    return "Each attachment must be 10 MB or smaller.";
  }
  return null;
}

type AttachmentPickerProps = {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
};

export function AttachmentPicker({ files, onChange, disabled }: AttachmentPickerProps) {
  const error = validateSupportFiles(files);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild type="button" variant="ghost" size="sm" disabled={disabled}>
          <label className="cursor-pointer">
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            Attach files
            <input
              className="sr-only"
              type="file"
              multiple
              disabled={disabled}
              onChange={(event) => {
                const next = [...files, ...Array.from(event.currentTarget.files ?? [])];
                if (!validateSupportFiles(next)) onChange(next);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </Button>
        <span className="text-xs text-muted-foreground">Up to 5 files, 10 MB each</span>
      </div>

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Selected attachments">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
