import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
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

async function parseCommunityNodePackage(
  pkg: NodePackageReference,
): Promise<NodePackageParseResult> {
  const nodes: ParsedNode[] = [];
  const failures: NodeParseFailure[] = [];
  if (!existsSync(pkg.dir)) return { nodes, expectedNodeCount: null, failures };

  for await (const file of walk(pkg.dir)) {
    if (!/\.node\.(js|json)$/.test(file)) continue;
    let description: NodeDescription | null;
    try {
      description = await loadCommunityNodeDescription(file);
    } catch (error) {
      failures.push({
        sourcePath: relative(pkg.dir, file),
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!description?.name) continue;

    let sourceExcerpt = "";
    try {
      sourceExcerpt = (await readFile(file, "utf8")).slice(0, 50_000);
    } catch {}
    nodes.push(
      toParsedNode(pkg, description, relative(pkg.dir, file), sourceExcerpt),
    );
  }

  return { nodes, expectedNodeCount: null, failures };
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

async function loadCommunityNodeDescription(file: string): Promise<NodeDescription | null> {
  if (file.endsWith(".node.json")) {
    return JSON.parse(await readFile(file, "utf8")) as NodeDescription;
  }

  const module = await import(pathToFileURL(file).href);
  for (const key of Object.keys(module)) {
    const nodeClass = (module as any)[key];
    if (typeof nodeClass !== "function") continue;
    try {
      const instance = new nodeClass();
      if (instance?.description?.name) return instance.description;
    } catch {
      const prototypeDescription = nodeClass.prototype?.description;
      if (prototypeDescription?.name) return prototypeDescription;
    }
  }
  if ((module as any).default?.description?.name) return (module as any).default.description;
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
