import {
  type ScreenshotDeviceType,
  type ScreenshotMimeType,
  type VisualAnalysisReview,
  VISUAL_ANALYSIS_DEFAULT_MODEL,
  VISUAL_PROVENANCE_LABEL,
} from "@pagepilot/contracts";
import { AiError } from "./gemini-auditor.js";
import {
  geminiVisionResponseJsonSchema,
  parseGeminiVisionOutput,
} from "../schemas/vision-audit-schema.js";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4096;
const TEMPERATURE = 0.2;
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface ScreenshotInput {
  buffer: Buffer;
  mimeType: ScreenshotMimeType;
  width: number;
  height: number;
  screenshotId?: string;
}

export interface VisualAnalysisInput {
  auditRunId: string;
  auditReportId?: string | null;
  targetUrl: string;
  pageTitle?: string | null;
  desktopScreenshot?: ScreenshotInput;
  mobileScreenshot?: ScreenshotInput;
}

export interface VisionAuditProvider {
  runVisualReview(input: VisualAnalysisInput): Promise<VisualAnalysisReview>;
}

export interface GeminiVisionAuditorOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const SYSTEM_INSTRUCTION = `You are a principal visual UX designer and conversion rate optimization specialist conducting a multimodal visual hierarchy review for PagePilot.

You receive real browser-rendered screenshots for a landing page across desktop and/or mobile viewports.

Follow these strict rules without exception:
1. Base all observations strictly on what is visibly rendered in the provided viewport screenshots. Never invent facts about the page, its traffic, conversions, users, or off-screen hidden elements.
2. Evaluate these seven visual dimensions thoroughly:
   - visual_hierarchy: Primary focal point, reading path, balance of visual weights.
   - cta_prominence: Visibility and contrast pop of the primary action button above the fold.
   - visual_clutter: Element density, competing visual anchors, cognitive noise.
   - contrast_legibility: Apparent text-to-background contrast, overlay legibility (classified as apparent contrast with confidence level).
   - typography_hierarchy: Heading-to-body scale disparity, line length, readable scale.
   - spacing_layout: Whitespace breathing room, grid alignment, Gestalt visual grouping.
   - mobile_adaptation: 375px viewport rendering, touch target crowding, horizontal clipping.
3. Uncertainty calibration:
   - You cannot compute exact mathematical WCAG contrast ratios without CSS computed values. Report apparent visual contrast and set confidence to 'high', 'medium', or 'low' accordingly.
   - Do not claim Core Web Vitals, page speed, or analytics measurements.
4. Each finding must include concrete visual observations, why it impacts user experience or conversion, and an actionable design recommendation.
5. Provide a concise executiveSummary (2-4 sentences) capturing the overall visual impression.
6. Respond with a single JSON object matching the required schema exactly — no markdown fences, no commentary, no additional properties.`;

function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (/^gemini-[3-9]\./.test(model)) return { thinkingLevel: "low" };
  if (/^gemini-2\.5\./.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

export function createGeminiVisionAuditor(
  options: GeminiVisionAuditorOptions = {}
): VisionAuditProvider {
  const apiKey =
    options.apiKey ??
    process.env.GEMINI_API_KEY ??
    "";
  const model =
    options.model?.trim() ||
    process.env.GEMINI_VISION_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    VISUAL_ANALYSIS_DEFAULT_MODEL;
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  console.error(
    `[ai] gemini vision auditor configured: model=${model} key=${apiKey.length > 0 ? "present" : "missing"}`
  );

  return {
    async runVisualReview(
      input: VisualAnalysisInput
    ): Promise<VisualAnalysisReview> {
      if (apiKey.length === 0) {
        throw new AiError(
          "configuration",
          "GEMINI_API_KEY is not configured for vision audit"
        );
      }

      const hasDesktop = Boolean(input.desktopScreenshot?.buffer);
      const hasMobile = Boolean(input.mobileScreenshot?.buffer);

      if (!hasDesktop && !hasMobile) {
        throw new AiError(
          "invalid-response",
          "No screenshots provided for visual analysis review"
        );
      }

      const viewportsAnalyzed: ScreenshotDeviceType[] = [];
      const screenshotIds: string[] = [];

      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [
        {
          text: [
            SYSTEM_INSTRUCTION,
            "",
            `TARGET URL: ${input.targetUrl}`,
            input.pageTitle ? `PAGE TITLE: ${input.pageTitle}` : "",
            "",
            "Review the attached browser-rendered screenshot(s) now and output structured visual assessment JSON.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];

      if (input.desktopScreenshot) {
        viewportsAnalyzed.push("desktop");
        if (input.desktopScreenshot.screenshotId) {
          screenshotIds.push(input.desktopScreenshot.screenshotId);
        }
        parts.push({
          text: `DESKTOP VIEWPORT SCREENSHOT (${input.desktopScreenshot.width}x${input.desktopScreenshot.height} px, above-the-fold capture):`,
        });
        parts.push({
          inlineData: {
            mimeType: input.desktopScreenshot.mimeType,
            data: input.desktopScreenshot.buffer.toString("base64"),
          },
        });
      }

      if (input.mobileScreenshot) {
        viewportsAnalyzed.push("mobile");
        if (input.mobileScreenshot.screenshotId) {
          screenshotIds.push(input.mobileScreenshot.screenshotId);
        }
        parts.push({
          text: `MOBILE VIEWPORT SCREENSHOT (${input.mobileScreenshot.width}x${input.mobileScreenshot.height} px, iPhone mobile viewport):`,
        });
        parts.push({
          inlineData: {
            mimeType: input.mobileScreenshot.mimeType,
            data: input.mobileScreenshot.buffer.toString("base64"),
          },
        });
      }

      const sendRequest = async (
        extraConfig?: Record<string, unknown>
      ): Promise<Response> => {
        try {
          return await fetchFn(
            `${API_ROOT}/${encodeURIComponent(model)}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify({
                contents: [{ role: "user", parts }],
                generationConfig: {
                  responseMimeType: "application/json",
                  responseJsonSchema: geminiVisionResponseJsonSchema(),
                  temperature: TEMPERATURE,
                  maxOutputTokens: MAX_OUTPUT_TOKENS,
                  ...extraConfig,
                },
              }),
              signal: AbortSignal.timeout(timeoutMs),
            }
          );
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
          ) {
            throw new AiError("timeout", `no vision response within ${timeoutMs}ms`);
          }
          throw new AiError("unavailable", "vision request failed");
        }
      };

      const thinking = thinkingConfigFor(model);
      let response = await sendRequest(
        thinking ? { thinkingConfig: thinking } : undefined
      );

      // Retry once without thinking config if rejected with 400
      if (!response.ok && response.status === 400 && thinking) {
        console.error("[ai] retrying vision request without thinking settings");
        response = await sendRequest(undefined);
      }

      // Retry once after brief pause on transient 503/429
      if (!response.ok && (response.status === 503 || response.status === 429)) {
        console.error(`[ai] transient ${response.status} from gemini vision; retrying once...`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        response = await sendRequest(thinking ? { thinkingConfig: thinking } : undefined);
      }

      if (!response.ok) {
        const kind =
          response.status === 401 || response.status === 403
            ? "configuration"
            : "unavailable";
        console.error(
          `[ai] gemini vision request failed: kind=${kind} status=${response.status}`
        );
        throw new AiError(kind, `http ${response.status}`);
      }

      let payload: GenerateContentResponse;
      try {
        payload = (await response.json()) as GenerateContentResponse;
      } catch {
        throw new AiError("invalid-response", "unparseable vision envelope");
      }

      const blockedBy = payload.promptFeedback?.blockReason;
      if (blockedBy) {
        console.error(`[ai] gemini vision response blocked: reason=${blockedBy}`);
        throw new AiError("unavailable", "vision response blocked");
      }

      const candidate = payload.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason && finishReason !== "STOP") {
        throw new AiError("invalid-response", `finishReason=${finishReason}`);
      }

      const text = candidate?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("");
      if (!text || text.trim().length === 0) {
        throw new AiError("invalid-response", "empty vision completion");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AiError(
          "invalid-response",
          "model vision output was not valid JSON"
        );
      }

      const outcome = parseGeminiVisionOutput(parsed, {
        auditRunId: input.auditRunId,
        auditReportId: input.auditReportId,
        modelIdentifier: model,
        viewportsAnalyzed,
        screenshotIds,
      });

      if (!outcome.ok) {
        console.error(`[ai] gemini vision output rejected: ${outcome.reason}`);
        throw new AiError("invalid-response", outcome.reason);
      }

      return outcome.review;
    },
  };
}

/**
 * Deterministic Mock Vision Auditor for offline and reproducible tests
 */
export class MockVisionAuditor implements VisionAuditProvider {
  private customReview?: Partial<VisualAnalysisReview>;
  private errorToThrow?: Error;

  constructor(options?: {
    customReview?: Partial<VisualAnalysisReview>;
    errorToThrow?: Error;
  }) {
    this.customReview = options?.customReview;
    this.errorToThrow = options?.errorToThrow;
  }

  async runVisualReview(
    input: VisualAnalysisInput
  ): Promise<VisualAnalysisReview> {
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const viewports: ScreenshotDeviceType[] = [];
    const screenshotIds: string[] = [];
    if (input.desktopScreenshot) {
      viewports.push("desktop");
      if (input.desktopScreenshot.screenshotId) {
        screenshotIds.push(input.desktopScreenshot.screenshotId);
      }
    }
    if (input.mobileScreenshot) {
      viewports.push("mobile");
      if (input.mobileScreenshot.screenshotId) {
        screenshotIds.push(input.mobileScreenshot.screenshotId);
      }
    }

    const defaultReview: VisualAnalysisReview = {
      auditRunId: input.auditRunId,
      auditReportId: input.auditReportId ?? null,
      provenance: VISUAL_PROVENANCE_LABEL,
      schemaVersion: "1.0.0",
      promptVersion: "1.0.0",
      modelIdentifier: "mock-vision-model",
      status: "completed",
      executiveSummary:
        "The page demonstrates structured desktop visual hierarchy with clear hero messaging, though the primary CTA displays moderate contrast on mobile.",
      viewportsAnalyzed: viewports.length > 0 ? viewports : ["desktop"],
      dimensions: {
        visual_hierarchy: {
          rating: "strong",
          explanation: "Clear reading flow from hero headline to subhead.",
        },
        cta_prominence: {
          rating: "adequate",
          explanation: "Primary button is visible above the fold on desktop.",
          isAboveFoldCtaVisible: true,
        },
        visual_clutter: {
          rating: "strong",
          explanation: "Minimal visual noise with well-contained elements.",
        },
        contrast_legibility: {
          rating: "adequate",
          explanation: "Headline contrast is sharp against light background.",
        },
        typography_hierarchy: {
          rating: "strong",
          explanation: "Strong size differential between H1 and body text.",
        },
        spacing_layout: {
          rating: "strong",
          explanation: "Generous whitespace and aligned columns.",
        },
        mobile_adaptation: {
          rating: "adequate",
          explanation: "Content scales gracefully without horizontal overflow.",
        },
      },
      findings: [
        {
          id: "vis-1",
          dimension: "cta_prominence",
          targetViewport: "mobile",
          visualZone: "above_the_fold",
          title: "Mobile Primary CTA Lacks Visual Isolation",
          severity: "medium",
          observation:
            "On 375px mobile viewport, the primary action button sits closely above secondary links.",
          impact:
            "Reduces visual separation and may slow user action on smaller screens.",
          recommendation:
            "Increase vertical margin around primary CTA on mobile breakpoints.",
          confidence: "high",
          basis: "visual_inference",
        },
      ],
      screenshotIds,
    };

    return {
      ...defaultReview,
      ...this.customReview,
      auditRunId: input.auditRunId,
      viewportsAnalyzed:
        this.customReview?.viewportsAnalyzed ?? defaultReview.viewportsAnalyzed,
      screenshotIds:
        this.customReview?.screenshotIds ?? defaultReview.screenshotIds,
    };
  }
}
