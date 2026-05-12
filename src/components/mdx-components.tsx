import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Components passed to MDX content. Maps default markdown elements to
 * Tailwind-styled equivalents using the project's design tokens.
 */
export const mdxComponents = {
  h1: (p: ComponentProps<"h1">) => (
    <h1 className={cn("mt-10 text-3xl font-bold tracking-tight", p.className)} {...p} />
  ),
  h2: (p: ComponentProps<"h2">) => (
    <h2 className={cn("mt-10 text-2xl font-semibold tracking-tight", p.className)} {...p} />
  ),
  h3: (p: ComponentProps<"h3">) => (
    <h3 className={cn("mt-8 text-xl font-semibold tracking-tight", p.className)} {...p} />
  ),
  p: (p: ComponentProps<"p">) => (
    <p className={cn("my-4 leading-relaxed text-foreground/90", p.className)} {...p} />
  ),
  a: (p: ComponentProps<"a">) => (
    <a
      className={cn("text-primary underline underline-offset-2 hover:opacity-80", p.className)}
      target={p.href?.startsWith("http") ? "_blank" : undefined}
      rel={p.href?.startsWith("http") ? "noopener noreferrer" : undefined}
      {...p}
    />
  ),
  ul: (p: ComponentProps<"ul">) => (
    <ul className={cn("my-4 list-disc space-y-1 pl-6", p.className)} {...p} />
  ),
  ol: (p: ComponentProps<"ol">) => (
    <ol className={cn("my-4 list-decimal space-y-1 pl-6", p.className)} {...p} />
  ),
  li: (p: ComponentProps<"li">) => (
    <li className={cn("leading-relaxed", p.className)} {...p} />
  ),
  blockquote: (p: ComponentProps<"blockquote">) => (
    <blockquote
      className={cn("my-4 border-l-2 border-primary/40 pl-4 italic text-muted-foreground", p.className)}
      {...p}
    />
  ),
  hr: (p: ComponentProps<"hr">) => <hr className={cn("my-8 border-border", p.className)} {...p} />,
  code: ({ className, ...rest }: ComponentProps<"code">) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) return <code className={cn(className, "block")} {...rest} />;
    return (
      <code
        className={cn(
          "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground",
          className,
        )}
        {...rest}
      />
    );
  },
  pre: (p: ComponentProps<"pre">) => (
    <pre
      className={cn(
        "my-4 overflow-x-auto rounded-md border border-border bg-muted/60 p-4 font-mono text-xs leading-relaxed text-foreground",
        p.className,
      )}
      {...p}
    />
  ),
  table: (p: ComponentProps<"table">) => (
    <div className="my-4 overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", p.className)} {...p} />
    </div>
  ),
  th: (p: ComponentProps<"th">) => (
    <th
      className={cn("border border-border bg-muted/40 px-3 py-1.5 text-left font-semibold", p.className)}
      {...p}
    />
  ),
  td: (p: ComponentProps<"td">) => (
    <td className={cn("border border-border px-3 py-1.5", p.className)} {...p} />
  ),
  strong: (p: ComponentProps<"strong">) => (
    <strong className={cn("font-semibold text-foreground", p.className)} {...p} />
  ),
  img: (p: ComponentProps<"img">) => (
    <img className={cn("my-6 rounded-lg border border-border", p.className)} loading="lazy" {...p} />
  ),
};
