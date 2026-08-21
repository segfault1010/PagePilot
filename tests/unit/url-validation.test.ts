import { describe, expect, it } from "vitest";
import { normalizeAndValidateUrl } from "../../src/client/features/analysis/url-validation";

describe("normalizeAndValidateUrl", () => {
  it("accepts and normalizes https URLs", () => {
    const result = normalizeAndValidateUrl("https://example.com");
    expect(result).toEqual({ ok: true, url: "https://example.com/" });
  });

  it("prepends https:// when the scheme is missing", () => {
    const result = normalizeAndValidateUrl("example.com/page");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe("https://example.com/page");
  });

  it("accepts explicit http:// URLs", () => {
    expect(normalizeAndValidateUrl("http://example.com").ok).toBe(true);
  });

  it("rejects empty input", () => {
    expect(normalizeAndValidateUrl("").ok).toBe(false);
    expect(normalizeAndValidateUrl("   ").ok).toBe(false);
  });

  it("rejects unsupported protocols", () => {
    expect(normalizeAndValidateUrl("ftp://example.com").ok).toBe(false);
    expect(normalizeAndValidateUrl("javascript:alert(1)").ok).toBe(false);
    expect(normalizeAndValidateUrl("file:///etc/hosts").ok).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(normalizeAndValidateUrl("http://").ok).toBe(false);
    expect(normalizeAndValidateUrl("not a url").ok).toBe(false);
  });
});
