import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reduced-motion guards are enforced at the source level:
 * - decorative entrance motion (.fade-rise) exists only inside a
 *   prefers-reduced-motion: no-preference block;
 * - smooth scrolling is explicitly disabled under prefers-reduced-motion;
 * - the loading spinner is gated behind Tailwind's motion-safe variant;
 * - static components (score ring) introduce no animation of their own.
 */
const CLIENT_ROOT = join(import.meta.dirname, "..", "src");

function readClientFile(relativePath: string): string {
  return readFileSync(join(CLIENT_ROOT, relativePath), "utf8");
}

describe("reduced-motion source guards", () => {
  it("defines .fade-rise only under prefers-reduced-motion: no-preference", () => {
    const css = readClientFile("index.css");

    const guardedIndex = css.indexOf("prefers-reduced-motion: no-preference");
    const fadeRiseIndex = css.indexOf(".fade-rise");
    expect(guardedIndex).toBeGreaterThan(-1);
    expect(fadeRiseIndex).toBeGreaterThan(-1);
    // Every .fade-rise occurrence sits after the guard, inside its block.
    expect(css.lastIndexOf("prefers-reduced-motion", fadeRiseIndex)).toBe(
      guardedIndex,
    );
  });

  it("disables smooth scrolling when reduced motion is preferred", () => {
    const css = readClientFile("index.css");

    const reduceIndex = css.indexOf("prefers-reduced-motion: reduce");
    expect(reduceIndex).toBeGreaterThan(-1);
    const autoScroll = css.indexOf("scroll-behavior: auto", reduceIndex);
    expect(autoScroll).toBeGreaterThan(-1);
    const closingBrace = css.indexOf("}", reduceIndex);
    expect(autoScroll).toBeLessThan(closingBrace);
  });

  it("gates the loading spinner behind the motion-safe variant", () => {
    const tsx = readClientFile(
      join("features", "analysis", "components", "analysis-loading.tsx"),
    );

    expect(tsx).toContain("motion-safe:animate-spin");
  });

  it("keeps the score ring free of animation classes", () => {
    const tsx = readClientFile(
      join("features", "analysis", "components", "score-ring.tsx"),
    );

    expect(tsx).not.toMatch(/animate-/);
    expect(tsx).not.toMatch(/transition-/);
  });
});
