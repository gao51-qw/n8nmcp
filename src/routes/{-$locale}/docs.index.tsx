import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@/i18n/link";
import { useDocsT, buildDocsRouteHead } from "@/i18n/docs-dict";

export const Route = createFileRoute("/{-$locale}/docs/")({
  head: ({ params }) =>
    buildDocsRouteHead({
      rawLocale: params.locale,
      pageKey: "index",
      navItemKey: "overview",
      logicalPath: "/docs",
    }),
  component: DocsIndex,
});

function DocsIndex() {
  const t = useDocsT().index;
  return (
    <>
      <h1>{t.h1}</h1>
      <p className="lead text-muted-foreground">{t.lead}</p>
      <p className="text-muted-foreground">
        {t.pickPrefix}
        <Link to="/docs/getting-started">{t.pickLink}</Link>
        {t.pickSuffix}
      </p>

      <div className="not-prose mt-8 grid gap-3 sm:grid-cols-2">
        {t.cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <div className="font-semibold text-foreground group-hover:text-primary">{c.title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{c.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}