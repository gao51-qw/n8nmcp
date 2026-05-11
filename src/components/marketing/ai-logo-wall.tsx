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
  return (
    <section className="mx-auto max-w-6xl px-6 pb-12">
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
        Works with your favorite AI tools
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-6 md:gap-x-12">
        {TOOLS.map((t) => (
          <div
            key={t.slug}
            className="group flex items-center gap-2 opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0"
            title={t.name}
          >
            <img
              src={`https://cdn.simpleicons.org/${t.slug}`}
              alt={`${t.name} logo`}
              loading="lazy"
              decoding="async"
              className="h-6 w-6 dark:invert"
            />
            <span className="text-sm text-muted-foreground group-hover:text-foreground">
              {t.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
