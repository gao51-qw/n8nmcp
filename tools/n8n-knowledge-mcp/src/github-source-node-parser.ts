import { posix, win32 } from "node:path";
import { Node, Project, ScriptKind, SyntaxKind, type Expression, type ObjectLiteralExpression, type SourceFile } from "ts-morph";
import type { NodePackageParseResult, ParsedNode } from "./node-package-parser.js";
import {
  createPackageRootReader,
  type PackageRootReader,
} from "./package-root-reader.js";

type JsonObject = Record<string, unknown>;

export type GitHubNodePackageReference = {
  name: string;
  version: string;
  dir: string;
  source: "official-github";
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanPropertyName(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function expressionToValue(expression: Expression, scope: Map<string, unknown>): unknown {
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) return expression.getLiteralText();
  if (Node.isNumericLiteral(expression)) return Number(expression.getLiteralText());
  if (expression.getKind() === SyntaxKind.TrueKeyword) return true;
  if (expression.getKind() === SyntaxKind.FalseKeyword) return false;
  if (expression.getKind() === SyntaxKind.NullKeyword) return null;
  if (Node.isIdentifier(expression)) return scope.has(expression.getText()) ? scope.get(expression.getText()) : expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getText();
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().map((element) => Node.isSpreadElement(element) ? element.getText() : expressionToValue(element as Expression, scope));
  }
  if (Node.isObjectLiteralExpression(expression)) return objectLiteralToValue(expression, scope);
  return expression.getText().slice(0, 2_000);
}

function objectLiteralToValue(object: ObjectLiteralExpression, scope: Map<string, unknown>): JsonObject {
  const value: JsonObject = {};
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spread = expressionToValue(property.getExpression(), scope);
      if (isRecord(spread)) Object.assign(value, spread);
    } else if (Node.isPropertyAssignment(property)) {
      value[cleanPropertyName(property.getNameNode().getText())] = expressionToValue(property.getInitializerOrThrow(), scope);
    } else if (Node.isShorthandPropertyAssignment(property)) {
      const name = property.getName();
      value[name] = scope.has(name) ? scope.get(name) : name;
    } else if (Node.isMethodDeclaration(property)) {
      value[cleanPropertyName(property.getNameNode().getText())] = property.getText().slice(0, 2_000);
    }
  }
  return value;
}

function createSourceFile(source: string, fileName: string): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  return project.createSourceFile(fileName, source, { overwrite: true, scriptKind: fileName.endsWith(".ts") ? ScriptKind.TS : ScriptKind.JS });
}

function collectObjectLiteralScope(sourceFile: SourceFile): Map<string, unknown> {
  const scope = new Map<string, unknown>();
  sourceFile.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return;
    const initializer = node.getInitializer();
    if (initializer && Node.isObjectLiteralExpression(initializer)) scope.set(node.getName(), objectLiteralToValue(initializer, scope));
  });
  return scope;
}

function candidateObjectLiterals(sourceFile: SourceFile): ObjectLiteralExpression[] {
  const candidates: ObjectLiteralExpression[] = [];
  sourceFile.forEachDescendant((node) => {
    if (Node.isCallExpression(node) && node.getExpression().getText().includes("createVectorStoreNode")) {
      const argument = node.getArguments()[0];
      if (argument && Node.isObjectLiteralExpression(argument)) {
        const meta = argument.getProperty("meta");
        if (Node.isPropertyAssignment(meta)) {
          const initializer = meta.getInitializer();
          if (initializer && Node.isObjectLiteralExpression(initializer)) candidates.push(initializer);
        }
      }
    } else if (Node.isVariableDeclaration(node)) {
      const initializer = node.getInitializer();
      if (["baseDescription", "description", "versionDescription"].includes(node.getName()) && initializer && Node.isObjectLiteralExpression(initializer)) candidates.push(initializer);
    } else if (Node.isPropertyDeclaration(node)) {
      const initializer = node.getInitializer();
      if (node.getName() === "description" && initializer && Node.isObjectLiteralExpression(initializer)) candidates.push(initializer);
    } else if (Node.isBinaryExpression(node)) {
      const right = node.getRight();
      if (node.getLeft().getText().endsWith(".description") && Node.isObjectLiteralExpression(right)) candidates.push(right);
    }
  });
  return candidates;
}

function normalizeFactoryDescription(description: JsonObject): JsonObject {
  if (typeof description.name !== "string" || typeof description.displayName !== "string") return description;
  const codex = isRecord(description.codex) ? description.codex : {};
  return { group: ["transform"], version: 1, ...description, codex: { ...codex, categories: Array.isArray(codex.categories) ? codex.categories : ["AI"] } };
}

export function extractNodeDescriptionFromSource(source: string, fileName = "node.node.js"): Record<string, unknown> | null {
  const sourceFile = createSourceFile(source, fileName);
  const scope = collectObjectLiteralScope(sourceFile);
  for (const literal of candidateObjectLiterals(sourceFile)) {
    const description = normalizeFactoryDescription(objectLiteralToValue(literal, scope));
    if (typeof description.name === "string" && typeof description.displayName === "string") return description;
  }
  return null;
}

function normalizeCodexMetadata(metadata: JsonObject): JsonObject | null {
  const codex: JsonObject = {};
  if (Array.isArray(metadata.categories)) codex.categories = metadata.categories;
  if (Array.isArray(metadata.alias)) codex.alias = metadata.alias;
  if (isRecord(metadata.subcategories)) codex.subcategories = metadata.subcategories;
  if (isRecord(metadata.resources)) codex.resources = metadata.resources;
  return Object.keys(codex).length > 0 ? codex : null;
}

export function enrichDescriptionWithCodexMetadata(description: Record<string, unknown>, metadata: Record<string, unknown> | null): Record<string, unknown> {
  if (!metadata) return description;
  const codex = normalizeCodexMetadata(metadata);
  if (!codex) return description;
  return { ...description, codex: { ...(isRecord(description.codex) ? description.codex : {}), ...codex } };
}

async function readJsonIfExists(
  reader: PackageRootReader,
  sourcePath: string,
  context: string,
): Promise<unknown | null> {
  const source = await reader.readTextIfExists(sourcePath, context);
  if (source === null) return null;
  try { return JSON.parse(source) as unknown; } catch { return null; }
}

function hasCompleteDescription(value: unknown): value is JsonObject {
  return isRecord(value) && typeof value.name === "string" && typeof value.displayName === "string";
}

function importMapOf(sourceFile: SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) imports.set(defaultImport.getText(), specifier);
    for (const namedImport of declaration.getNamedImports()) {
      imports.set(namedImport.getName(), specifier);
      const alias = namedImport.getAliasNode();
      if (alias) imports.set(alias.getText(), specifier);
    }
  }
  return imports;
}

function descriptionIdentifierReferences(sourceFile: SourceFile): Set<string> {
  const references = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (Node.isPropertyDeclaration(node) && node.getName() === "description") {
      const initializer = node.getInitializer();
      if (initializer && Node.isIdentifier(initializer)) references.add(initializer.getText());
    } else if (Node.isBinaryExpression(node) && node.getLeft().getText().endsWith(".description")) {
      const right = node.getRight();
      if (Node.isIdentifier(right)) references.add(right.getText());
    }
  });
  for (const literal of candidateObjectLiterals(sourceFile)) {
    for (const property of literal.getProperties()) {
      if (Node.isSpreadAssignment(property) && Node.isIdentifier(property.getExpression())) references.add(property.getExpression().getText());
    }
  }
  return references;
}

function localImportCandidates(
  packageName: string,
  sourcePath: string,
  specifier: string,
): string[] {
  const portableSpecifier = specifier.replaceAll("\\", "/");
  if (posix.isAbsolute(portableSpecifier) || win32.isAbsolute(specifier)) {
    throw new Error(
      `${packageName}: import ${specifier} must be relative to the package root`,
    );
  }
  if (!portableSpecifier.startsWith(".")) return [];
  const base = posix.join(posix.dirname(sourcePath), portableSpecifier);
  return [base, `${base}.ts`, `${base}.js`, posix.join(base, "index.ts"), posix.join(base, "index.js")];
}

async function extractImportedNodeDescription(
  reader: PackageRootReader,
  packageName: string,
  source: string,
  sourcePath: string,
): Promise<JsonObject | null> {
  const sourceFile = createSourceFile(source, posix.basename(sourcePath));
  const imports = importMapOf(sourceFile);
  for (const reference of descriptionIdentifierReferences(sourceFile)) {
    const specifier = imports.get(reference);
    if (!specifier) continue;
    for (const candidate of localImportCandidates(packageName, sourcePath, specifier)) {
      const importedSource = await reader.readTextIfExists(
        candidate,
        `import ${specifier} from ${sourcePath}`,
      );
      if (importedSource === null) continue;
      const imported = extractNodeDescriptionFromSource(importedSource, posix.basename(candidate));
      if (hasCompleteDescription(imported)) return imported;
    }
  }
  return null;
}

async function loadNodeDescription(
  reader: PackageRootReader,
  packageName: string,
  sourcePath: string,
  source: string,
): Promise<JsonObject | null> {
  const direct = extractNodeDescriptionFromSource(source, posix.basename(sourcePath));
  const description = hasCompleteDescription(direct)
    ? direct
    : await extractImportedNodeDescription(reader, packageName, source, sourcePath);
  if (!hasCompleteDescription(description)) return null;
  const metadataPath = sourcePath.replace(/\.(js|ts)$/, ".json");
  const metadataValue = await readJsonIfExists(
    reader,
    metadataPath,
    `codex sidecar for ${sourcePath}`,
  );
  return enrichDescriptionWithCodexMetadata(description, isRecord(metadataValue) ? metadataValue : null);
}

function sourcePathFromRegisteredNodePath(packageName: string, registeredPath: string): string {
  const portablePath = registeredPath.replaceAll("\\", "/");
  if (!/^dist\/.+\.node(?:\.ee)?\.js$/.test(portablePath)) {
    throw new Error(
      `${packageName}: registry source ${registeredPath} must be a dist/**/*.node.js or dist/**/*.node.ee.js path`,
    );
  }
  return portablePath
    .replace(/^dist\//, "")
    .replace(/\.node(\.ee)?\.js$/, ".node$1.ts");
}

async function loadRegisteredNodeSourcePaths(
  reader: PackageRootReader,
  pkg: GitHubNodePackageReference,
): Promise<string[]> {
  const packageJson = await readJsonIfExists(reader, "package.json", "package registry");
  const nodes = isRecord(packageJson) && isRecord(packageJson.n8n) ? packageJson.n8n.nodes : null;
  if (!Array.isArray(nodes)) throw new Error(`${pkg.name}: package.json n8n.nodes must be an array`);
  return nodes.map((sourcePath, index) => {
    if (typeof sourcePath !== "string") {
      throw new Error(`${pkg.name}: registry entry ${index} must be a string`);
    }
    return sourcePathFromRegisteredNodePath(pkg.name, sourcePath);
  });
}

function effectiveVersion(description: JsonObject): unknown {
  if (description.defaultVersion !== undefined) return description.defaultVersion;
  if (Array.isArray(description.version)) return description.version.at(-1) ?? 1;
  return description.version ?? 1;
}

function prefersLaterDescription(current: JsonObject, candidate: JsonObject): boolean {
  const currentVersion = Number(effectiveVersion(current));
  const candidateVersion = Number(effectiveVersion(candidate));
  return Number.isFinite(currentVersion) && Number.isFinite(candidateVersion) ? candidateVersion >= currentVersion : true;
}

async function loadTypeDescriptions(reader: PackageRootReader): Promise<Map<string, JsonObject> | null> {
  const value = await readJsonIfExists(reader, "dist/types/nodes.json", "type metadata");
  if (!Array.isArray(value)) return null;
  const descriptions = new Map<string, JsonObject>();
  for (const row of value) {
    if (!hasCompleteDescription(row)) continue;
    const current = descriptions.get(row.name as string);
    if (!current || prefersLaterDescription(current, row)) descriptions.set(row.name as string, row);
  }
  return descriptions.size > 0 ? descriptions : null;
}

async function loadKnownSourceNames(
  reader: PackageRootReader,
  packageName: string,
): Promise<Map<string, string>> {
  const value = await readJsonIfExists(reader, "dist/known/nodes.json", "known metadata");
  const names = new Map<string, string>();
  if (!isRecord(value)) return names;
  for (const [name, entry] of Object.entries(value)) {
    if (isRecord(entry) && typeof entry.sourcePath === "string") {
      names.set(sourcePathFromRegisteredNodePath(packageName, entry.sourcePath).toLowerCase(), name);
    }
  }
  return names;
}

function categoryOf(description: JsonObject): string | null {
  if (Array.isArray(description.group) && description.group.length > 0) return String(description.group[0]);
  if (typeof description.group === "string") return description.group;
  const categories = isRecord(description.codex) ? description.codex.categories : null;
  return Array.isArray(categories) && categories.length > 0 ? String(categories[0]) : null;
}

function isAiTool(description: JsonObject): 0 | 1 {
  if (description.usableAsTool) return 1;
  const categories = isRecord(description.codex) ? description.codex.categories : null;
  return Array.isArray(categories) && categories.includes("AI") ? 1 : 0;
}

function hasGroup(description: JsonObject, group: string): boolean {
  return typeof description.group === "string" ? description.group === group : Array.isArray(description.group) && description.group.includes(group);
}

function toParsedNode(
  pkg: GitHubNodePackageReference,
  description: JsonObject,
  sourcePath: string,
  sourceExcerpt: string,
): ParsedNode {
  return {
    node_type: String(description.name), package_name: pkg.name, display_name: String(description.displayName),
    description: description.description ? String(description.description) : null,
    category: categoryOf(description), version: String(effectiveVersion(description)), is_ai_tool: isAiTool(description),
    is_trigger: /Trigger$/.test(String(description.name)) || description.polling || hasGroup(description, "trigger") ? 1 : 0,
    is_webhook: Array.isArray(description.webhooks) && description.webhooks.length > 0 ? 1 : 0,
    properties_json: JSON.stringify(Array.isArray(description.properties) ? description.properties : []),
    credentials_json: JSON.stringify(Array.isArray(description.credentials) ? description.credentials : []),
    source_path: sourcePath, source_excerpt: sourceExcerpt,
  };
}

export async function parseGitHubSourceNodePackage(pkg: GitHubNodePackageReference): Promise<NodePackageParseResult> {
  const reader = await createPackageRootReader(pkg.name, pkg.dir);
  const registeredPaths = await loadRegisteredNodeSourcePaths(reader, pkg);
  const descriptions = await loadTypeDescriptions(reader);
  const knownNames = descriptions
    ? await loadKnownSourceNames(reader, pkg.name)
    : new Map<string, string>();
  const nodesByType = new Map<string, ParsedNode>();
  const failures: NodePackageParseResult["failures"] = [];
  for (const sourcePath of registeredPaths) {
    const source = await reader.readText(sourcePath, "registered source");
    const knownName = knownNames.get(sourcePath.toLowerCase());
    const preferred = knownName ? descriptions?.get(knownName) ?? null : null;
    const description = preferred ?? await loadNodeDescription(
      reader,
      pkg.name,
      sourcePath,
      source,
    );
    if (!hasCompleteDescription(description)) {
      failures.push({ sourcePath, message: "registered node has no statically parseable description" });
      continue;
    }
    const node = toParsedNode(pkg, description, sourcePath, source.slice(0, 50_000));
    if (!nodesByType.has(node.node_type)) nodesByType.set(node.node_type, node);
  }
  const nodes = [...nodesByType.values()];
  if (nodes.length !== registeredPaths.length) throw new Error(`${pkg.name}: GitHub node registry mismatch expected=${registeredPaths.length} parsed=${nodes.length}`);
  return { nodes, expectedNodeCount: registeredPaths.length, failures };
}
