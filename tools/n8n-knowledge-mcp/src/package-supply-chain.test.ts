import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertTrustedTarballUrl, verifyPackageIntegrity } from "./package-supply-chain.js";

describe("package supply chain checks", () => {
  it("rejects tarballs outside trusted npm registry hosts", () => {
    expect(() =>
      assertTrustedTarballUrl("https://registry.npmjs.org/n8n-nodes-demo/-/demo.tgz"),
    ).not.toThrow();
    expect(() =>
      assertTrustedTarballUrl("https://registry.yarnpkg.com/n8n-nodes-demo/-/demo.tgz"),
    ).not.toThrow();

    expect(() => assertTrustedTarballUrl("https://example.com/n8n-nodes-demo.tgz")).toThrow(
      "Rejected tarball from untrusted host: example.com",
    );
  });

  it("requires a supported integrity hash before extracting community packages", () => {
    const tarball = Buffer.from("package bytes");

    expect(() => verifyPackageIntegrity("n8n-nodes-demo", tarball, undefined)).toThrow(
      "Missing integrity hash for n8n-nodes-demo",
    );
    expect(() => verifyPackageIntegrity("n8n-nodes-demo", tarball, "md5-abc")).toThrow(
      "Unsupported integrity algorithm for n8n-nodes-demo: md5",
    );
    expect(() => verifyPackageIntegrity("n8n-nodes-demo", tarball, "sha512-not-the-hash")).toThrow(
      "Integrity check failed for n8n-nodes-demo",
    );

    const expected = createHash("sha512").update(tarball).digest("base64");
    expect(() =>
      verifyPackageIntegrity("n8n-nodes-demo", tarball, `sha512-${expected}`),
    ).not.toThrow();
  });
});
