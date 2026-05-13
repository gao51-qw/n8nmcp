import { Github, Youtube } from "lucide-react";
import { useT } from "@/i18n/context";

const VIDEOS = [
  { id: "O_yyQAIU-zU", title: "Build n8n AI Agents INSTANTLY Using Claude MCP", author: "Cole Medin" },
  { id: "B6k_vAjndMo", title: "Claude Code Builds n8n Agents INSTANTLY", author: "Nate Herk" },
  { id: "lwebcCNmSLw", title: "Why Claude Code is Better at n8n than n8n", author: "Chase AI" },
];
const REPO = "czlonkowski/n8n-mcp";

export function CommunitySection() {
  const t = useT();
  const c = t.marketing.community;
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-primary">{c.eyebrow}</p>
        <h2 className="mt-3 text-3xl font-bold md:text-4xl">{c.title}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">{c.subtitle}</p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <a href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer"
          className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Github className="h-4 w-4" /> {c.starHistory}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{c.oss}</p>
          <div className="mt-4 flex-1 overflow-hidden rounded-lg border border-border bg-background/40">
            <img src={`https://api.star-history.com/svg?repos=${REPO}&type=Date`}
              alt={c.starAlt.replace("{repo}", REPO)} loading="lazy" decoding="async"
              className="h-full w-full object-contain" />
          </div>
          <span className="mt-4 text-sm text-primary group-hover:underline">{c.viewGithub}</span>
        </a>

        <div className="flex flex-col gap-4">
          {VIDEOS.map((v) => (
            <a key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer"
              className="group flex gap-4 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-primary/40">
              <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt={v.title} loading="lazy" decoding="async"
                className="h-24 w-40 shrink-0 rounded-lg object-cover" />
              <div className="flex min-w-0 flex-col justify-center">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Youtube className="h-3.5 w-3.5" /> {v.author}
                </div>
                <h3 className="mt-1 line-clamp-2 text-sm font-semibold group-hover:text-primary">{v.title}</h3>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
