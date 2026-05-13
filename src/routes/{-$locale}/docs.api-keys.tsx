import { createFileRoute } from "@tanstack/react-router";
import { useDocsT, buildDocsRouteHead } from "@/i18n/docs-dict";

export const Route = createFileRoute("/{-$locale}/docs/api-keys")({
  head: ({ params }) =>
    buildDocsRouteHead({
      rawLocale: params.locale,
      pageKey: "apiKeys",
      navItemKey: "apiKeys",
      logicalPath: "/docs/api-keys",
    }),
  component: Page,
});

function Page() {
  const t = useDocsT().apiKeys;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}