import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicUrl } from "@/lib/ssrf-guard.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertPublicUrl — IP literals", () => {
  it.each([
    "http://127.0.0.1:5678/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    // WHATWG URL parsing turns these into 127.0.0.1 before the guard sees them.
    "http://0x7f000001/",
    "http://2130706433/",
    "http://017700000001/",
    "http://127.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
  ])("blocks private IPv4 %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow(/private|internal|not allowed/i);
  });

  it.each([
    "http://[::1]:5678/",
    "http://[::]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    // IPv4-mapped loopback / metadata: URL parsing normalizes the dotted
    // form to hex (::ffff:7f00:1), so both spellings must be blocked.
    "http://[::ffff:127.0.0.1]:5678/",
    "http://[::ffff:7f00:1]:5678/",
    "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
    "http://[0:0:0:0:0:ffff:7f00:1]/",
    // IPv4-compatible (deprecated) and NAT64 well-known prefix.
    "http://[::127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[2002:7f00:1::]/",
    "http://[2001:0:4136:e378::1]/",
    "http://[ff02::1]/",
  ])("blocks private IPv6 %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow(/private|internal|not allowed/i);
  });

  it.each([
    "http://203.0.113.10:5678/",
    "https://8.8.8.8/",
    "http://[2606:4700:4700::1111]/",
    "http://[::ffff:808:808]/",
    "http://[2002:808:808::1]/",
  ])("allows public literal %s", async (url) => {
    await expect(assertPublicUrl(url)).resolves.toBeUndefined();
  });
});

describe("assertPublicUrl — hostnames", () => {
  it("blocks hostnames that resolve to IPv4-mapped loopback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const type = new URL(input).searchParams.get("type");
        const Answer =
          type === "AAAA" ? [{ name: "evil.example", type: 28, data: "::ffff:7f00:1" }] : [];
        return new Response(JSON.stringify({ Answer }), { status: 200 });
      }),
    );
    await expect(assertPublicUrl("https://evil.example/")).rejects.toThrow(/private|internal/i);
  });

  it("fails closed on DNS answers that are not valid IPv6", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const type = new URL(input).searchParams.get("type");
        const Answer =
          type === "AAAA" ? [{ name: "odd.example", type: 28, data: "1:2:3::4::5" }] : [];
        return new Response(JSON.stringify({ Answer }), { status: 200 });
      }),
    );
    await expect(assertPublicUrl("https://odd.example/")).rejects.toThrow(/private|internal/i);
  });

  it("blocks localhost and internal suffixes without resolving", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(assertPublicUrl("http://localhost:3000/")).rejects.toThrow(/not allowed/i);
    await expect(assertPublicUrl("http://n8n.internal/")).rejects.toThrow(/not allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
