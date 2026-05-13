import { createFileRoute } from "@tanstack/react-router";
import { useDocsT, buildDocsRouteHead } from "@/i18n/docs-dict";

export const Route = createFileRoute("/{-$locale}/docs/getting-started")({
  head: ({ params }) =>
    buildDocsRouteHead({
      rawLocale: params.locale,
      pageKey: "gettingStarted",
      navItemKey: "gettingStarted",
      logicalPath: "/docs/getting-started",
    }),
  component: Page,
});

function Page() {
  const t = useDocsT().gettingStarted;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}