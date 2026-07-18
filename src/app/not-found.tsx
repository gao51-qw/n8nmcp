import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          This page has not been migrated to Next.js yet.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
