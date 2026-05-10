// AES-256-GCM helpers for encrypting/decrypting third-party secrets (e.g. n8n API keys).
// Server-only: relies on Node crypto. Do NOT import from client code.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

/** Resolve the 32-byte master key. Prefers APP_ENCRYPTION_KEY (base64/hex/utf8>=32),
 *  falls back to SHA-256(SUPABASE_SERVICE_ROLE_KEY + salt) so the platform works
 *  out of the box. Rotating SERVICE_ROLE_KEY would invalidate ciphertext — set
 *  APP_ENCRYPTION_KEY in production to decouple. */
export function getMasterKey(): Buffer {
  const explicit = process.env.APP_ENCRYPTION_KEY;
  if (explicit) {
    // try base64
    try {
      const b = Buffer.from(explicit, "base64");
      if (b.length === 32) return b;
    } catch {}
    try {
      const h = Buffer.from(explicit, "hex");
      if (h.length === 32) return h;
    } catch {}
    const u = Buffer.from(explicit, "utf8");
    if (u.length >= 32) return u.subarray(0, 32);
    throw new Error("APP_ENCRYPTION_KEY must decode to >=32 bytes (base64/hex/utf8)");
  }
  const seed = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!seed) throw new Error("No encryption key material available");
  // In production, refuse to silently derive a key from SERVICE_ROLE_KEY —
  // rotating that secret would permanently corrupt all stored ciphertext.
  // Operators MUST set APP_ENCRYPTION_KEY (32 random bytes, base64 or hex).
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DERIVED_ENCRYPTION_KEY !== "1") {
    throw new Error(
      "APP_ENCRYPTION_KEY is required in production. Generate one with " +
        "`openssl rand -base64 32` and set it in .env.app. To explicitly opt in to " +
        "the derived fallback (NOT recommended), set ALLOW_DERIVED_ENCRYPTION_KEY=1.",
    );
  }
  console.warn(
    "[crypto] APP_ENCRYPTION_KEY not set — using key derived from SUPABASE_SERVICE_ROLE_KEY. " +
      "Rotating service-role would invalidate ciphertext.",
  );
  return createHash("sha256").update(`n8n-mcp-v1::${seed}`).digest();
}

export type EncryptedPayload = { ciphertext: string; iv: string; tag: string };

export function encryptSecret(plain: string, key: Buffer = getMasterKey()): EncryptedPayload {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptSecret(payload: EncryptedPayload, key: Buffer = getMasterKey()): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Generate a public-facing platform API key (returned plaintext to user once). */
export function generatePlatformApiKey(): { full: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const full = `nmcp_${raw}`;
  const prefix = full.slice(0, 12); // e.g. "nmcp_abcd123"
  const hash = createHash("sha256").update(full).digest("hex");
  return { full, prefix, hash };
}

export function hashPlatformApiKey(full: string): string {
  return createHash("sha256").update(full).digest("hex");
}
