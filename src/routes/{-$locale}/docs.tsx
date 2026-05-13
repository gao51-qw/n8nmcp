import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DocsLayout } from "@/components/docs/docs-layout";

export const Route = createFileRoute("/{-$locale}/docs")({
  component: DocsRoute,
});

function DocsRoute() {
  return (
    <DocsLayout>
      <Outlet />
    </DocsLayout>
  );
}
