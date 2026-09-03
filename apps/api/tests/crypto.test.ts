import { describe, expect, it } from "vitest";
import {
  createWebhookSignature,
  decryptCredentials,
  encryptCredentials,
  maskCredentialUrl,
  verifyWebhookSignature,
} from "../src/integrations/crypto.js";

describe("Integrations Crypto & Webhook Signatures", () => {
  describe("encryptCredentials & decryptCredentials (AES-256-GCM)", () => {
    it("round-trips sensitive credentials correctly", () => {
      const credentials = {
        targetUrl: "https://hooks.slack.com/services/T001/B002/SECRETTOKEN123",
        signingSecret: "super_secret_signing_key_999",
      };

      const { encrypted, keyId } = encryptCredentials(credentials);
      expect(keyId).toBe("v1");
      expect(encrypted.startsWith("v1:")).toBe(true);

      const decrypted = decryptCredentials(encrypted);
      expect(decrypted).toEqual(credentials);
    });

    it("generates unique IVs and distinct ciphertexts for identical inputs", () => {
      const creds = { targetUrl: "https://example.com/wh" };
      const enc1 = encryptCredentials(creds);
      const enc2 = encryptCredentials(creds);

      expect(enc1.encrypted).not.toBe(enc2.encrypted);
      expect(decryptCredentials(enc1.encrypted)).toEqual(creds);
      expect(decryptCredentials(enc2.encrypted)).toEqual(creds);
    });

    it("rejects tampered ciphertexts with authentication error", () => {
      const creds = { targetUrl: "https://example.com/wh" };
      const { encrypted } = encryptCredentials(creds);

      const parts = encrypted.split(":");
      // Alter one character of the ciphertext
      const tamperedCipher =
        parts[3]!.slice(0, -2) + (parts[3]!.endsWith("a") ? "b" : "a");
      const tamperedEnvelope = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCipher}`;

      expect(() => decryptCredentials(tamperedEnvelope)).toThrow();
    });

    it("rejects invalid envelope formats", () => {
      expect(() => decryptCredentials("not-a-valid-envelope")).toThrow(
        "Invalid integration credentials encryption envelope",
      );
      expect(() => decryptCredentials("v2:iv:tag:cipher")).toThrow(
        "Invalid integration credentials encryption envelope",
      );
    });
  });

  describe("maskCredentialUrl", () => {
    it("masks Slack webhook URLs properly", () => {
      const url =
        "https://hooks.slack.com/services/T01-example/B01-example/example-token";
      const masked = maskCredentialUrl(url, "slack");
      expect(masked).toBe(
        "https://hooks.slack.com/services/T01***/*****/********",
      );
      expect(masked).not.toContain("example-token");
    });

    it("masks generic webhook URLs properly", () => {
      const url = "https://api.company.com/webhooks/listener?token=secret123";
      const masked = maskCredentialUrl(url, "webhook");
      expect(masked).toBe("https://api.company.com/webhooks/***");
      expect(masked).not.toContain("secret123");
    });
  });

  describe("createWebhookSignature & verifyWebhookSignature (HMAC-SHA256)", () => {
    const secret = "whsec_test_secret_key_12345";
    const payload = JSON.stringify({ event: "alert.created", score: 45 });

    it("generates and verifies valid HMAC signature within tolerance window", () => {
      const now = Math.floor(Date.now() / 1000);
      const signature = createWebhookSignature(secret, payload, now);

      expect(signature.startsWith("sha256=")).toBe(true);
      const isValid = verifyWebhookSignature(secret, payload, now, signature);
      expect(isValid).toBe(true);
    });

    it("rejects signatures with incorrect secret", () => {
      const now = Math.floor(Date.now() / 1000);
      const signature = createWebhookSignature(secret, payload, now);

      const isValid = verifyWebhookSignature(
        "wrong_secret",
        payload,
        now,
        signature,
      );
      expect(isValid).toBe(false);
    });

    it("rejects signatures when payload is altered", () => {
      const now = Math.floor(Date.now() / 1000);
      const signature = createWebhookSignature(secret, payload, now);

      const isValid = verifyWebhookSignature(
        secret,
        payload + "tampered",
        now,
        signature,
      );
      expect(isValid).toBe(false);
    });

    it("rejects replayed signatures outside tolerance window", () => {
      // 10 minutes ago
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signature = createWebhookSignature(
        secret,
        payload,
        expiredTimestamp,
      );

      // Default tolerance is 300s (5m)
      const isValid = verifyWebhookSignature(
        secret,
        payload,
        expiredTimestamp,
        signature,
      );
      expect(isValid).toBe(false);
    });
  });
});
