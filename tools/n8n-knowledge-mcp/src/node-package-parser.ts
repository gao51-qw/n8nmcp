import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  enrichDescriptionWithCodexMetadata,
  extractNodeDescriptionFromSource,
  parseGitHubSourceNodePackage,
  type GitHubNodePackageReference,
} from "./github-source-node-parser.js";
import {
  createPackageRootReader,
  type PackageRootReader,
} from "./package-root-reader.js";

export type NodePackageReference = {
  name: string;
  version: string;
  dir: string;
  source: "official" | "official-github" | "community";
};

export type NodeParseFailure = {
  sourcePath: string;
  message: string;
};

export type ParsedNode = {
  node_type: string;
  package_name: string;
  display_name: string;
  description: string | null;
  category: string | null;
  version: string;
  is_ai_tool: 0 | 1;
  is_trigger: 0 | 1;
  is_webhook: 0 | 1;
  properties_json: string;
  credentials_json: string;
  source_path: string;
  source_excerpt: string;
};

export type NodePackageParseResult = {
  nodes: ParsedNode[];
  expectedNodeCount: number | null;
  failures: NodeParseFailure[];
};

type NodeDescription = Record<string, any>;
type KnownNode = { sourcePath: string };

export async function parseNodePackage(
  pkg: NodePackageReference,
): Promise<NodePackageParseResult> {
  if (pkg.source === "official") return parseOfficialNodePackage(pkg);
  if (pkg.source === "official-github") {
    return parseGitHubSourceNodePackage(pkg as GitHubNodePackageReference);
  }
  return parseCommunityNodePackage(pkg);
}

async function parseOfficialNodePackage(
  pkg: NodePackageReference,
): Promise<NodePackageParseResult> {
  const packageReader = await createPackageRootReader(pkg.name, pkg.dir);
  const known = validateKnownMetadata(
    await readOfficialMetadata(pkg, packageReader, "dist/known/nodes.json"),
    pkg.name,
  );
  const rows = validateTypeMetadata(
    await readOfficialMetadata(pkg, packageReader, "dist/types/nodes.json"),
    pkg.name,
  );
  const descriptions = selectDescriptions(rows);
  const knownNames = Object.keys(known).sort();
  const descriptionNames = [...descriptions.keys()].sort();
  const knownNameSet = new Set(knownNames);
  const missing = knownNames.filter((name) => !descriptions.has(name));
  const extra = descriptionNames.filter((name) => !knownNameSet.has(name));

  if (missing.length > 0 || extra.length > 0) {
    throw metadataParityError(pkg.name, knownNames.length, descriptionNames.length, missing, extra);
  }

  const nodes: ParsedNode[] = [];
  for (const name of knownNames) {
    const description = descriptions.get(name);
    if (!description) continue;
    const sourcePath = known[name]!.sourcePath;
    const sourceExcerpt = (
      await packageReader.readText(sourcePath, "source path")
    ).slice(0, 50_000);
    nodes.push(toParsedNode(pkg, description, sourcePath, sourceExcerpt));
  }

  if (nodes.length !== knownNames.length) {
    throw metadataParityError(pkg.name, knownNames.length, nodes.length, [], []);
  }

  return { nodes, expectedNodeCount: knownNames.length, failures: [] };
}

/**
 * Community packages are untrusted npm code. They are parsed statically: each
 * node file is read through the package-root reader (so symlinks and `..`
 * entries cannot escape the extracted tarball) and its `description` object
 * literal is extracted with ts-morph. Package code is never imported or run.
 * Node files come from package.json `n8n.nodes`, falling back to a walk for
 * `*.node.js` when the manifest lists none.
 */
async function parseCommunityNodePackage(
  pkg: NodePackageReference,
): Promise<NodePackageParseResult> {
  const nodes: ParsedNode[] = [];
  const failures: NodeParseFailure[] = [];
  if (!existsSync(pkg.dir)) return { nodes, expectedNodeCount: null, failures };

  const reader = await createPackageRootReader(pkg.name, pkg.dir);
  const manifestEntries = await communityManifestNodePaths(reader);
  const sourcePaths = manifestEntries ?? (await walkNodeFiles(pkg.dir));

  for (const sourcePath of sourcePaths) {
    let source: string;
    try {
      source = await reader.readText(sourcePath, "community node path");
    } catch (error) {
      failures.push({ sourcePath, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const extracted = extractNodeDescriptionFromSource(source, sourcePath);
    if (!extracted || typeof extracted.name !== "string") {
      failures.push({ sourcePath, message: "no statically readable node description" });
      continue;
    }
    const codexPath = sourcePath.replace(/\.js$/, ".json");
    const codex = await readCodexIfExists(reader, codexPath);
    const description = enrichDescriptionWithCodexMetadata(extracted, codex) as NodeDescription;
    nodes.push({
      ...toParsedNode(pkg, description, sourcePath, source.slice(0, 50_000)),
      node_type: communityNodeType(pkg.name, String(description.name)),
    });
  }

  return {
    nodes,
    expectedNodeCount: manifestEntries ? manifestEntries.length : null,
    failures,
  };
}

/** Workflows reference community nodes as `<package>.<name>`. */
export function communityNodeType(packageName: string, name: string): string {
  return name.startsWith(`${packageName}.`) ? name : `${packageName}.${name}`;
}

async function communityManifestNodePaths(reader: PackageRootReader): Promise<string[] | null> {
  const raw = await reader.readTextIfExists("package.json", "package manifest");
  if (raw === null) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return null;
  }
  const entries = isRecord(manifest) && isRecord(manifest.n8n) ? manifest.n8n.nodes : null;
  if (!Array.isArray(entries)) return null;
  const paths = entries.filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
  return paths.length > 0 ? paths : null;
}

async function readCodexIfExists(
  reader: PackageRootReader,
  codexPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await reader.readTextIfExists(codexPath, "community codex path");
    if (raw === null) return null;
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

async function walkNodeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of walk(root)) {
    if (/\.node\.js$/.test(file)) files.push(relative(root, file).split(sep).join("/"));
  }
  return files.sort();
}

async function readOfficialMetadata(
  pkg: NodePackageReference,
  packageReader: PackageRootReader,
  metadataPath: string,
): Promise<unknown> {
  try {
    return JSON.parse(
      await packageReader.readText(metadataPath, "metadata path"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${pkg.name}: failed to read or parse ${metadataPath}: ${message}`, {
      cause: error,
    });
  }
}

function validateKnownMetadata(value: unknown, packageName: string): Record<string, KnownNode> {
  if (!isRecord(value)) {
    throw new Error(`${packageName}: dist/known/nodes.json must be a non-array object`);
  }
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.sourcePath !== "string" || !entry.sourcePath.trim()) {
      throw new Error(`${packageName}: known node ${name} must have a non-empty sourcePath`);
    }
  }
  return value as Record<string, KnownNode>;
}

function validateTypeMetadata(value: unknown, packageName: string): NodeDescription[] {
  if (!Array.isArray(value)) {
    throw new Error(`${packageName}: dist/types/nodes.json must be an array`);
  }
  for (const [index, row] of value.entries()) {
    if (!isRecord(row) || typeof row.name !== "string" || !row.name.trim()) {
      throw new Error(`${packageName}: type row ${index} must have a non-empty name`);
    }
  }
  return value as NodeDescription[];
}

function selectDescriptions(rows: NodeDescription[]): Map<string, NodeDescription> {
  const descriptions = new Map<string, NodeDescription>();
  for (const row of rows) {
    const name = String(row.name);
    const current = descriptions.get(name);
    if (!current || prefersLaterDescription(current, row)) descriptions.set(name, row);
  }
  return descriptions;
}

function prefersLaterDescription(current: NodeDescription, candidate: NodeDescription): boolean {
  const currentVersion = Number(effectiveVersion(current));
  const candidateVersion = Number(effectiveVersion(candidate));
  if (Number.isFinite(currentVersion) && Number.isFinite(candidateVersion)) {
    return candidateVersion >= currentVersion;
  }
  return true;
}

function effectiveVersion(description: NodeDescription): unknown {
  const version = Array.isArray(description.version)
    ? description.version.at(-1)
    : description.version;
  return version ?? 1;
}

function metadataParityError(
  packageName: string,
  expected: number,
  parsed: number,
  missing: string[],
  extra: string[],
): Error {
  return new Error(
    `${packageName}: official node metadata mismatch expected=${expected} parsed=${parsed} ` +
      `missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}`,
  );
}

/** Builds a node row from a node description (shared with the community DB step). */
export function parsedNodeFromDescription(
  pkg: Pick<NodePackageReference, "name" | "version">,
  description: Record<string, unknown>,
  sourcePath: string,
  sourceExcerpt = "",
): ParsedNode {
  return toParsedNode(pkg as NodePackageReference, description as NodeDescription, sourcePath, sourceExcerpt);
}

function toParsedNode(
  pkg: NodePackageReference,
  description: NodeDescription,
  sourcePath: string,
  sourceExcerpt: string,
): ParsedNode {
  const properties = Array.isArray(description.properties) ? description.properties : [];
  const credentials = Array.isArray(description.credentials) ? description.credentials : [];
  return {
    node_type: String(description.name),
    package_name: pkg.name,
    display_name: String(description.displayName ?? description.name),
    description: description.description ? String(description.description) : null,
    category: categoryOf(description),
    version: String(effectiveVersion(description)),
    is_ai_tool: isAiTool(description),
    is_trigger: /Trigger$/.test(String(description.name)) || description.polling ? 1 : 0,
    is_webhook: Array.isArray(description.webhooks) && description.webhooks.length ? 1 : 0,
    properties_json: JSON.stringify(properties),
    credentials_json: JSON.stringify(credentials),
    source_path: sourcePath,
    source_excerpt: sourceExcerpt,
  };
}

function isAiTool(description: NodeDescription): 0 | 1 {
  if (description?.usableAsTool) return 1;
  const codex = description?.codex?.categories;
  if (Array.isArray(codex) && codex.includes("AI")) return 1;
  return 0;
}

function categoryOf(description: NodeDescription): string | null {
  if (Array.isArray(description?.group) && description.group.length) {
    return String(description.group[0]);
  }
  if (typeof description?.group === "string") return description.group;
  const categories = description?.codex?.categories;
  if (Array.isArray(categories) && categories.length) return String(categories[0]);
  return null;
}

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
