import {
  BLOCK_NOISE_THRESHOLD,
  BODY_ZONE_ROWS,
  GRID_COLUMNS,
  HERO_CHANGE_THRESHOLD,
  HERO_ZONE_ROWS,
  INSIGNIFICANT_CHANGE_THRESHOLD,
  MEANINGFUL_CHANGED_BLOCKS_THRESHOLD,
  MEANINGFUL_HEIGHT_DELTA_PX,
  MINOR_CHANGE_THRESHOLD,
  MODERATE_CHANGE_THRESHOLD,
  SIGNIFICANT_CHANGE_THRESHOLD,
  TOTAL_GRID_BLOCKS,
  VISUAL_DIFF_ALGORITHM,
  VISUAL_REGRESSION_SCHEMA_VERSION,
  type ScreenshotCaptureType,
  type ScreenshotDeviceType,
  type VisualBlockDiff,
  type VisualChangeSeverity,
  type VisualDiffResult,
  type VisualDiffSummary,
  type VisualDiffZoneName,
} from "@pagepilot/contracts";

/**
 * Input screenshot metadata and perceptual hashes for comparison
 */
export interface VisualDiffScreenshotInput {
  auditRunId: string;
  screenshotId?: string | null;
  deviceType: ScreenshotDeviceType;
  captureType: ScreenshotCaptureType;
  width: number;
  height: number;
  perceptualHash?: string | null;
  blockHashes?: string[] | null;
  signedUrl?: string;
}

export interface ComputeVisualDiffOptions {
  current: VisualDiffScreenshotInput;
  baseline?: VisualDiffScreenshotInput | null;
  organizationId?: string;
  projectId?: string;
  monitoredPageId?: string;
}

/**
 * Computes Hamming distance between two hex-encoded hashes of equal length.
 * Returns the count of differing bits and the percentage difference [0, 100].
 */
export function computeHexHammingDistance(
  hexA: string,
  hexB: string
): { bitDistance: number; totalBits: number; distancePercent: number } {
  if (!hexA || !hexB) {
    return { bitDistance: 64, totalBits: 64, distancePercent: 100 };
  }

  const minLen = Math.min(hexA.length, hexB.length);
  const maxLen = Math.max(hexA.length, hexB.length);
  let differingBits = (maxLen - minLen) * 4;
  const totalBits = maxLen * 4;

  for (let i = 0; i < minLen; i++) {
    const valA = parseInt(hexA[i]!, 16);
    const valB = parseInt(hexB[i]!, 16);
    if (isNaN(valA) || isNaN(valB)) {
      differingBits += 4;
      continue;
    }
    let xor = valA ^ valB;
    while (xor > 0) {
      differingBits += xor & 1;
      xor >>= 1;
    }
  }

  const distancePercent =
    totalBits > 0
      ? Math.min(100, Math.max(0, (differingBits / totalBits) * 100))
      : 0;

  return {
    bitDistance: differingBits,
    totalBits,
    distancePercent: Math.round(distancePercent * 100) / 100,
  };
}

/**
 * Determines which visual zone a given row belongs to in the 4x8 grid:
 * - Rows 0, 1, 2: hero (top 37.5%)
 * - Rows 3, 4, 5: body (middle 37.5%)
 * - Rows 6, 7: footer (bottom 25%)
 */
export function getZoneForRow(row: number): VisualDiffZoneName {
  if (HERO_ZONE_ROWS.includes(row as (typeof HERO_ZONE_ROWS)[number])) {
    return "hero";
  }
  if (BODY_ZONE_ROWS.includes(row as (typeof BODY_ZONE_ROWS)[number])) {
    return "body";
  }
  return "footer";
}

/**
 * Classifies overall visual change score into standardized severity tiers
 */
export function classifyVisualChangeSeverity(
  changeScore: number
): VisualChangeSeverity {
  if (changeScore < INSIGNIFICANT_CHANGE_THRESHOLD) {
    return "negligible";
  }
  if (changeScore < MINOR_CHANGE_THRESHOLD) {
    return "minor";
  }
  if (changeScore < MODERATE_CHANGE_THRESHOLD) {
    return "moderate";
  }
  if (changeScore < SIGNIFICANT_CHANGE_THRESHOLD) {
    return "significant";
  }
  return "major";
}

/**
 * Pure deterministic visual-diff engine comparing screenshots from consecutive runs
 */
export class VisualDiffEngine {
  /**
   * Compares two screenshots and returns an explainable VisualDiffResult
   */
  compare(options: ComputeVisualDiffOptions): VisualDiffResult {
    const { current, baseline, organizationId, projectId, monitoredPageId } =
      options;

    // 1. Handle Missing Baseline Screenshot Gracefully
    if (!baseline) {
      return {
        organizationId,
        projectId,
        monitoredPageId,
        currentAuditRunId: current.auditRunId,
        baselineAuditRunId: null,
        currentScreenshotId: current.screenshotId ?? null,
        baselineScreenshotId: null,
        deviceType: current.deviceType,
        captureType: current.captureType,
        schemaVersion: VISUAL_REGRESSION_SCHEMA_VERSION,
        diffAlgorithm: VISUAL_DIFF_ALGORITHM,
        status: "baseline",
        isBaseline: true,
        isMeaningfulChange: false,
        visualChangeScore: 0,
        changeSeverity: "negligible",
        heroZoneChange: 0,
        bodyZoneChange: 0,
        footerZoneChange: 0,
        changedBlocksCount: 0,
        totalBlocksCount: TOTAL_GRID_BLOCKS,
        heightDeltaPx: 0,
        changeReasons: [
          "Baseline established: initial screenshot recorded for monitored page.",
        ],
        blockDiffs: this.generateUniformBlockDiffs(0, false),
        currentSignedUrl: current.signedUrl,
        baselineSignedUrl: undefined,
      };
    }

    // 2. Validate Viewport and Capture-Type Equivalence
    if (current.deviceType !== baseline.deviceType) {
      throw new Error(
        `Cannot compare mismatched viewports: current is '${current.deviceType}', baseline is '${baseline.deviceType}'.`
      );
    }
    if (current.captureType !== baseline.captureType) {
      throw new Error(
        `Cannot compare mismatched capture types: current is '${current.captureType}', baseline is '${baseline.captureType}'.`
      );
    }

    // 3. Compute Layout Dimension Deltas
    const heightDeltaPx = current.height - baseline.height;

    // 4. Handle Missing Hashes (e.g. older legacy screenshots without hashes)
    const currentBlockHashes = current.blockHashes ?? [];
    const baselineBlockHashes = baseline.blockHashes ?? [];

    if (
      currentBlockHashes.length === 0 ||
      baselineBlockHashes.length === 0
    ) {
      // If hashes are absent for either, record skipped status
      return {
        organizationId,
        projectId,
        monitoredPageId,
        currentAuditRunId: current.auditRunId,
        baselineAuditRunId: baseline.auditRunId,
        currentScreenshotId: current.screenshotId ?? null,
        baselineScreenshotId: baseline.screenshotId ?? null,
        deviceType: current.deviceType,
        captureType: current.captureType,
        schemaVersion: VISUAL_REGRESSION_SCHEMA_VERSION,
        diffAlgorithm: VISUAL_DIFF_ALGORITHM,
        status: "skipped",
        isBaseline: false,
        isMeaningfulChange: false,
        visualChangeScore: 0,
        changeSeverity: "negligible",
        heroZoneChange: 0,
        bodyZoneChange: 0,
        footerZoneChange: 0,
        changedBlocksCount: 0,
        totalBlocksCount: TOTAL_GRID_BLOCKS,
        heightDeltaPx,
        changeReasons: [
          "Comparison skipped: perceptual hashes not available for one or both screenshots.",
        ],
        currentSignedUrl: current.signedUrl,
        baselineSignedUrl: baseline.signedUrl,
      };
    }

    // 5. Compare 32 Spatial Blocks (4 columns x 8 rows)
    const blockDiffs: VisualBlockDiff[] = [];
    let totalEffectiveDistance = 0;
    let changedBlocksCount = 0;

    let heroDistanceSum = 0;
    let heroBlockCount = 0;
    let heroChangedCount = 0;

    let bodyDistanceSum = 0;
    let bodyBlockCount = 0;
    let bodyChangedCount = 0;

    let footerDistanceSum = 0;
    let footerBlockCount = 0;
    let footerChangedCount = 0;

    for (let i = 0; i < TOTAL_GRID_BLOCKS; i++) {
      const row = Math.floor(i / GRID_COLUMNS);
      const col = i % GRID_COLUMNS;
      const zone = getZoneForRow(row);

      const hashA = currentBlockHashes[i] ?? "";
      const hashB = baselineBlockHashes[i] ?? "";

      const { distancePercent: rawDistance } = computeHexHammingDistance(
        hashA,
        hashB
      );

      // Noise suppression: if block distance <= BLOCK_NOISE_THRESHOLD (12%), treat as 0
      const isChanged = rawDistance > BLOCK_NOISE_THRESHOLD;
      const effectiveDistance = isChanged ? rawDistance : 0;

      blockDiffs.push({
        index: i,
        row,
        col,
        zone,
        distancePercent: Math.round(effectiveDistance * 100) / 100,
        isChanged,
      });

      totalEffectiveDistance += effectiveDistance;
      if (isChanged) {
        changedBlocksCount++;
      }

      if (zone === "hero") {
        heroDistanceSum += effectiveDistance;
        heroBlockCount++;
        if (isChanged) heroChangedCount++;
      } else if (zone === "body") {
        bodyDistanceSum += effectiveDistance;
        bodyBlockCount++;
        if (isChanged) bodyChangedCount++;
      } else {
        footerDistanceSum += effectiveDistance;
        footerBlockCount++;
        if (isChanged) footerChangedCount++;
      }
    }

    // 6. Aggregate Scores & Zone Metrics
    const visualChangeScore =
      Math.round((totalEffectiveDistance / TOTAL_GRID_BLOCKS) * 100) / 100;
    const heroZoneChange =
      heroBlockCount > 0
        ? Math.round((heroDistanceSum / heroBlockCount) * 100) / 100
        : 0;
    const bodyZoneChange =
      bodyBlockCount > 0
        ? Math.round((bodyDistanceSum / bodyBlockCount) * 100) / 100
        : 0;
    const footerZoneChange =
      footerBlockCount > 0
        ? Math.round((footerDistanceSum / footerBlockCount) * 100) / 100
        : 0;

    const changeSeverity = classifyVisualChangeSeverity(visualChangeScore);

    // 7. Meaningful Change Determination
    // Meaningful if:
    // overall >= 15% OR hero >= 20% OR changedBlocks >= 8 OR |heightDeltaPx| >= 300px
    const isMeaningfulChange =
      visualChangeScore >= MODERATE_CHANGE_THRESHOLD ||
      heroZoneChange >= HERO_CHANGE_THRESHOLD ||
      changedBlocksCount >= MEANINGFUL_CHANGED_BLOCKS_THRESHOLD ||
      Math.abs(heightDeltaPx) >= MEANINGFUL_HEIGHT_DELTA_PX;

    // 8. Generate Deterministic Explainable Reasons
    const changeReasons: string[] = [];
    if (!isMeaningfulChange) {
      if (visualChangeScore === 0 && heightDeltaPx === 0) {
        changeReasons.push("Visual appearance is identical to previous audit.");
      } else {
        changeReasons.push(
          `Visual differences are within normal anti-aliasing and rendering tolerances (${visualChangeScore}% overall change).`
        );
      }
    } else {
      if (heroZoneChange >= HERO_CHANGE_THRESHOLD) {
        changeReasons.push(
          `Above-the-fold hero section experienced substantial visual change (${heroZoneChange}%).`
        );
      }
      if (bodyZoneChange >= MODERATE_CHANGE_THRESHOLD) {
        changeReasons.push(
          `Page body content layout shifted noticeably (${bodyZoneChange}%).`
        );
      }
      if (footerZoneChange >= MODERATE_CHANGE_THRESHOLD) {
        changeReasons.push(
          `Footer section experienced visual changes (${footerZoneChange}%).`
        );
      }
      if (Math.abs(heightDeltaPx) >= MEANINGFUL_HEIGHT_DELTA_PX) {
        changeReasons.push(
          `Rendered page height changed by ${heightDeltaPx > 0 ? "+" : ""}${heightDeltaPx}px.`
        );
      }
      if (visualChangeScore >= SIGNIFICANT_CHANGE_THRESHOLD) {
        changeReasons.push(
          `Major visual redesign detected (${visualChangeScore}% overall difference).`
        );
      } else if (changedBlocksCount >= MEANINGFUL_CHANGED_BLOCKS_THRESHOLD) {
        changeReasons.push(
          `${changedBlocksCount} of ${TOTAL_GRID_BLOCKS} spatial layout blocks shifted.`
        );
      }
    }

    return {
      organizationId,
      projectId,
      monitoredPageId,
      currentAuditRunId: current.auditRunId,
      baselineAuditRunId: baseline.auditRunId,
      currentScreenshotId: current.screenshotId ?? null,
      baselineScreenshotId: baseline.screenshotId ?? null,
      deviceType: current.deviceType,
      captureType: current.captureType,
      schemaVersion: VISUAL_REGRESSION_SCHEMA_VERSION,
      diffAlgorithm: VISUAL_DIFF_ALGORITHM,
      status: "completed",
      isBaseline: false,
      isMeaningfulChange,
      visualChangeScore,
      changeSeverity,
      heroZoneChange,
      bodyZoneChange,
      footerZoneChange,
      changedBlocksCount,
      totalBlocksCount: TOTAL_GRID_BLOCKS,
      heightDeltaPx,
      changeReasons,
      blockDiffs,
      currentSignedUrl: current.signedUrl,
      baselineSignedUrl: baseline.signedUrl,
    };
  }

  /**
   * Helper to generate a blank/uniform block diff array for baselines or identical comparisons
   */
  private generateUniformBlockDiffs(
    distance: number,
    isChanged: boolean
  ): VisualBlockDiff[] {
    const diffs: VisualBlockDiff[] = [];
    for (let i = 0; i < TOTAL_GRID_BLOCKS; i++) {
      const row = Math.floor(i / GRID_COLUMNS);
      const col = i % GRID_COLUMNS;
      diffs.push({
        index: i,
        row,
        col,
        zone: getZoneForRow(row),
        distancePercent: distance,
        isChanged,
      });
    }
    return diffs;
  }
}

/**
 * Builds a composite VisualDiffSummary rollup from desktop and mobile diff results
 */
export function buildVisualDiffSummary(
  diffs: VisualDiffResult[]
): VisualDiffSummary {
  if (!diffs || diffs.length === 0) {
    return {
      hasVisualDiff: false,
      isBaseline: false,
      isMeaningfulChange: false,
      maxChangeScore: 0,
      maxChangeSeverity: "negligible",
      desktopChangeScore: null,
      mobileChangeScore: null,
      changeReasons: [],
    };
  }

  const isAllBaseline = diffs.every((d) => d.isBaseline);
  const desktop = diffs.find((d) => d.deviceType === "desktop");
  const mobile = diffs.find((d) => d.deviceType === "mobile");

  const desktopScore = desktop && !desktop.isBaseline ? desktop.visualChangeScore : null;
  const mobileScore = mobile && !mobile.isBaseline ? mobile.visualChangeScore : null;

  const validScores = [desktopScore, mobileScore].filter(
    (s): s is number => s !== null
  );
  const maxChangeScore = validScores.length > 0 ? Math.max(...validScores) : 0;
  const maxChangeSeverity = classifyVisualChangeSeverity(maxChangeScore);

  const isMeaningfulChange = diffs.some((d) => d.isMeaningfulChange);

  // Combine unique reasons
  const reasonsSet = new Set<string>();
  for (const d of diffs) {
    for (const r of d.changeReasons) {
      reasonsSet.add(r);
    }
  }

  return {
    hasVisualDiff: true,
    isBaseline: isAllBaseline,
    isMeaningfulChange,
    maxChangeScore,
    maxChangeSeverity,
    desktopChangeScore: desktopScore,
    mobileChangeScore: mobileScore,
    changeReasons: Array.from(reasonsSet),
  };
}

/**
 * Mock Visual Diff Engine for fast, deterministic unit testing
 */
export class MockVisualDiffEngine extends VisualDiffEngine {
  private customScore?: number;
  private customHeroScore?: number;

  constructor(options?: {
    customScore?: number;
    customHeroScore?: number;
  }) {
    super();
    this.customScore = options?.customScore;
    this.customHeroScore = options?.customHeroScore;
  }

  override compare(options: ComputeVisualDiffOptions): VisualDiffResult {
    const result = super.compare(options);
    if (this.customScore !== undefined && !result.isBaseline) {
      result.visualChangeScore = this.customScore;
      result.changeSeverity = classifyVisualChangeSeverity(this.customScore);
      result.isMeaningfulChange =
        this.customScore >= MODERATE_CHANGE_THRESHOLD ||
        (this.customHeroScore ?? 0) >= HERO_CHANGE_THRESHOLD;
    }
    if (this.customHeroScore !== undefined && !result.isBaseline) {
      result.heroZoneChange = this.customHeroScore;
      if (this.customHeroScore >= HERO_CHANGE_THRESHOLD) {
        result.isMeaningfulChange = true;
      }
    }
    return result;
  }
}
