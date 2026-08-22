import { describe, expect, it } from "vitest";
import { enforceUrlPolicy } from "../../src/shared/url-policy";

describe("enforceUrlPolicy", () => {
  it("accepts valid https URLs and normalizes them via URL semantics", () => {
    expect(enforceUrlPolicy("https://example.com")).toEqual({
      ok: true,
      url: "https://example.com/",
    });
  });

  it("accepts valid http URLs", () => {
    expect(enforceUrlPolicy("http://example.com/page").ok).toBe(true);
  });

  it("accepts explicit default ports", () => {
    expect(enforceUrlPolicy("https://example.com:443").ok).toBe(true);
    expect(enforceUrlPolicy("http://example.com:80").ok).toBe(true);
  });

  it("trims surrounding whitespace without changing the destination", () => {
    const result = enforceUrlPolicy("  https://example.com/path  ");
    expect(result).toEqual({ ok: true, url: "https://example.com/path" });
  });

  it("rejects empty input", () => {
    expect(enforceUrlPolicy("").ok).toBe(false);
    expect(enforceUrlPolicy("   ").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(enforceUrlPolicy("not a url").ok).toBe(false);
    expect(enforceUrlPolicy("http://").ok).toBe(false);
  });

  it("rejects unsupported protocols", () => {
    for (const raw of [
      "ftp://example.com",
      "file:///etc/hosts",
      "javascript:alert(1)",
      "data:text/html,hello",
    ]) {
      const result = enforceUrlPolicy(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/http/i);
    }
  });

  it("rejects URLs with embedded credentials", () => {
    expect(enforceUrlPolicy("https://user:pass@example.com").ok).toBe(false);
    expect(enforceUrlPolicy("https://user@example.com").ok).toBe(false);
  });

  it("rejects non-standard ports and scheme/port mismatches", () => {
    expect(enforceUrlPolicy("https://example.com:8443").ok).toBe(false);
    expect(enforceUrlPolicy("http://example.com:3128").ok).toBe(false);
    expect(enforceUrlPolicy("https://example.com:80").ok).toBe(false);
    expect(enforceUrlPolicy("http://example.com:443").ok).toBe(false);
  });

  it("rejects relative-ish input that only parses after scheme prepending", () => {
    expect(enforceUrlPolicy("example.com").ok).toBe(false);
  });
});
