import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPageSnapshot,
  TEXT_EXCERPT_LIMIT,
} from "../../src/server/extract/page-snapshot";

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "html");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

function snapshotOf(name: string) {
  return buildPageSnapshot(loadFixture(name), "https://fixture.example/");
}

describe("buildPageSnapshot", () => {
  it("extracts full metadata from a good landing page", () => {
    const snapshot = snapshotOf("good-landing.html");

    expect(snapshot.title).toBe("Acme Cloud — Ship faster with confident deploys");
    expect(snapshot.metaDescription).toContain("instant rollbacks");
    expect(snapshot.canonical).toBe("https://acme.example/");
    expect(snapshot.viewport).toBe("width=device-width, initial-scale=1");
    expect(snapshot.lang).toBe("en");
    expect(snapshot.openGraph["og:title"]).toBe("Acme Cloud");
    expect(Object.keys(snapshot.openGraph)).toEqual(
      expect.arrayContaining(["og:title", "og:description", "og:image", "og:type"]),
    );
  });

  it("returns null title when the title element is missing", () => {
    expect(snapshotOf("missing-title.html").title).toBeNull();
  });

  it("counts headings in order and flags hierarchy problems", () => {
    const good = snapshotOf("good-landing.html");
    expect(good.h1Count).toBe(1);
    expect(good.h2Count).toBe(2);
    expect(good.headingOutline[0]).toMatchObject({ level: 1 });
    expect(good.headingWarnings).toEqual([]);

    const broken = snapshotOf("bad-heading-order.html");
    expect(broken.headingWarnings).toContain("heading-level-skip");

    const multi = buildPageSnapshot(
      "<h1>One</h1><h1>Two</h1><p>x</p>",
      "https://x.example/",
    );
    expect(multi.headingWarnings).toContain("multiple-h1");
  });

  it("caps the visible text excerpt at the limit while reporting true length", () => {
    const longParagraph = `<p>${"word ".repeat(4000)}</p>`;
    const snapshot = buildPageSnapshot(longParagraph, "https://x.example/");

    expect(snapshot.textExcerpt.length).toBe(TEXT_EXCERPT_LIMIT);
    expect(snapshot.textLength).toBeGreaterThan(TEXT_EXCERPT_LIMIT);
  });

  it("excludes script/style content from visible text", () => {
    const snapshot = buildPageSnapshot(
      "<style>.x{color:red}</style><script>var hidden='secret';</script><body><p>visible words</p></body>",
      "https://x.example/",
    );
    expect(snapshot.textExcerpt).toBe("visible words");
    expect(snapshot.textExcerpt).not.toContain("secret");
  });

  it("samples links, buttons, forms, navigation, and counts", () => {
    const snapshot = snapshotOf("good-landing.html");

    expect(snapshot.anchorCount).toBeGreaterThanOrEqual(5);
    expect(snapshot.linkSamples.some((link) => link.text === "Pricing")).toBe(true);
    expect(snapshot.buttonTexts).toContain("Get started free");
    expect(snapshot.formCount).toBe(1);
    expect(snapshot.formSamples[0]).toEqual({ fieldCount: 1, labeledFieldCount: 1 });
    expect(snapshot.navigationRegionCount).toBe(1);
    expect(snapshot.navigationSamples).toContain("Product");
    expect(snapshot.paragraphCount).toBe(2);
    expect(snapshot.imageCount).toBe(2);
    expect(snapshot.imagesWithAltCount).toBe(2);
  });

  it("detects CTA candidates conservatively as evidence", () => {
    const snapshot = snapshotOf("good-landing.html");
    const kinds = snapshot.ctaCandidates.map((candidate) => candidate.kind);

    expect(kinds).toContain("button");
    expect(kinds).toContain("link");
    expect(snapshot.ctaCandidates.some((c) => c.text === "Request a demo")).toBe(true);
    expect(
      snapshot.ctaCandidates.every((c) => !/visual|prominent/i.test(c.text)),
    ).toBe(true);
  });

  it("reports image alt coverage gaps", () => {
    const snapshot = snapshotOf("missing-alt.html");
    expect(snapshot.imageCount).toBe(3);
    // Coverage is attribute-presence based: alt="" is a deliberate
    // decorative marker and counts; the other two images lack alt entirely.
    expect(snapshot.imagesWithAltCount).toBe(1);
  });

  it("detects missing form labels without placeholder-based guessing", () => {
    const snapshot = snapshotOf("missing-labels.html");
    expect(snapshot.formSamples[0]).toEqual({ fieldCount: 4, labeledFieldCount: 0 });
  });

  it("captures trust/contact/legal link candidates", () => {
    const snapshot = snapshotOf("trust-signals.html");
    const texts = snapshot.linkSamples.map((sample) => sample.text);
    expect(texts).toEqual(expect.arrayContaining(["Privacy", "Terms", "Contact sales"]));
  });

  it("stays deterministic for identical input", () => {
    const html = loadFixture("good-landing.html");
    expect(JSON.stringify(buildPageSnapshot(html, "https://x.example/"))).toBe(
      JSON.stringify(buildPageSnapshot(html, "https://x.example/")),
    );
  });

  it("bounds hostile attribute values (giant href)", () => {
    const giantHref = `https://evil.example/${"a".repeat(500_000)}`;
    const snapshot = buildPageSnapshot(
      `<a href="${giantHref}">x</a><link rel="canonical" href="${giantHref}">`,
      "https://x.example/",
    );
    expect(snapshot.linkSamples[0]!.href!.length).toBeLessThanOrEqual(300);
    expect(snapshot.canonical!.length).toBeLessThanOrEqual(500);
  });

  it("excludes template and noscript content from samples and counts", () => {
    const snapshot = buildPageSnapshot(
      `<template><a href="/t">template link</a></template>` +
        `<noscript><a href="/n">noscript link</a></noscript>` +
        `<p>real content</p>`,
      "https://x.example/",
    );
    expect(snapshot.anchorCount).toBe(0);
    expect(snapshot.linkSamples).toEqual([]);
    expect(snapshot.textExcerpt).not.toContain("template link");
  });

  it("tolerates malformed HTML without throwing", () => {
    const snapshot = snapshotOf("malformed.html");
    expect(snapshot.finalUrl).toBe("https://fixture.example/");
    expect(typeof snapshot.textExcerpt).toBe("string");
  });
});
