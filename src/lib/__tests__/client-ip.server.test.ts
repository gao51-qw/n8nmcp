import { describe, expect, it } from "vitest";
import { clientIp, normalizeIp } from "../client-ip.server";

function request(headers: Record<string, string>): Request {
  return new Request("https://mcp.example.test/mcp", { headers });
}

describe("clientIp", () => {
  it("takes the right-most X-Forwarded-For entry appended by the proxy", () => {
    expect(clientIp(request({ "x-forwarded-for": "198.51.100.9" }), {})).toBe("198.51.100.9");
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1 , 203.0.113.7" }), {})).toBe(
      "203.0.113.7",
    );
  });

  it("ignores spoofable headers by default", () => {
    const spoofed = request({
      "cf-connecting-ip": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "true-client-ip": "3.3.3.3",
      "x-forwarded-for": "4.4.4.4, 203.0.113.7",
    });
    expect(clientIp(spoofed, {})).toBe("203.0.113.7");
    expect(clientIp(request({ "cf-connecting-ip": "1.1.1.1" }), {})).toBeUndefined();
    expect(clientIp(request({ "x-real-ip": "2.2.2.2" }), {})).toBeUndefined();
  });

  it("honours cf-connecting-ip only when TRUST_CLOUDFLARE_HEADERS=true", () => {
    const req = request({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "172.70.0.5" });
    expect(clientIp(req, { TRUST_CLOUDFLARE_HEADERS: "false" })).toBe("172.70.0.5");
    expect(clientIp(req, { TRUST_CLOUDFLARE_HEADERS: "1" })).toBe("172.70.0.5");
    expect(clientIp(req, { TRUST_CLOUDFLARE_HEADERS: "true" })).toBe("1.1.1.1");
    expect(clientIp(req, { TRUST_CLOUDFLARE_HEADERS: " TRUE " })).toBe("1.1.1.1");
  });

  it("falls back to X-Forwarded-For when a trusted cf-connecting-ip is invalid", () => {
    const req = request({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "172.70.0.5" });
    expect(clientIp(req, { TRUST_CLOUDFLARE_HEADERS: "true" })).toBe("172.70.0.5");
  });

  it("returns undefined for missing, empty or garbage values", () => {
    expect(clientIp(request({}), {})).toBeUndefined();
    expect(clientIp(request({ "x-forwarded-for": " , " }), {})).toBeUndefined();
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4, <script>" }), {})).toBeUndefined();
  });

  it("supports IPv6 addresses", () => {
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4, 2001:DB8::1" }), {})).toBe(
      "2001:db8::1",
    );
  });
});

describe("normalizeIp", () => {
  it("accepts IPv4 and IPv6 literals and strips ports and brackets", () => {
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:192.0.2.1")).toBe("::ffff:192.0.2.1");
  });

  it("rejects non-addresses", () => {
    expect(normalizeIp("256.1.1.1")).toBeUndefined();
    expect(normalizeIp("unknown")).toBeUndefined();
    expect(normalizeIp("example.com")).toBeUndefined();
    expect(normalizeIp("")).toBeUndefined();
    expect(normalizeIp(null)).toBeUndefined();
    expect(normalizeIp("a".repeat(60))).toBeUndefined();
  });
});
