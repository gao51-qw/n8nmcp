import { createFileRoute } from "@tanstack/react-router";
import { useDocsT, buildDocsRouteHead } from "@/i18n/docs-dict";

export const Route = createFileRoute("/{-$locale}/docs/n8n-instances")({
  head: ({ params }) =>
    buildDocsRouteHead({
      rawLocale: params.locale,
      pageKey: "n8nInstances",
      navItemKey: "n8nInstances",
      logicalPath: "/docs/n8n-instances",
    }),
  component: Page,
});

function Page() {
  const t = useDocsT().n8nInstances;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}