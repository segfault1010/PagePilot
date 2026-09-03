import crypto from "node:crypto";

/**
 * Derives or validates the 32-byte encryption key used for AES-256-GCM.
 * In production, INTEGRATION_ENCRYPTION_KEY must be provided via environment variables.
 * In development/test environments, falls back to a deterministic development key.
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (envKey && envKey.trim().length > 0) {
    const trimmed = envKey.trim();
    // 64-character hex string (32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, "hex");
    }
    // 44-character base64 string (32 bytes)
    if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
      return Buffer.from(trimmed, "base64");
    }
    // Otherwise hash whatever string was provided to exactly 32 bytes
    return crypto.createHash("sha256").update(trimmed).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be set in production environments.",
    );
  }

  // Deterministic development fallback key
  return crypto
    .createHash("sha256")
    .update("pagepilot-default-dev-integration-secret-key-32b")
    .digest();
}

/**
 * Encrypts integration credentials (targetUrl, signingSecret, etc.) using AES-256-GCM.
 * Produces envelope format: v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptCredentials(
  data: Record<string, string>,
  customKey?: Buffer,
): { encrypted: string; keyId: string } {
  const key = customKey ?? getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const json = JSON.stringify(data);
  const ciphertext = Buffer.concat([
    cipher.update(json, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 16-byte authentication tag

  const envelope = `v1:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
  return { encrypted: envelope, keyId: "v1" };
}

/**
 * Decrypts an AES-256-GCM encrypted envelope.
 * Verifies authenticity tag; throws an error if tampered or invalid.
 */
export function decryptCredentials(
  envelope: string,
  customKey?: Buffer,
): Record<string, string> {
  const key = customKey ?? getEncryptionKey();
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid integration credentials encryption envelope.");
  }

  const ivHex = parts[1]!;
  const tagHex = parts[2]!;
  const cipherHex = parts[3]!;

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
}

/**
 * Masks target webhook URL for safe projection to clients.
 * Never reveals secret tokens or sensitive query params.
 */
export function maskCredentialUrl(
  rawUrl: string,
  provider: "slack" | "webhook",
): string {
  try {
    const parsed = new URL(rawUrl);
    if (provider === "slack") {
      // Standard Slack incoming webhook: https://hooks.slack.com/services/T.../B.../X...
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length >= 3 && segments[0] === "services") {
        const team = segments[1]?.slice(0, 3) || "T**";
        return `https://hooks.slack.com/services/${team}***/*****/********`;
      }
      return `${parsed.origin}/***masked***`;
    }

    // Generic webhook: preserve origin and first path segment, mask remainder
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const prefix = pathParts.length > 0 ? `/${pathParts[0]}` : "";
    return `${parsed.origin}${prefix}/***`;
  } catch {
    return "https://***masked***";
  }
}

/**
 * Generates HMAC-SHA256 signature for generic outbound webhooks.
 * Format: sha256=<hex_digest>
 */
export function createWebhookSignature(
  secret: string,
  payload: string,
  timestamp: number,
): string {
  const signaturePayload = `${timestamp}.${payload}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(signaturePayload);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verifies an incoming or outbound HMAC-SHA256 signature using constant-time comparison
 * and anti-replay timestamp verification.
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  timestamp: number,
  signature: string,
  toleranceSeconds = 300,
): boolean {
  // 1. Anti-replay timestamp check
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  // 2. Compute expected signature
  const expectedSig = createWebhookSignature(secret, payload, timestamp);

  // 3. Timing-safe comparison
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
