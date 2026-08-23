import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

export const TEXT_EXCERPT_LIMIT = 12_000;

const SAMPLE_LIMITS = {
  outline: 30,
  links: 20,
  buttons: 15,
  forms: 10,
  navigation: 10,
  ctaCandidates: 12,
  ogFields: 8,
} as const;

const ACTION_PHRASES =
  /\b(get started|start(?:ed| free| trial)?|sign ?up|log ?in|login|register|buy( now)?|order|download|subscribe|try(?: it| free)?|request (?:a )?demo|book (?:a )?(?:call|demo)|contact(?: us)?|join|donate|apply|claim|explore|learn more|get (?:your )?(?:free|quote|report))\b/i;

export interface HeadingOutlineEntry {
  level: number;
  text: string;
}

export interface LinkSample {
  href: string | null;
  text: string;
}

export interface FormSample {
  fieldCount: number;
  labeledFieldCount: number;
}

export interface CtaCandidate {
  kind: "button" | "link" | "form";
  text: string;
  href?: string | null;
}

export interface PageSnapshot {
  finalUrl: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  viewport: string | null;
  openGraph: Record<string, string>;
  lang: string | null;

  h1Count: number;
  h2Count: number;
  h3Count: number;
  headingOutline: HeadingOutlineEntry[];
  headingWarnings: string[];

  textExcerpt: string;
  textLength: number;

  anchorCount: number;
  formCount: number;
  paragraphCount: number;
  navigationRegionCount: number;
  buttonCount: number;
  imageCount: number;
  imagesWithAltCount: number;

  linkSamples: LinkSample[];
  buttonTexts: string[];
  formSamples: FormSample[];
  navigationSamples: string[];
  ctaCandidates: CtaCandidate[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bounded(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function boundedAttr(value: string | undefined, limit: number): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? bounded(trimmed, limit) : null;
}

function metaContent($: CheerioAPI, name: string): string | null {
  const value = $(`meta[name="${name}"]`).attr("content")?.trim() ?? "";
  return value.length > 0 ? bounded(value, 400) : null;
}

/**
 * Builds a compact, deterministic PageSnapshot from static HTML using
 * Cheerio. No target-site JavaScript is executed and no raw HTML leaves
 * this module — only bounded structural evidence.
 */
export function buildPageSnapshot(html: string, finalUrl: string): PageSnapshot {
  // Strip any byte-order mark; some servers emit one and it can disturb
  // implicit head/html structure during parsing.
  const normalized = html.charCodeAt(0) === 0xfeff ? html.slice(1) : html;
  const $ = cheerio.load(normalized);

  // Non-visible elements are removed up front so nothing inside
  // script/style/noscript/template/svg can leak into samples, CTAs,
  // headings, counts, or visible text.
  $("script, style, noscript, template, svg").remove();

  // --- Metadata -----------------------------------------------------------
  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, element) => {
    if (Object.keys(openGraph).length >= SAMPLE_LIMITS.ogFields) return;
    const property = ($(element).attr("property") ?? "").trim();
    const content = ($(element).attr("content") ?? "").trim();
    if (property.length === 0 || content.length === 0) return;
    openGraph[property] = bounded(content, 300);
  });

  const titleRaw = normalizeWhitespace($("head > title").first().text());
  const title = titleRaw.length > 0 ? bounded(titleRaw, 200) : null;
  // Attribute-derived strings are bounded at extraction time so hostile
  // pages cannot inflate the snapshot, evidence, or API payloads.
  const canonical = boundedAttr($("link[rel=canonical]").attr("href"), 500);
  const viewport = boundedAttr($("meta[name=viewport]").attr("content"), 200);
  const lang = boundedAttr($("html").attr("lang"), 35);

  // --- Headings -----------------------------------------------------------
  const headingOutline: HeadingOutlineEntry[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, element) => {
    if (headingOutline.length >= SAMPLE_LIMITS.outline) return;
    const level = Number(element.tagName.slice(1));
    headingOutline.push({
      level,
      text: bounded(normalizeWhitespace($(element).text()), 150),
    });
  });

  const h1Count = $("h1").length;
  const h2Count = $("h2").length;
  const h3Count = $("h3").length;

  const warnings = new Set<string>();
  if (h1Count > 1) warnings.add("multiple-h1");
  let previousLevel: number | null = null;
  for (const entry of headingOutline) {
    if (previousLevel !== null && entry.level > previousLevel + 1) {
      warnings.add("heading-level-skip");
    }
    previousLevel = entry.level;
  }
  const seenHeadings = new Set<string>();
  for (const entry of headingOutline) {
    const key = `${entry.level}:${entry.text.toLowerCase()}`;
    if (entry.text.length > 0 && seenHeadings.has(key)) {
      warnings.add("duplicate-headings");
    }
    seenHeadings.add(key);
  }

  // --- Samples and counts ---------------------------------------------------
  const anchorCount = $("a[href]").length;
  const formCount = $("form").length;
  const paragraphCount = $("p").length;
  const navigationRegionCount = $("nav, [role=navigation]").length;
  const buttonCount = $("button").length;
  const imageCount = $("img").length;
  const imagesWithAltCount = $("img[alt]").length;

  const linkSamples: LinkSample[] = [];
  $("a[href]").each((_, element) => {
    if (linkSamples.length >= SAMPLE_LIMITS.links) return;
    linkSamples.push({
      href: boundedAttr($(element).attr("href"), 300),
      text: bounded(normalizeWhitespace($(element).text()), 100),
    });
  });

  const buttonTexts: string[] = [];
  $("button").each((_, element) => {
    if (buttonTexts.length >= SAMPLE_LIMITS.buttons) return;
    const text = normalizeWhitespace($(element).text());
    if (text.length === 0) return;
    buttonTexts.push(bounded(text, 80));
  });
  $("input[type=submit]").each((_, element) => {
    if (buttonTexts.length >= SAMPLE_LIMITS.buttons) return;
    const value = ($(element).attr("value") ?? "").trim();
    if (value.length === 0) return;
    buttonTexts.push(bounded(value, 80));
  });

  const formSamples: FormSample[] = [];
  $("form").each((_, element) => {
    if (formSamples.length >= SAMPLE_LIMITS.forms) return;
    const $form = $(element);
    const fields = $form.find("input:not([type=hidden]), select, textarea");
    let labeledFieldCount = 0;
    fields.each((_index, field) => {
      const $field = $(field);
      const id = $field.attr("id");
      const hasLabelFor =
        id !== undefined && $(`label[for="${id}"]`).length > 0;
      const wrapped = $field.closest("label").length > 0;
      const ariaLabelled =
        ($field.attr("aria-label") ?? $field.attr("aria-labelledby") ?? "")
          .trim()
          .length > 0;
      if (hasLabelFor || wrapped || ariaLabelled) labeledFieldCount += 1;
    });
    formSamples.push({ fieldCount: fields.length, labeledFieldCount });
  });

  const navigationSamples: string[] = [];
  $("nav, [role=navigation]").each((_, element) => {
    if (navigationSamples.length >= SAMPLE_LIMITS.navigation) return;
    const text = normalizeWhitespace($(element).find("a").first().text());
    if (text.length === 0) return;
    navigationSamples.push(bounded(text, 80));
  });

  // --- Visible text ----------------------------------------------------------
  const rawText = normalizeWhitespace(
    ($("body").length > 0 ? $("body").text() : $.root().text()) ?? "",
  );

  // --- CTA candidates (conservative, evidence-only) --------------------------
  const ctaCandidates: CtaCandidate[] = buttonTexts.map((text) => ({
    kind: "button" as const,
    text,
  }));
  $("input[type=submit]").each((_, element) => {
    if (ctaCandidates.length >= SAMPLE_LIMITS.ctaCandidates) return;
    const value = ($(element).attr("value") ?? "").trim();
    if (value.length === 0) return;
    ctaCandidates.push({ kind: "button", text: bounded(value, 80) });
  });
  $("a[href]").each((_, element) => {
    if (ctaCandidates.length >= SAMPLE_LIMITS.ctaCandidates) return;
    const text = normalizeWhitespace($(element).text());
    if (text.length === 0 || text.length > 60) return;
    if (!ACTION_PHRASES.test(text)) return;
    ctaCandidates.push({
      kind: "link",
      text: bounded(text, 80),
      href: boundedAttr($(element).attr("href"), 300),
    });
  });

  return {
    finalUrl,
    title,
    metaDescription: metaContent($, "description"),
    canonical,
    viewport,
    openGraph,
    lang,

    h1Count,
    h2Count,
    h3Count,
    headingOutline: headingOutline.slice(0, SAMPLE_LIMITS.outline),
    headingWarnings: [...warnings],

    textExcerpt: rawText.slice(0, TEXT_EXCERPT_LIMIT),
    textLength: rawText.length,

    anchorCount,
    formCount,
    paragraphCount,
    navigationRegionCount,
    buttonCount,
    imageCount,
    imagesWithAltCount,

    linkSamples: linkSamples.slice(0, SAMPLE_LIMITS.links),
    buttonTexts,
    formSamples,
    navigationSamples,
    ctaCandidates,
  };
}
