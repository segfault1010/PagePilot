import { describe, expect, it } from "vitest";
import {
  VisualDiffEngine,
  MockVisualDiffEngine,
  buildVisualDiffSummary,
  classifyVisualChangeSeverity,
  computeHexHammingDistance,
  getZoneForRow,
  computeHashesFromLuminanceGrid,
  generateSyntheticBlockHashes,
} from "../src/visual-diff/index.js";

describe("Visual Diff Engine", () => {
  const engine = new VisualDiffEngine();

  it("computes Hamming distance correctly between hex strings", () => {
    // Exactly identical
    const dist1 = computeHexHammingDistance("ffff", "ffff");
    expect(dist1.bitDistance).toBe(0);
    expect(dist1.distancePercent).toBe(0);

    // Completely inverted (16 bits differing out of 16)
    const dist2 = computeHexHammingDistance("0000", "ffff");
    expect(dist2.bitDistance).toBe(16);
    expect(dist2.distancePercent).toBe(100);

    // 1 hex char differing: 0 (0000) vs 1 (0001) = 1 bit out of 16 bits = 6.25%
    const dist3 = computeHexHammingDistance("0000", "0001");
    expect(dist3.bitDistance).toBe(1);
    expect(dist3.distancePercent).toBe(6.25);
  });

  it("maps rows to correct visual zones", () => {
    expect(getZoneForRow(0)).toBe("hero");
    expect(getZoneForRow(1)).toBe("hero");
    expect(getZoneForRow(2)).toBe("hero");
    expect(getZoneForRow(3)).toBe("body");
    expect(getZoneForRow(4)).toBe("body");
    expect(getZoneForRow(5)).toBe("body");
    expect(getZoneForRow(6)).toBe("footer");
    expect(getZoneForRow(7)).toBe("footer");
  });

  it("classifies visual change severity according to thresholds", () => {
    expect(classifyVisualChangeSeverity(0)).toBe("negligible");
    expect(classifyVisualChangeSeverity(4.99)).toBe("negligible");
    expect(classifyVisualChangeSeverity(5.0)).toBe("minor");
    expect(classifyVisualChangeSeverity(14.99)).toBe("minor");
    expect(classifyVisualChangeSeverity(15.0)).toBe("moderate");
    expect(classifyVisualChangeSeverity(29.99)).toBe("moderate");
    expect(classifyVisualChangeSeverity(30.0)).toBe("significant");
    expect(classifyVisualChangeSeverity(59.99)).toBe("significant");
    expect(classifyVisualChangeSeverity(60.0)).toBe("major");
    expect(classifyVisualChangeSeverity(100.0)).toBe("major");
  });

  it("handles missing baseline as an explicit baseline result", () => {
    const { perceptualHash, blockHashes } = generateSyntheticBlockHashes({
      seed: "baseline-run",
    });

    const result = engine.compare({
      current: {
        auditRunId: "run-current-1",
        screenshotId: "ss-1",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash,
        blockHashes,
      },
      baseline: null,
    });

    expect(result.status).toBe("baseline");
    expect(result.isBaseline).toBe(true);
    expect(result.baselineAuditRunId).toBeNull();
    expect(result.isMeaningfulChange).toBe(false);
    expect(result.visualChangeScore).toBe(0);
    expect(result.changeSeverity).toBe("negligible");
    expect(result.changeReasons[0]).toContain("Baseline established");
    expect(result.blockDiffs).toHaveLength(32);
  });

  it("rejects mismatched viewports and capture types", () => {
    const hashes = generateSyntheticBlockHashes();

    expect(() =>
      engine.compare({
        current: {
          auditRunId: "run-1",
          deviceType: "desktop",
          captureType: "viewport",
          width: 1280,
          height: 800,
          ...hashes,
        },
        baseline: {
          auditRunId: "run-0",
          deviceType: "mobile",
          captureType: "viewport",
          width: 375,
          height: 812,
          ...hashes,
        },
      })
    ).toThrow("Cannot compare mismatched viewports");

    expect(() =>
      engine.compare({
        current: {
          auditRunId: "run-1",
          deviceType: "desktop",
          captureType: "viewport",
          width: 1280,
          height: 800,
          ...hashes,
        },
        baseline: {
          auditRunId: "run-0",
          deviceType: "desktop",
          captureType: "full_page",
          width: 1280,
          height: 2400,
          ...hashes,
        },
      })
    ).toThrow("Cannot compare mismatched capture types");
  });

  it("returns zero difference for identical block hashes", () => {
    const hashes = generateSyntheticBlockHashes({ seed: "identical-seed" });

    const result = engine.compare({
      current: {
        auditRunId: "run-current",
        screenshotId: "ss-curr",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: hashes.perceptualHash,
        blockHashes: hashes.blockHashes,
      },
      baseline: {
        auditRunId: "run-base",
        screenshotId: "ss-base",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: hashes.perceptualHash,
        blockHashes: hashes.blockHashes,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.isBaseline).toBe(false);
    expect(result.isMeaningfulChange).toBe(false);
    expect(result.visualChangeScore).toBe(0);
    expect(result.changeSeverity).toBe("negligible");
    expect(result.changedBlocksCount).toBe(0);
    expect(result.heroZoneChange).toBe(0);
    expect(result.bodyZoneChange).toBe(0);
    expect(result.footerZoneChange).toBe(0);
  });

  it("filters out benign rendering noise where Hamming distance <= 12%", () => {
    // Generate base hashes
    const base = generateSyntheticBlockHashes({ seed: "noise-test" });

    // Mutate only 1 bit in each block (1 bit / 64 bits = 1.56% difference, well below 12% noise threshold)
    const noisyBlockHashes = base.blockHashes.map((h) => {
      const firstNibble = (parseInt(h[0]!, 16) ^ 1).toString(16);
      return firstNibble + h.slice(1);
    });

    const result = engine.compare({
      current: {
        auditRunId: "run-curr",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: base.perceptualHash,
        blockHashes: noisyBlockHashes,
      },
      baseline: {
        auditRunId: "run-base",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: base.perceptualHash,
        blockHashes: base.blockHashes,
      },
    });

    // Sub-threshold noise should be suppressed to 0 changed blocks and 0 visual change score
    expect(result.visualChangeScore).toBe(0);
    expect(result.changedBlocksCount).toBe(0);
    expect(result.isMeaningfulChange).toBe(false);
    expect(result.changeSeverity).toBe("negligible");
  });

  it("detects above-the-fold hero section modification", () => {
    const base = generateSyntheticBlockHashes({ seed: "hero-test" });
    // Invert all hero blocks (rows 0, 1, 2)
    const currentBlocks = [...base.blockHashes];
    for (let i = 0; i < 12; i++) {
      currentBlocks[i] = "ffffffffffffffff"; // 100% distance from base
    }

    const result = engine.compare({
      current: {
        auditRunId: "run-curr",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: base.perceptualHash,
        blockHashes: currentBlocks,
      },
      baseline: {
        auditRunId: "run-base",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: base.perceptualHash,
        blockHashes: base.blockHashes,
      },
    });

    expect(result.heroZoneChange).toBeGreaterThanOrEqual(20);
    expect(result.isMeaningfulChange).toBe(true);
    expect(
      result.changeReasons.some((r) => r.includes("hero section"))
    ).toBe(true);
  });

  it("detects meaningful change when 8 or more blocks shift", () => {
    const base = generateSyntheticBlockHashes({ seed: "eight-blocks" });
    const currentBlocks = [...base.blockHashes];
    // Invert exactly 8 scattered blocks
    for (let i = 0; i < 8; i++) {
      currentBlocks[i * 4] = "ffffffffffffffff";
    }

    const result = engine.compare({
      current: {
        auditRunId: "run-curr",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: base.perceptualHash,
        blockHashes: currentBlocks,
      },
      baseline: {
        auditRunId: "run-base",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        perceptualHash: base.perceptualHash,
        blockHashes: base.blockHashes,
      },
    });

    expect(result.changedBlocksCount).toBe(8);
    expect(result.isMeaningfulChange).toBe(true);
  });

  it("detects meaningful change when page height shift >= 300px", () => {
    const hashes = generateSyntheticBlockHashes({ seed: "height-test" });

    const result = engine.compare({
      current: {
        auditRunId: "run-curr",
        deviceType: "desktop",
        captureType: "full_page",
        width: 1280,
        height: 2500,
        ...hashes,
      },
      baseline: {
        auditRunId: "run-base",
        deviceType: "desktop",
        captureType: "full_page",
        width: 1280,
        height: 2150, // delta = +350px
        ...hashes,
      },
    });

    expect(result.heightDeltaPx).toBe(350);
    expect(result.isMeaningfulChange).toBe(true);
    expect(
      result.changeReasons.some((r) => r.includes("height changed by +350px"))
    ).toBe(true);
  });

  it("handles missing hashes with skipped status", () => {
    const result = engine.compare({
      current: {
        auditRunId: "run-curr",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        blockHashes: [],
      },
      baseline: {
        auditRunId: "run-base",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        blockHashes: [],
      },
    });

    expect(result.status).toBe("skipped");
    expect(result.isMeaningfulChange).toBe(false);
  });

  it("builds composite VisualDiffSummary correctly", () => {
    const hashes = generateSyntheticBlockHashes();
    const diffDesktop = engine.compare({
      current: {
        auditRunId: "run-1",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        ...hashes,
      },
      baseline: {
        auditRunId: "run-0",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        ...hashes,
      },
    });

    const diffMobile = engine.compare({
      current: {
        auditRunId: "run-1",
        deviceType: "mobile",
        captureType: "viewport",
        width: 375,
        height: 812,
        ...hashes,
      },
      baseline: null,
    });

    const summary = buildVisualDiffSummary([diffDesktop, diffMobile]);
    expect(summary.hasVisualDiff).toBe(true);
    expect(summary.isBaseline).toBe(false);
    expect(summary.desktopChangeScore).toBe(0);
    expect(summary.mobileChangeScore).toBeNull();
  });

  it("allows MockVisualDiffEngine custom overrides for tests", () => {
    const hashes = generateSyntheticBlockHashes();
    const mockEngine = new MockVisualDiffEngine({
      customScore: 42.5,
      customHeroScore: 50.0,
    });

    const result = mockEngine.compare({
      current: {
        auditRunId: "run-1",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        ...hashes,
      },
      baseline: {
        auditRunId: "run-0",
        deviceType: "desktop",
        captureType: "viewport",
        width: 1280,
        height: 800,
        ...hashes,
      },
    });

    expect(result.visualChangeScore).toBe(42.5);
    expect(result.heroZoneChange).toBe(50.0);
    expect(result.changeSeverity).toBe("significant");
    expect(result.isMeaningfulChange).toBe(true);
  });

  it("computes hashes from luminance grid correctly", () => {
    // 32x32 luminance grid
    const grid: number[][] = [];
    for (let y = 0; y < 32; y++) {
      const row: number[] = [];
      for (let x = 0; x < 32; x++) {
        row.push((x * 8 + y * 8) % 256);
      }
      grid.push(row);
    }

    const { perceptualHash, blockHashes } = computeHashesFromLuminanceGrid(
      grid,
      32,
      32
    );
    expect(perceptualHash).toHaveLength(64);
    expect(blockHashes).toHaveLength(32);
    for (const bh of blockHashes) {
      expect(bh).toHaveLength(16);
    }
  });
});
