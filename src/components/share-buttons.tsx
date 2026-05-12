import * as React from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Check, Copy, Linkedin, Link2, MessageCircle, Twitter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type ShareButtonsProps = {
  url: string;
  title: string;
  description: string;
  via?: string; // Twitter handle without "@"
  hashtags?: string[];
};

/**
 * Build a short, complete share blurb under Twitter's 280-char limit.
 * URL is appended last so it never gets truncated by the network.
 */
function buildBlurb(title: string, description: string, max = 200) {
  const base = description ? `${title} — ${description}` : title;
  if (base.length <= max) return base;
  return base.slice(0, max - 1).trimEnd() + "…";
}

export function ShareButtons({
  url,
  title,
  description,
  via,
  hashtags = [],
}: ShareButtonsProps) {
  const [copied, setCopied] = React.useState(false);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

  const blurb = buildBlurb(title, description);

  const twitterUrl = (() => {
    const params = new URLSearchParams({ text: blurb, url });
    if (via) params.set("via", via);
    if (hashtags.length) params.set("hashtags", hashtags.join(","));
    return `https://twitter.com/intent/tweet?${params.toString()}`;
  })();

  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams(
    { url },
  ).toString()}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy link");
    }
  }

  async function buildQr() {
    if (qrDataUrl) return;
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 220,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    } catch {
      toast.error("Could not generate QR code");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs uppercase tracking-wider text-muted-foreground">
        Share
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={copyLink}
        aria-label="Copy link"
        className="gap-1.5"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </Button>

      <Button
        asChild
        variant="outline"
        size="sm"
        className="gap-1.5"
        aria-label="Share on Twitter / X"
      >
        <a href={twitterUrl} target="_blank" rel="noopener noreferrer">
          <Twitter className="h-3.5 w-3.5" /> Twitter
        </a>
      </Button>

      <Button
        asChild
        variant="outline"
        size="sm"
        className="gap-1.5"
        aria-label="Share on LinkedIn"
      >
        <a href={linkedInUrl} target="_blank" rel="noopener noreferrer">
          <Linkedin className="h-3.5 w-3.5" /> LinkedIn
        </a>
      </Button>

      <Popover onOpenChange={(open) => open && buildQr()}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-label="Share on WeChat"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WeChat
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px]" align="end">
          <div className="text-center">
            <p className="text-sm font-medium">扫码分享到微信</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open WeChat → Discover → Scan
            </p>
            <div className="mt-3 flex justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code for this article"
                  className="h-[200px] w-[200px] rounded-md border border-border bg-white p-2"
                />
              ) : (
                <div className="grid h-[200px] w-[200px] place-items-center rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
                  Generating…
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={copyLink}
              className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Copy className="h-3 w-3" /> Copy link instead
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
