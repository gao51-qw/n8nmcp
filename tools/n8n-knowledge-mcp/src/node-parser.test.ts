import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  enrichDescriptionWithCodexMetadata,
  extractNodeDescriptionFromSource,
  parseGitHubSourceNodePackage,
} from "./github-source-node-parser.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("n8n official GitHub node parser", () => {
  it("extracts official VersionedNodeType baseDescription without executing the node module", () => {
    const source = `
      throw new Error('must not execute');
      class HttpRequest extends VersionedNodeType {
        constructor() {
          const baseDescription = {
            displayName: 'HTTP Request',
            name: 'httpRequest',
            icon: { light: 'file:httprequest.svg', dark: 'file:httprequest.dark.svg' },
            group: ['output'],
            description: 'Makes an HTTP request and returns the response data',
            defaultVersion: 4.4,
          };
          super({}, baseDescription);
        }
      }
    `;

    expect(extractNodeDescriptionFromSource(source, "HttpRequest.node.js")).toMatchObject({
      displayName: "HTTP Request",
      name: "httpRequest",
      group: ["output"],
      description: "Makes an HTTP request and returns the response data",
      defaultVersion: 4.4,
    });
  });

  it("extracts class field description literals from compiled official nodes", () => {
    const source = `
      class Code {
        description = {
          displayName: 'Code',
          name: 'code',
          group: ['transform'],
          version: [1, 2],
          defaultVersion: 2,
          description: 'Run custom JavaScript or Python code',
          properties: [{ displayName: 'Mode', name: 'mode', type: 'options', required: true, default: 'runOnceForAllItems' }],
          credentials: [{ name: 'openAiApi', required: true }],
        };
      }
    `;

    expect(extractNodeDescriptionFromSource(source, "Code.node.js")).toMatchObject({
      displayName: "Code",
      name: "code",
      group: ["transform"],
      version: [1, 2],
      defaultVersion: 2,
      properties: [expect.objectContaining({ name: "mode", displayName: "Mode", required: true })],
      credentials: [expect.objectContaining({ name: "openAiApi" })],
    });
  });

  it("extracts assignment description literals", () => {
    const source = `
      class Webhook {}
      Webhook.prototype.description = {
        displayName: 'Webhook',
        name: 'webhook',
        group: ['trigger'],
        version: 1,
      };
    `;

    expect(extractNodeDescriptionFromSource(source, "Webhook.node.js")).toMatchObject({
      displayName: "Webhook",
      name: "webhook",
      group: ["trigger"],
      version: 1,
    });
  });

  it("extracts createVectorStoreNode factory metadata", () => {
    const source = `
      export const VectorStore = createVectorStoreNode({
        meta: {
          displayName: 'Vector Store',
          name: 'vectorStore',
          description: 'Stores vector embeddings',
        },
      });
    `;

    expect(extractNodeDescriptionFromSource(source, "VectorStore.node.ts")).toMatchObject({
      displayName: "Vector Store",
      name: "vectorStore",
      group: ["transform"],
      version: 1,
      codex: { categories: ["AI"] },
    });
  });

  it("uses .node.json as codex metadata enrichment, not as a standalone node description", () => {
    const description = enrichDescriptionWithCodexMetadata(
      { displayName: "HTTP Request", name: "httpRequest", group: ["output"] },
      {
        node: "n8n-nodes-base.httpRequest",
        categories: ["Development", "Core Nodes"],
        alias: ["API", "Request"],
      },
    );

    expect(description).toMatchObject({
      name: "httpRequest",
      codex: { categories: ["Development", "Core Nodes"], alias: ["API", "Request"] },
    });
  });

  it("uses official GitHub package.json n8n.nodes registry when dist metadata is unavailable", async () => {
    const dir = await temporaryDirectory();
    await mkdir(join(dir, "nodes", "HttpRequest"), { recursive: true });
    await mkdir(join(dir, "nodes", "InternalVersion"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "n8n-nodes-base", n8n: { nodes: ["dist/nodes/HttpRequest/HttpRequest.node.js"] } }),
    );
    await writeFile(
      join(dir, "nodes", "HttpRequest", "HttpRequest.node.ts"),
      `export class HttpRequest extends VersionedNodeType {
        constructor() {
          const baseDescription = {
            displayName: 'HTTP Request', name: 'httpRequest', group: ['output'],
            description: 'Makes an HTTP request and returns the response data', defaultVersion: 4.4,
          };
          super({}, baseDescription);
        }
      }`,
    );
    await writeFile(
      join(dir, "nodes", "InternalVersion", "InternalVersion.node.ts"),
      `export class InternalVersion {
        description = { displayName: 'Internal Version', name: 'internalVersion', group: ['transform'], version: 1 };
      }`,
    );

    const result = await parseGitHubSourceNodePackage({
      name: "n8n-nodes-base",
      version: "github",
      dir,
      source: "official-github",
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        node_type: "httpRequest",
        display_name: "HTTP Request",
        version: "4.4",
        source_path: "nodes/HttpRequest/HttpRequest.node.ts",
      }),
    ]);
    expect(result.expectedNodeCount).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("resolves imported node descriptions without executing source modules", async () => {
    const dir = await temporaryDirectory();
    await mkdir(join(dir, "nodes", "Imported"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "n8n-nodes-base", n8n: { nodes: ["dist/nodes/Imported/Imported.node.js"] } }),
    );
    await writeFile(
      join(dir, "nodes", "Imported", "Imported.node.ts"),
      `throw new Error('must not execute');
       import { description as importedDescription } from './description';
       export class Imported { description = importedDescription; }`,
    );
    await writeFile(
      join(dir, "nodes", "Imported", "description.ts"),
      `export const description = {
        displayName: 'Imported Node', name: 'importedNode', group: ['transform'], version: 2,
      };`,
    );

    const result = await parseGitHubSourceNodePackage({
      name: "n8n-nodes-base",
      version: "github",
      dir,
      source: "official-github",
    });

    expect(result.nodes).toEqual([
      expect.objectContaining({
        node_type: "importedNode",
        source_path: "nodes/Imported/Imported.node.ts",
      }),
    ]);
  });

  it("rejects a missing GitHub package directory with package context", async () => {
    const dir = await temporaryDirectory();
    await rm(dir, { recursive: true, force: true });

    await expect(
      parseGitHubSourceNodePackage({
        name: "n8n-nodes-base",
        version: "github",
        dir,
        source: "official-github",
      }),
    ).rejects.toThrow(/n8n-nodes-base.*package directory.*does not exist/i);
  });

  it("rejects a registered source path that traverses outside the package root", async () => {
    const dir = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const outsideSource = join(outside, "Outside.node.ts");
    await writeFile(
      outsideSource,
      `export class Outside {
        description = { displayName: 'Outside', name: 'outside', group: ['transform'], version: 1 };
      }`,
    );
    const escapedRegistryPath = `dist/${portablePath(relative(dir, outsideSource)).replace(/\.ts$/, ".js")}`;
    await writeRegistry(dir, escapedRegistryPath);

    await expect(parseGitHubPackage(dir)).rejects.toThrow(
      /n8n-nodes-base.*source.*outside.*package root/i,
    );
  });

  it("rejects a registered source symlink that escapes the package root", async () => {
    const dir = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await mkdir(join(dir, "nodes"), { recursive: true });
    await writeFile(
      join(outside, "Escaped.node.ts"),
      `export class Escaped {
        description = { displayName: 'Escaped', name: 'escaped', group: ['transform'], version: 1 };
      }`,
    );
    await symlink(
      outside,
      join(dir, "nodes", "Escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeRegistry(dir, "dist/nodes/Escape/Escaped.node.js");

    await expect(parseGitHubPackage(dir)).rejects.toThrow(
      /n8n-nodes-base.*source.*outside.*package root/i,
    );
  });

  it("rejects an imported description path that traverses outside the package root", async () => {
    const dir = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const nodeDirectory = join(dir, "nodes", "Imported");
    const outsideDescription = join(outside, "description.ts");
    await mkdir(nodeDirectory, { recursive: true });
    await writeFile(
      outsideDescription,
      `export const description = {
        displayName: 'Outside Description', name: 'outsideDescription', group: ['transform'], version: 1,
      };`,
    );
    const importSpecifier = portablePath(relative(nodeDirectory, outsideDescription)).replace(/\.ts$/, "");
    await writeFile(
      join(nodeDirectory, "Imported.node.ts"),
      `import { description as importedDescription } from '${importSpecifier}';
       export class Imported { description = importedDescription; }`,
    );
    await writeRegistry(dir, "dist/nodes/Imported/Imported.node.js");

    await expect(parseGitHubPackage(dir)).rejects.toThrow(
      /n8n-nodes-base.*import.*outside.*package root/i,
    );
  });

  it("rejects a codex sidecar symlink that escapes the package root", async () => {
    const dir = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const nodeDirectory = join(dir, "nodes", "Codex");
    const outsideMetadata = join(outside, "Codex.node.json");
    await mkdir(nodeDirectory, { recursive: true });
    await writeFile(
      join(nodeDirectory, "Codex.node.ts"),
      `export class Codex {
        description = { displayName: 'Codex', name: 'codex', group: ['transform'], version: 1 };
      }`,
    );
    await writeFile(outsideMetadata, JSON.stringify({ categories: ["Outside"] }));
    try {
      await symlink(outsideMetadata, join(nodeDirectory, "Codex.node.json"), "file");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(["EPERM", "EACCES", "ENOTSUP"]).toContain(
        (error as NodeJS.ErrnoException).code,
      );
      return;
    }
    await writeRegistry(dir, "dist/nodes/Codex/Codex.node.js");

    await expect(parseGitHubPackage(dir)).rejects.toThrow(
      /n8n-nodes-base.*codex.*outside.*package root/i,
    );
  });

  it("rejects registry entries that are not compiled node JavaScript paths", async () => {
    const dir = await temporaryDirectory();
    await mkdir(join(dir, "nodes", "Invalid"), { recursive: true });
    await writeFile(
      join(dir, "nodes", "Invalid", "Invalid.node.ts"),
      `export class Invalid {
        description = { displayName: 'Invalid', name: 'invalid', group: ['transform'], version: 1 };
      }`,
    );
    await writeRegistry(dir, "nodes/Invalid/Invalid.node.ts");

    await expect(parseGitHubPackage(dir)).rejects.toThrow(
      /n8n-nodes-base.*registry.*nodes\/Invalid\/Invalid\.node\.ts/i,
    );
  });

  it("rejects non-string registry entries instead of filtering them", async () => {
    const dir = await temporaryDirectory();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "n8n-nodes-base", n8n: { nodes: [42] } }),
    );

    await expect(parseGitHubPackage(dir)).rejects.toThrow(
      /n8n-nodes-base.*registry.*entry 0.*string/i,
    );
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "n8n-node-parser-github-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeRegistry(directory: string, sourcePath: string): Promise<void> {
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "n8n-nodes-base", n8n: { nodes: [sourcePath] } }),
  );
}

function parseGitHubPackage(directory: string) {
  return parseGitHubSourceNodePackage({
    name: "n8n-nodes-base",
    version: "github",
    dir: directory,
    source: "official-github",
  });
}

function portablePath(file: string): string {
  return file.replaceAll("\\", "/");
}
