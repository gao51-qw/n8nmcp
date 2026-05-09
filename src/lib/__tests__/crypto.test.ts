import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  generatePlatformApiKey,
  hashPlatformApiKey,
  getMasterKey,
} from "../crypto.server";

beforeAll(() => {
  // 32 bytes base64 deterministic test key
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("crypto.server", () => {
  it("encrypts and decrypts roundtrip", () => {
    const plain = "n8n_api_super_secret_key_12345";
    const enc = encryptSecret(plain);
    expect(enc.ciphertext).toBeTruthy();
    expect(enc.iv).toBeTruthy();
    expect(enc.tag).toBeTruthy();
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const a = encryptSecret("hello");
    const b = encryptSecret("hello");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt when tag is tampered", () => {
    const enc = encryptSecret("payload");
    const bad = { ...enc, tag: Buffer.from("0".repeat(16)).toString("base64") };
    expect(() => decryptSecret(bad)).toThrow();
  });

  it("getMasterKey returns 32-byte buffer", () => {
    expect(getMasterKey().length).toBe(32);
  });

  it("generates platform API key with nmcp_ prefix and stable hash", () => {
    const k = generatePlatformApiKey();
    expect(k.full.startsWith("nmcp_")).toBe(true);
    expect(k.prefix.startsWith("nmcp_")).toBe(true);
    expect(k.prefix.length).toBe(12);
    expect(k.hash).toHaveLength(64);
    expect(hashPlatformApiKey(k.full)).toBe(k.hash);
  });

  it("generates unique keys", () => {
    const a = generatePlatformApiKey();
    const b = generatePlatformApiKey();
    expect(a.full).not.toBe(b.full);
    expect(a.hash).not.toBe(b.hash);
  });
});
