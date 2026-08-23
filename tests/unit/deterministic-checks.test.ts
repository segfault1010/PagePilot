import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  runDeterministicChecks,
  SIGNAL_IDS,
} from "../../src/server/extract/deterministic-checks";
import { buildPageSnapshot } from "../../src/server/extract/page-snapshot";

const FIXTURE_DIR = join(import.meta.dirname, "..", "fixtures", "html");

function checksFor(name: string) {
  const html = readFileSync(join(FIXTURE_DIR, name), "utf8");
  return runDeterministicChecks(buildPageSnapshot(html, "https://fixture.example/"));
}

function byId(signals: ReturnType<typeof runDeterministicChecks>, id: string) {
  return signals.find((signal) => signal.id === id);
}

describe("runDeterministicChecks", () => {
  it("emits stable signal IDs", () => {
    const signals = checksFor("good-landing.html");
    const ids = new Set(signals.map((signal) => signal.id));

    for (const expected of Object.values(SIGNAL_IDS)) {
      if (expected === SIGNAL_IDS.duplicateHeadings) continue; // conditional signal
      expect(ids.has(expected), `missing stable id: ${expected}`).toBe(true);
    }
    expect(ids.has(SIGNAL_IDS.duplicateHeadings)).toBe(false);
  });

  it("marks a good landing page as passing on core signals", () => {
    const signals = checksFor("good-landing.html");

    expect(byId(signals, SIGNAL_IDS.titlePresent)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.metaDescriptionPresent)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.singleMeaningfulH1)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.headingOrder)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.imageAltCoverage)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.documentLang)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.viewportPresent)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.formLabels)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.canonicalPresent)?.status).toBe("pass");
    expect(byId(signals, SIGNAL_IDS.trustLinks)?.status).toBe("pass");
  });

  it("warns on missing title / H1 / alt text / viewport / labels", () => {
    expect(byId(checksFor("missing-title.html"), SIGNAL_IDS.titlePresent)?.status).toBe("warn");
    expect(byId(checksFor("missing-h1.html"), SIGNAL_IDS.singleMeaningfulH1)?.status).toBe("warn");
    expect(byId(checksFor("missing-alt.html"), SIGNAL_IDS.imageAltCoverage)?.status).toBe("warn");
    expect(
      byId(checksFor("missing-viewport.html"), SIGNAL_IDS.viewportPresent)?.status,
    ).toBe("warn");
    expect(byId(checksFor("missing-labels.html"), SIGNAL_IDS.formLabels)?.status).toBe("warn");
  });

  it("uses unknown (never penalized) when HTML cannot establish the answer", () => {
    // No images at all → alt coverage is not applicable.
    expect(
      byId(checksFor("sparse.html"), SIGNAL_IDS.imageAltCoverage)?.status,
    ).toBe("unknown");

    // No links to assess link-text quality.
    expect(
      byId(checksFor("sparse.html"), SIGNAL_IDS.linkTextQuality)?.status,
    ).toBe("unknown");

    // No forms → label coverage not applicable.
    expect(byId(checksFor("sparse.html"), SIGNAL_IDS.formLabels)?.status).toBe("unknown");
  });

  it("flags weak link text and thin content", () => {
    expect(
      byId(checksFor("weak-link-text.html"), SIGNAL_IDS.linkTextQuality)?.status,
    ).toBe("warn");
    expect(byId(checksFor("weak-link-text.html"), SIGNAL_IDS.contentSufficiency)?.status).toBe(
      "warn",
    );
    expect(byId(checksFor("bad-heading-order.html"), SIGNAL_IDS.headingOrder)?.status).toBe(
      "warn",
    );
  });

  it("keeps every weight bounded between 0 and 1", () => {
    for (const name of [
      "good-landing.html",
      "sparse.html",
      "weak-link-text.html",
      "trust-signals.html",
    ]) {
      for (const signal of checksFor(name)) {
        expect(signal.weight).toBeGreaterThanOrEqual(0);
        expect(signal.weight).toBeLessThanOrEqual(1);
        expect(signal.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("produces byte-identical output for identical snapshots", () => {
    const first = JSON.stringify(checksFor("good-landing.html"));
    const second = JSON.stringify(checksFor("good-landing.html"));
    expect(first).toBe(second);
  });

  it("carries categories that match the seven audit categories", () => {
    const allowed = new Set([
      "clarity",
      "visualHierarchy",
      "ctaEffectiveness",
      "copy",
      "accessibility",
      "mobileUx",
      "trustCredibility",
    ]);
    for (const signal of checksFor("trust-signals.html")) {
      expect(allowed.has(signal.category)).toBe(true);
    }
  });
});
