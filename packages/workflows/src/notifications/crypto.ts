import crypto from "node:crypto";
import { DEFAULT_WEBHOOK_TOLERANCE_SECONDS } from "@pagepilot/contracts";

/**
 * Generates HMAC-SHA256 signature for outbound webhooks.
 * Format: sha256=<hex_digest>
 * Payload signed: `${timestamp}.${body}`
 */
export function createWebhookSignature(
  secret: string,
  body: string,
  timestamp: number,
): string {
  const signaturePayload = `${timestamp}.${body}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(signaturePayload);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Verifies an incoming HMAC-SHA256 signature using timing-safe comparison
 * and anti-replay timestamp verification.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  timestamp: number,
  signature: string,
  toleranceSeconds: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
): boolean {
  // 1. Anti-replay timestamp tolerance check
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }

  // 2. Compute expected signature
  const expectedSig = createWebhookSignature(secret, body, timestamp);

  // 3. Timing-safe comparison
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
