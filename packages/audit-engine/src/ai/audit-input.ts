import type { DetectedSignal } from "@pagepilot/contracts";
import type { PageSnapshot } from "../extract/page-snapshot.js";

/**
 * Builds the compact, bounded evidence object sent to Gemini (Phase 5).
 *
 * This is the ONLY representation of a page the model ever sees. It contains
 * structural evidence and deterministic signals — never raw HTML, request
 * data, DNS details, or upstream response information. Every variable-length
 * field is truncated here, before serialization, so hostile pages cannot
 * inflate the prompt.
 */

const MODEL_INPUT_LIMITS = {
  url: 500,
  title: 200,
  metaDescription: 400,
  viewport: 200,
  canonical: 500,
  lang: 35,
  ogFields: 8,
  ogValue: 200,
  outlineEntries: 30,
  headingText: 120,
  textExcerpt: 4000,
  linkSamples: 12,
  linkText: 80,
  linkHref: 200,
  buttonTexts: 10,
  forms: 8,
  navigationSamples: 6,
  ctaCandidates: 10,
  ctaText: 80,
  signalEvidence: 160,
} as const;

/** Hard cap on the serialized JSON size of the model input. */
export const MODEL_INPUT_MAX_CHARS = 24_000;

export interface AuditModelInput {
  page: {
    requestedUrl: string;
    finalUrl: string;
    title: string | null;
    metaDescription: string | null;
    lang: string | null;
    viewport: string | null;
    canonical: string | null;
    openGraph: Record<string, string>;
    counts: {
      h1: number;
      h2: number;
      h3: number;
      anchors: number;
      buttons: number;
      forms: number;
      paragraphs: number;
      navigationRegions: number;
      images: number;
      imagesWithAlt: number;
      visibleTextCharacters: number;
    };
    headingWarnings: snapshotHeadingWarnings;
  };
  content: {
    /** Whitespace-normalized visible text, truncated for the model. */
    textExcerpt: string;
    headingOutline: { level: number; text: string }[];
  };
  samples: {
    links: { href: string | null; text: string }[];
    buttons: string[];
    forms: { fieldCount: number; labeledFieldCount: number }[];
    navigationFirstItems: string[];
    ctaCandidates: { kind: string; text: string; href?: string | null }[];
  };
  deterministicSignals: {
    id: string;
    category: string;
    status: string;
    weight: number;
    evidence: string;
  }[];
}

type snapshotHeadingWarnings = string[];

function bounded(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function boundedOrNull(value: string | null, limit: number): string | null {
  return value === null ? null : bounded(value, limit);
}

/**
 * The snapshot is already bounded at extraction time; this second bound
 * guarantees the model input stays small even as extraction limits evolve.
 */
export function buildAuditModelInput(
  snapshot: PageSnapshot,
  requestedUrl: string,
  signals: readonly DetectedSignal[],
): AuditModelInput {
  return {
    page: {
      requestedUrl: bounded(requestedUrl, MODEL_INPUT_LIMITS.url),
      finalUrl: bounded(snapshot.finalUrl, MODEL_INPUT_LIMITS.url),
      title: boundedOrNull(snapshot.title, MODEL_INPUT_LIMITS.title),
      metaDescription: boundedOrNull(
        snapshot.metaDescription,
        MODEL_INPUT_LIMITS.metaDescription,
      ),
      lang: boundedOrNull(snapshot.lang, MODEL_INPUT_LIMITS.lang),
      viewport: boundedOrNull(snapshot.viewport, MODEL_INPUT_LIMITS.viewport),
      canonical: boundedOrNull(snapshot.canonical, MODEL_INPUT_LIMITS.canonical),
      openGraph: Object.fromEntries(
        Object.entries(snapshot.openGraph)
          .slice(0, MODEL_INPUT_LIMITS.ogFields)
          .map(([key, value]) => [key.slice(0, 60), bounded(value, MODEL_INPUT_LIMITS.ogValue)]),
      ),
      counts: {
        h1: snapshot.h1Count,
        h2: snapshot.h2Count,
        h3: snapshot.h3Count,
        anchors: snapshot.anchorCount,
        buttons: snapshot.buttonCount,
        forms: snapshot.formCount,
        paragraphs: snapshot.paragraphCount,
        navigationRegions: snapshot.navigationRegionCount,
        images: snapshot.imageCount,
        imagesWithAlt: snapshot.imagesWithAltCount,
        visibleTextCharacters: snapshot.textLength,
      },
      headingWarnings: snapshot.headingWarnings,
    },
    content: {
      // Truncated excerpt — deliberately smaller than the snapshot cap.
      textExcerpt: bounded(snapshot.textExcerpt, MODEL_INPUT_LIMITS.textExcerpt),
      headingOutline: snapshot.headingOutline
        .slice(0, MODEL_INPUT_LIMITS.outlineEntries)
        .map((entry) => ({
          level: entry.level,
          text: bounded(entry.text, MODEL_INPUT_LIMITS.headingText),
        })),
    },
    samples: {
      links: snapshot.linkSamples.slice(0, MODEL_INPUT_LIMITS.linkSamples).map((link) => ({
        href: boundedOrNull(link.href, MODEL_INPUT_LIMITS.linkHref),
        text: bounded(link.text, MODEL_INPUT_LIMITS.linkText),
      })),
      buttons: snapshot.buttonTexts
        .slice(0, MODEL_INPUT_LIMITS.buttonTexts)
        .map((text) => bounded(text, MODEL_INPUT_LIMITS.ctaText)),
      forms: snapshot.formSamples.slice(0, MODEL_INPUT_LIMITS.forms),
      navigationFirstItems: snapshot.navigationSamples
        .slice(0, MODEL_INPUT_LIMITS.navigationSamples)
        .map((text) => bounded(text, MODEL_INPUT_LIMITS.linkText)),
      ctaCandidates: snapshot.ctaCandidates
        .slice(0, MODEL_INPUT_LIMITS.ctaCandidates)
        .map((candidate) => ({
          kind: candidate.kind,
          text: bounded(candidate.text, MODEL_INPUT_LIMITS.ctaText),
          href:
            candidate.href === undefined || candidate.href === null
              ? undefined
              : bounded(candidate.href, MODEL_INPUT_LIMITS.linkHref),
        })),
    },
    deterministicSignals: signals.map((signal) => ({
      id: signal.id,
      category: signal.category,
      status: signal.status,
      weight: signal.weight,
      evidence: bounded(signal.evidence, MODEL_INPUT_LIMITS.signalEvidence),
    })),
  };
}

/**
 * Final safety gate before the network call: if the serialized evidence ever
 * exceeds the hard cap, drop the text excerpt first, then fail closed.
 */
export function serializeModelInput(input: AuditModelInput): string {
  let json = JSON.stringify(input);
  if (json.length <= MODEL_INPUT_MAX_CHARS) return json;
  const trimmed = {
    ...input,
    content: { ...input.content, textExcerpt: input.content.textExcerpt.slice(0, 1000) },
  };
  json = JSON.stringify(trimmed);
  if (json.length > MODEL_INPUT_MAX_CHARS) {
    throw new Error("audit model input exceeded its size cap");
  }
  return json;
}
