import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseNodePackage, type NodePackageReference } from "./node-package-parser.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("parseNodePackage", () => {
  it("dispatches official GitHub packages to static source parsing", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "nodes", "HttpRequest"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "n8n-nodes-base",
        n8n: { nodes: ["dist/nodes/HttpRequest/HttpRequest.node.js"] },
      }),
    );
    await writeFile(
      join(root, "nodes", "HttpRequest", "HttpRequest.node.ts"),
      `throw new Error('must never execute');
       export class HttpRequest {
         description = { displayName: 'HTTP Request', name: 'httpRequest', group: ['output'], version: 1 };
       }`,
    );

    const result = await parseNodePackage({
      name: "n8n-nodes-base",
      version: "github:test",
      dir: root,
      source: "official-github",
    });

    expect(result.expectedNodeCount).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.nodes.map((node) => node.node_type)).toEqual(["httpRequest"]);
  });

  it("parses complete official metadata without executing node JavaScript", async () => {
    const root = await temporaryDirectory();
    await writeOfficialFixture(root);

    const result = await parseNodePackage(officialPackage(root));

    expect(result.expectedNodeCount).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      node_type: "httpRequest",
      package_name: "n8n-nodes-base",
      display_name: "HTTP Request",
      version: "1",
      source_path: "dist/nodes/HttpRequest/HttpRequest.node.js",
    });
  });

  it("selects the highest effective version for duplicate description rows", async () => {
    const root = await temporaryDirectory();
    await writeOfficialFixture(root, [
      officialDescription,
      {
        ...officialDescription,
        displayName: "HTTP Request v2",
        version: [1, 2],
      },
    ]);

    const result = await parseNodePackage(officialPackage(root));

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.version).toBe("2");
    expect(result.nodes[0]?.display_name).toBe("HTTP Request v2");
  });

  it("rejects an incomplete official description set", async () => {
    const root = await temporaryDirectory();
    await writeOfficialFixture(root);
    await writeFile(
      join(root, "dist", "known", "nodes.json"),
      JSON.stringify({
        httpRequest: {
          className: "HttpRequest",
          sourcePath: "dist/nodes/HttpRequest/HttpRequest.node.js",
        },
        webhook: {
          className: "Webhook",
          sourcePath: "dist/nodes/Webhook/Webhook.node.js",
        },
      }),
    );

    await expect(parseNodePackage(officialPackage(root))).rejects.toThrow(
      /n8n-nodes-base.*expected=2.*parsed=1.*missing=webhook/i,
    );
  });

  it("identifies the package and path when official metadata is missing", async () => {
    const root = await temporaryDirectory();
    await writeOfficialFixture(root);
    await rm(join(root, "dist", "known", "nodes.json"));

    const error = await captureFailure(parseNodePackage(officialPackage(root)));

    expect(error.message).toMatch(/n8n-nodes-base.*dist\/known\/nodes\.json/i);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("identifies the package and path when official metadata JSON is malformed", async () => {
    const root = await temporaryDirectory();
    await writeOfficialFixture(root);
    await writeFile(join(root, "dist", "types", "nodes.json"), "{ malformed json");

    const error = await captureFailure(parseNodePackage(officialPackage(root)));

    expect(error.message).toMatch(/n8n-nodes-base.*dist\/types\/nodes\.json/i);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("rejects an official source path outside the unpacked package root", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const outsideFile = join(outside, "Outside.node.js");
    await writeOfficialFixture(root);
    await writeFile(outsideFile, "outside package root\n");
    await writeKnownSourcePath(root, relative(root, outsideFile));

    await expect(parseNodePackage(officialPackage(root))).rejects.toThrow(
      /n8n-nodes-base.*source path.*outside.*package root/i,
    );
  });

  it("rejects an official source symlink that escapes the unpacked package root", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeOfficialFixture(root);
    await writeFile(join(outside, "Outside.node.js"), "outside package root\n");
    await symlink(
      outside,
      join(root, "linked-outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeKnownSourcePath(root, "linked-outside/Outside.node.js");

    await expect(parseNodePackage(officialPackage(root))).rejects.toThrow(
      /n8n-nodes-base.*source path.*outside.*package root/i,
    );
  });

  it("surfaces community dynamic-import failures", async () => {
    const root = await temporaryDirectory();
    await writeFile(
      join(root, "Broken.node.js"),
      'import "deliberately-absent-node-package";\nexport class Broken {}\n',
    );

    const result = await parseNodePackage(communityPackage(root));

    expect(result.nodes).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ sourcePath: "Broken.node.js" });
    expect(result.failures[0]?.message).toMatch(/cannot find package|ERR_MODULE_NOT_FOUND/i);
  });
});

const officialDescription = {
  displayName: "HTTP Request",
  name: "httpRequest",
  group: ["transform"],
  version: 1,
  description: "Makes an HTTP request",
  defaults: { name: "HTTP Request" },
  credentials: [{ name: "httpBasicAuth" }],
  inputs: ["main"],
  outputs: ["main"],
  properties: [
    {
      displayName: "URL",
      name: "url",
      type: "string",
      default: "",
      required: true,
    },
  ],
};

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "n8n-node-package-parser-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeOfficialFixture(
  root: string,
  descriptions: unknown[] = [officialDescription],
): Promise<void> {
  await mkdir(join(root, "dist", "known"), { recursive: true });
  await mkdir(join(root, "dist", "types"), { recursive: true });
  await mkdir(join(root, "dist", "nodes", "HttpRequest"), { recursive: true });
  await writeFile(
    join(root, "dist", "known", "nodes.json"),
    JSON.stringify({
      httpRequest: {
        className: "HttpRequest",
        sourcePath: "dist/nodes/HttpRequest/HttpRequest.node.js",
      },
    }),
  );
  await writeFile(join(root, "dist", "types", "nodes.json"), JSON.stringify(descriptions));
  await writeFile(
    join(root, "dist", "nodes", "HttpRequest", "HttpRequest.node.js"),
    'throw new Error("official node JavaScript must not execute");\n',
  );
}

async function writeKnownSourcePath(root: string, sourcePath: string): Promise<void> {
  await writeFile(
    join(root, "dist", "known", "nodes.json"),
    JSON.stringify({
      httpRequest: { className: "HttpRequest", sourcePath },
    }),
  );
}

function officialPackage(root: string): NodePackageReference {
  return {
    name: "n8n-nodes-base",
    version: "2.15.1",
    dir: root,
    source: "official",
  };
}

function communityPackage(root: string): NodePackageReference {
  return {
    name: "n8n-nodes-community-broken",
    version: "1.0.0",
    dir: root,
    source: "community",
  };
}

async function captureFailure(promise: Promise<unknown>): Promise<Error & { cause?: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Expected an Error rejection, received ${String(error)}`);
  }
  throw new Error("Expected parseNodePackage to reject");
}
