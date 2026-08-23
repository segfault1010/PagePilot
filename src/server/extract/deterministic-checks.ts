import type { DetectedSignal } from "../../shared/audit-types";
import type { PageSnapshot } from "./page-snapshot";

/**
 * Deterministic checks over the PageSnapshot. Every signal has a stable ID,
 * a category, a bounded weight, and plain-language evidence. `unknown` is
 * used only when HTML genuinely cannot establish the answer — unknown
 * signals must never create a scoring penalty (Phase 5 honors this).
 */
export const SIGNAL_IDS = {
  titlePresent: "title.present",
  titleLength: "title.length",
  metaDescriptionPresent: "meta.description.present",
  metaDescriptionLength: "meta.description.length",
  singleMeaningfulH1: "h1.single-meaningful",
  headingOrder: "headings.order",
  headingCoverage: "headings.coverage",
  contentSufficiency: "copy.sufficiency",
  duplicateHeadings: "headings.duplicates",
  ctaCandidates: "cta.candidates",
  formsPresent: "forms.present",
  actionLinks: "links.action",
  imageAltCoverage: "images.alt-coverage",
  documentLang: "document.lang",
  formLabels: "forms.labels",
  linkTextQuality: "links.text-quality",
  viewportPresent: "viewport.present",
  mobileFormControls: "mobile.form-controls",
  canonicalPresent: "canonical.present",
  ogMetadata: "og.metadata",
  trustLinks: "trust.links",
} as const;

const TRUST_LINK_PATTERNS =
  /(privacy|terms|legal|imprint|contact|about|refund|shipping|returns|security|accessibility|impressum)/i;
const WEAK_LINK_TEXT =
  /^(click here|here|read more|more|link|this|learn more|details|info|continue|go)$/i;

export function runDeterministicChecks(snapshot: PageSnapshot): DetectedSignal[] {
  const signals: DetectedSignal[] = [];

  // --- Clarity --------------------------------------------------------------
  signals.push({
    id: SIGNAL_IDS.titlePresent,
    category: "clarity",
    status: snapshot.title !== null ? "pass" : "warn",
    weight: 0.5,
    evidence:
      snapshot.title !== null
        ? `Title present: "${snapshot.title}".`
        : "No <title> element found.",
  });

  const titleLength = snapshot.title?.length ?? 0;
  signals.push({
    id: SIGNAL_IDS.titleLength,
    category: "clarity",
    status:
      titleLength === 0
        ? "unknown"
        : titleLength >= 15 && titleLength <= 65
          ? "pass"
          : "warn",
    weight: 0.3,
    evidence:
      titleLength === 0
        ? "Title length cannot be assessed."
        : `Title is ${titleLength} characters.`,
  });

  signals.push({
    id: SIGNAL_IDS.metaDescriptionPresent,
    category: "clarity",
    status: snapshot.metaDescription !== null ? "pass" : "warn",
    weight: 0.4,
    evidence:
      snapshot.metaDescription !== null
        ? "Meta description present."
        : "No meta description found.",
  });

  const descriptionLength = snapshot.metaDescription?.length ?? 0;
  signals.push({
    id: SIGNAL_IDS.metaDescriptionLength,
    category: "clarity",
    status:
      descriptionLength === 0
        ? "unknown"
        : descriptionLength >= 50 && descriptionLength <= 160
          ? "pass"
          : "warn",
    weight: 0.2,
    evidence:
      descriptionLength === 0
        ? "Meta description length cannot be assessed."
        : `Meta description is ${descriptionLength} characters.`,
  });

  // --- Visual hierarchy ------------------------------------------------------
  signals.push({
    id: SIGNAL_IDS.singleMeaningfulH1,
    category: "visualHierarchy",
    status: snapshot.h1Count === 1 ? "pass" : "warn",
    weight: 0.4,
    evidence:
      snapshot.h1Count === 1
        ? "Exactly one H1 heading."
        : `${snapshot.h1Count} H1 headings found (expected exactly one).`,
  });

  const skips = snapshot.headingWarnings.filter(
    (warning) => warning === "heading-level-skip",
  );
  signals.push({
    id: SIGNAL_IDS.headingOrder,
    category: "visualHierarchy",
    status:
      snapshot.headingOutline.length === 0
        ? "unknown"
        : skips.length > 0 || snapshot.headingWarnings.includes("multiple-h1")
          ? "warn"
          : "pass",
    weight: 0.35,
    evidence:
      snapshot.headingOutline.length === 0
        ? "No headings found; ordering cannot be assessed."
        : skips.length > 0
          ? "Heading levels skip (e.g., H1 directly to H3+)."
          : snapshot.headingWarnings.includes("multiple-h1")
            ? "Multiple H1s disturb the outline."
            : "Heading levels descend without skips.",
  });

  signals.push({
    id: SIGNAL_IDS.headingCoverage,
    category: "visualHierarchy",
    status:
      snapshot.h1Count + snapshot.h2Count + snapshot.h3Count > 0 ? "pass" : "warn",
    weight: 0.25,
    evidence: `Found ${snapshot.h1Count} H1, ${snapshot.h2Count} H2, ${snapshot.h3Count} H3 headings.`,
  });

  if (snapshot.headingWarnings.includes("duplicate-headings")) {
    signals.push({
      id: SIGNAL_IDS.duplicateHeadings,
      category: "visualHierarchy",
      status: "warn",
      weight: 0.1,
      evidence: "Identical repeated headings detected in the outline.",
    });
  }

  // --- CTA effectiveness ------------------------------------------------------
  signals.push({
    id: SIGNAL_IDS.ctaCandidates,
    category: "ctaEffectiveness",
    status:
      snapshot.ctaCandidates.length === 0
        ? "warn"
        : snapshot.ctaCandidates.length >= 1 && snapshot.ctaCandidates.length <= 5
          ? "pass"
          : "unknown",
    weight: 0.35,
    evidence:
      snapshot.ctaCandidates.length === 0
        ? "No obvious call-to-action candidates (buttons or action links) found."
        : `${snapshot.ctaCandidates.length} CTA candidate(s) detected, e.g. "${snapshot.ctaCandidates[0]!.text}". Visual prominence cannot be verified from static HTML.`,
  });

  signals.push({
    id: SIGNAL_IDS.formsPresent,
    category: "ctaEffectiveness",
    status: snapshot.formCount > 0 ? "pass" : "unknown",
    weight: 0.2,
    evidence:
      snapshot.formCount > 0
        ? `${snapshot.formCount} form(s) found.`
        : "No forms found; conversion paths other than forms may still exist.",
  });

  const linkActionCount = snapshot.ctaCandidates.filter(
    (candidate) => candidate.kind === "link",
  ).length;
  signals.push({
    id: SIGNAL_IDS.actionLinks,
    category: "ctaEffectiveness",
    status: linkActionCount > 0 ? "pass" : "unknown",
    weight: 0.15,
    evidence:
      linkActionCount > 0
        ? `${linkActionCount} anchor(s) with action-oriented text.`
        : "No anchors with clearly action-oriented wording.",
  });

  // --- Copy --------------------------------------------------------------------
  signals.push({
    id: SIGNAL_IDS.contentSufficiency,
    category: "copy",
    status: snapshot.textLength >= 300 ? "pass" : "warn",
    weight: 0.4,
    evidence: `Visible text length is ${snapshot.textLength} characters.`,
  });

  signals.push({
    id: SIGNAL_IDS.linkTextQuality,
    category: "copy",
    status: (() => {
      const weakLinks = snapshot.linkSamples.filter((sample) =>
        WEAK_LINK_TEXT.test(sample.text.toLowerCase()),
      );
      if (snapshot.anchorCount === 0) return "unknown";
      return weakLinks.length > 0 ? "warn" : "pass";
    })(),
    weight: 0.2,
    evidence: (() => {
      const weakLinks = snapshot.linkSamples.filter((sample) =>
        WEAK_LINK_TEXT.test(sample.text.toLowerCase()),
      );
      return weakLinks.length > 0
        ? `Generic link text found (${weakLinks.length} sample(s), e.g. "${weakLinks[0]!.text}").`
        : snapshot.anchorCount === 0
          ? "No links to assess."
          : "Link text appears descriptive.";
    })(),
  });

  // --- Accessibility -------------------------------------------------------------
  signals.push({
    id: SIGNAL_IDS.imageAltCoverage,
    category: "accessibility",
    status:
      snapshot.imageCount === 0
        ? "unknown"
        : snapshot.imagesWithAltCount === snapshot.imageCount
          ? "pass"
          : "warn",
    weight: 0.35,
    evidence:
      snapshot.imageCount === 0
        ? "No images found; alt coverage not applicable."
        : `${snapshot.imagesWithAltCount} of ${snapshot.imageCount} images have an alt attribute.`,
  });

  signals.push({
    id: SIGNAL_IDS.documentLang,
    category: "accessibility",
    status: snapshot.lang !== null ? "pass" : "warn",
    weight: 0.2,
    evidence:
      snapshot.lang !== null
        ? `Document language declared: "${snapshot.lang}".`
        : "The html element has no lang attribute.",
  });

  const totalFields = snapshot.formSamples.reduce(
    (sum, form) => sum + form.fieldCount,
    0,
  );
  const labeledFields = snapshot.formSamples.reduce(
    (sum, form) => sum + form.labeledFieldCount,
    0,
  );
  signals.push({
    id: SIGNAL_IDS.formLabels,
    category: "accessibility",
    status:
      totalFields === 0
        ? "unknown"
        : labeledFields === totalFields
          ? "pass"
          : "warn",
    weight: 0.25,
    evidence:
      totalFields === 0
        ? "No form fields found; label coverage not applicable."
        : `${labeledFields} of ${totalFields} form fields have programmatic labels.`,
  });

  // --- Mobile UX -----------------------------------------------------------------
  signals.push({
    id: SIGNAL_IDS.viewportPresent,
    category: "mobileUx",
    status: snapshot.viewport !== null ? "pass" : "warn",
    weight: 0.6,
    evidence:
      snapshot.viewport !== null
        ? `Viewport meta tag present ("${snapshot.viewport.slice(0, 60)}").`
        : "No viewport meta tag found.",
  });

  signals.push({
    id: SIGNAL_IDS.mobileFormControls,
    category: "mobileUx",
    status:
      snapshot.formSamples.length === 0
        ? "unknown"
        : snapshot.formSamples.every((form) => form.fieldCount <= 8)
          ? "pass"
          : "warn",
    weight: 0.15,
    evidence:
      snapshot.formSamples.length === 0
        ? "No forms; mobile control density not applicable."
        : "Form structure detectable from HTML only; visual mobile rendering cannot be verified.",
  });

  // --- Trust / credibility ----------------------------------------------------------
  signals.push({
    id: SIGNAL_IDS.canonicalPresent,
    category: "trustCredibility",
    status: snapshot.canonical !== null ? "pass" : "warn",
    weight: 0.2,
    evidence:
      snapshot.canonical !== null
        ? `Canonical link present (${snapshot.canonical.slice(0, 100)}).`
        : "No canonical link found.",
  });

  const ogKeyCount = Object.keys(snapshot.openGraph).length;
  signals.push({
    id: SIGNAL_IDS.ogMetadata,
    category: "trustCredibility",
    status: ogKeyCount >= 2 ? "pass" : "warn",
    weight: 0.25,
    evidence:
      ogKeyCount === 0
        ? "No Open Graph metadata found."
        : `${ogKeyCount} Open Graph field(s): ${Object.keys(snapshot.openGraph).join(", ")}.`,
  });

  signals.push({
    id: SIGNAL_IDS.trustLinks,
    category: "trustCredibility",
    status: (() => {
      const trustMatches = snapshot.linkSamples.filter((sample) =>
        TRUST_LINK_PATTERNS.test(sample.href ?? "") ||
        TRUST_LINK_PATTERNS.test(sample.text),
      );
      return trustMatches.length > 0 ? "pass" : "unknown";
    })(),
    weight: 0.25,
    evidence: (() => {
      const trustMatches = snapshot.linkSamples.filter(
        (sample) =>
          TRUST_LINK_PATTERNS.test(sample.href ?? "") ||
          TRUST_LINK_PATTERNS.test(sample.text),
      );
      return trustMatches.length > 0
        ? `Trust/legal/contact link candidates found (e.g. "${trustMatches[0]!.text || trustMatches[0]!.href}").`
        : "No contact/legal/trust link patterns detected in sampled links; absence is not proof of missing trust pages.";
    })(),
  });

  return signals;
}
