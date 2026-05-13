import { createFileRoute } from "@tanstack/react-router";
import { useDocsT, buildDocsRouteHead } from "@/i18n/docs-dict";

export const Route = createFileRoute("/{-$locale}/docs/tools")({
  head: ({ params }) =>
    buildDocsRouteHead({
      rawLocale: params.locale,
      pageKey: "tools",
      navItemKey: "tools",
      logicalPath: "/docs/tools",
    }),
  component: Page,
});

function Page() {
  const t = useDocsT().tools;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}