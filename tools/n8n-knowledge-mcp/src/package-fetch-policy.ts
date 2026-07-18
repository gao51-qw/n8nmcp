export function shouldSkipCommunityPackages(
  argv: readonly string[],
  skipEnvironmentValue = process.env.N8N_KNOWLEDGE_SKIP_COMMUNITY,
): boolean {
  return argv.includes("--official-only") || skipEnvironmentValue === "1";
}

export type FetchedPackageIdentity = {
  name: string;
  source: "official" | "official-github" | "community";
};

export function assertOfficialPackageCoverage(
  configuredOfficial: readonly string[],
  fetched: readonly FetchedPackageIdentity[],
): void {
  const fetchedOfficial = new Set(
    fetched
      .filter((item) => item.source === "official" || item.source === "official-github")
      .map((item) => item.name),
  );
  const missing = configuredOfficial.filter((name) => !fetchedOfficial.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing official packages after fetch: ${missing.join(", ")}`);
  }
}
