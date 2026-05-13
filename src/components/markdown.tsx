import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useRef, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";

function CodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const getText = () => ref.current?.innerText ?? "";

  const tryParseJson = (): { ok: true; obj: any; text: string } | { ok: false } => {
    const text = getText().trim();
    if (!text || (text[0] !== "{" && text[0] !== "[")) return { ok: false };
    try {
      return { ok: true, obj: JSON.parse(text), text };
    } catch {
      return { ok: false };
    }
  };

  const looksLikeN8n = (obj: any) =>
    obj && typeof obj === "object" && Array.isArray(obj.nodes) && obj.connections;

  const [isN8n, setIsN8n] = useState(false);
  // Recompute on each render using ref text — cheap.
  const parsed = ref.current ? tryParseJson() : { ok: false as const };
  const showDownload = parsed.ok && looksLikeN8n(parsed.obj);
  void isN8n; void setIsN8n;

  const onCopy = async () => {
    const text = ref.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("已复制到剪贴板", { duration: 1000 });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败", { duration: 1000 });
    }
  };

  const onDownload = () => {
    const p = tryParseJson();
    if (!p.ok) {
      toast.error("无法解析为 JSON", { duration: 1200 });
      return;
    }
    const pretty = JSON.stringify(p.obj, null, 2);
    const rawName = typeof p.obj?.name === "string" && p.obj.name.trim() ? p.obj.name.trim() : "n8n-workflow";
    const safe = rawName.replace(/[^\w\u4e00-\u9fa5.\- ]+/g, "_").slice(0, 80);
    const blob = new Blob([pretty], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("已开始下载", { duration: 1000 });
  };

  return (
    <div className="group relative my-3">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {showDownload && (
          <button
            type="button"
            onClick={onDownload}
            aria-label="Download .json"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background/80 px-2 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur transition hover:text-foreground"
          >
            <Download className="h-3 w-3" />
            .json
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background/80 px-2 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur transition hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        ref={ref}
        className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 pr-16 font-mono text-xs leading-relaxed text-foreground"
        {...props}
      />
    </div>
  );
}

/**
 * Safe Markdown renderer for announcement bodies.
 * Sanitizes HTML, supports GFM (tables, task lists, strikethrough, autolinks).
 */
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div
      className={`prose-announcement text-sm text-muted-foreground ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ node, ...p }) => <h3 className="mt-3 text-base font-semibold text-foreground" {...p} />,
          h2: ({ node, ...p }) => <h4 className="mt-3 text-sm font-semibold text-foreground" {...p} />,
          h3: ({ node, ...p }) => <h5 className="mt-3 text-sm font-semibold text-foreground" {...p} />,
          p: ({ node, ...p }) => <p className="my-2 leading-relaxed" {...p} />,
          ul: ({ node, ...p }) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
          ol: ({ node, ...p }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
          li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
          a: ({ node, ...p }) => (
            <a
              className="text-primary underline underline-offset-2 hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          blockquote: ({ node, ...p }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 italic" {...p} />
          ),
          hr: () => <hr className="my-4 border-border" />,
          code: ({ node, className, children, ...p }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code className={`${className ?? ""} block`} {...p}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
                {...p}
              >
                {children}
              </code>
            );
          },
          pre: ({ node, ...p }) => <CodeBlock {...p} />,
          table: ({ node, ...p }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...p} />
            </div>
          ),
          th: ({ node, ...p }) => (
            <th className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold" {...p} />
          ),
          td: ({ node, ...p }) => <td className="border border-border px-2 py-1" {...p} />,
          strong: ({ node, ...p }) => <strong className="font-semibold text-foreground" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
