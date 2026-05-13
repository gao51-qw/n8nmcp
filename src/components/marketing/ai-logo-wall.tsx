import { useT } from "@/i18n/context";

const TOOLS = [
  { name: "Claude", slug: "claude" },
  { name: "OpenAI", slug: "openai" },
  { name: "Cursor", slug: "cursor" },
  { name: "Windsurf", slug: "windsurf" },
  { name: "VS Code", slug: "visualstudiocode" },
  { name: "Gemini", slug: "googlegemini" },
  { name: "GitHub Copilot", slug: "githubcopilot" },
  { name: "Zed", slug: "zedindustries" },
  { name: "Ollama", slug: "ollama" },
  { name: "LM Studio", slug: "lmstudioai" },
  { name: "Hugging Face", slug: "huggingface" },
  { name: "Mistral", slug: "mistralai" },
  { name: "Replit", slug: "replit" },
  { name: "n8n", slug: "n8n" },
];

export function AiLogoWall() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-6 pb-12">
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
        {t.marketing.logoWall.works}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-6 md:gap-x-12">
        {TOOLS.map((tool) => (
          <div
            key={tool.slug}
            className="group flex items-center gap-2 opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0"
            title={tool.name}
          >
            <img
              src={`https://cdn.simpleicons.org/${tool.slug}`}
              alt={`${tool.name} logo`}
              loading="lazy"
              decoding="async"
              className="h-6 w-6 dark:invert"
            />
            <span className="text-sm text-muted-foreground group-hover:text-foreground">
              {tool.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
