export function shouldSkipCommunityPackages(
  argv: readonly string[],
  skipEnvironmentValue = process.env.N8N_KNOWLEDGE_SKIP_COMMUNITY,
): boolean {
  return argv.includes("--official-only") || skipEnvironmentValue === "1";
}
