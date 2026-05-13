import { createFileRoute } from "@tanstack/react-router";
import { useDocsT, buildDocsRouteHead } from "@/i18n/docs-dict";

export const Route = createFileRoute("/{-$locale}/docs/clients")({
  head: ({ params }) =>
    buildDocsRouteHead({
      rawLocale: params.locale,
      pageKey: "clients",
      navItemKey: "clients",
      logicalPath: "/docs/clients",
    }),
  component: Page,
});

function Page() {
  const t = useDocsT().clients;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}