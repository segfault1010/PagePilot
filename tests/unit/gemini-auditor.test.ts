import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiError,
  DEFAULT_GEMINI_MODEL,
  createGeminiAuditor,
} from "../../src/server/ai/gemini-auditor";
import { minimalModelInput, validWireAudit } from "../fixtures/gemini-audit";

function geminiEnvelope(text: unknown): Record<string, unknown> {
  return {
    candidates: [
      {
        content: { parts: [{ text: typeof text === "string" ? text : JSON.stringify(text) }] },
        finishReason: "STOP",
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function auditorOver(fetchImpl: typeof fetch, apiKey = "test-key") {
  return createGeminiAuditor({ apiKey, model: "gemini-test", fetchFn: fetchImpl });
}

async function expectAiError(
  promise: Promise<unknown>,
  kind: AiError["kind"],
): Promise<AiError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AiError);
  const aiError = caught as AiError;
  expect(aiError.kind).toBe(kind);
  // Failure objects never carry provider payloads.
  expect(aiError.message).not.toMatch(/sk-|AIza/);
  return aiError;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createGeminiAuditor", () => {
  it("fails closed with a configuration error and no network call when the key is missing", async () => {
    const fetchFn = vi.fn();
    const auditor = createGeminiAuditor({ apiKey: "", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(auditor.runAudit(minimalModelInput())).rejects.toBeInstanceOf(AiError);
    await expectAiError(auditor.runAudit(minimalModelInput()), "configuration");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends structured-output generation config and bounded evidence", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geminiEnvelope(validWireAudit())));
    const auditor = auditorOver(fetchFn as unknown as typeof fetch);

    const result = await auditor.runAudit(minimalModelInput());
    expect(result.summary).toBeTruthy();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-test:generateContent");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");

    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toBeTruthy();
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(0);
    // Rules travel in the user message (systemInstruction is rejected by the
    // API when structured output is enabled).
    expect(body.systemInstruction).toBeUndefined();
    const userText = body.contents[0].parts[0].text as string;
    expect(userText).toContain("ONLY the evidence provided");
    expect(userText).toContain('"deterministicSignals"');
    expect(userText).toContain("cta.candidates");
    // No raw HTML ever enters the request.
    expect(userText).not.toContain("<html");
    expect(userText).not.toContain("<script");
  });

  it("maps HTTP failures without leaking response bodies", async () => {
    await expectAiError(
      auditorOver(() => Promise.resolve(jsonResponse({ error: "boom detail" }, 500)))
        .runAudit(minimalModelInput()),
      "unavailable",
    );
    await expectAiError(
      auditorOver(() => Promise.resolve(jsonResponse({}, 429)))
        .runAudit(minimalModelInput()),
      "unavailable",
    );
    await expectAiError(
      auditorOver(() => Promise.resolve(jsonResponse({}, 403)))
        .runAudit(minimalModelInput()),
      "configuration",
    );
  });

  it("maps transport errors to unavailable and aborts to timeout", async () => {
    await expectAiError(
      auditorOver(() => Promise.reject(new TypeError("fetch failed")))
        .runAudit(minimalModelInput()),
      "unavailable",
    );

    const abortError = Object.assign(new Error("This operation was aborted"), {
      name: "AbortError",
    });
    const timeout = await expectAiError(
      auditorOver(() => Promise.reject(abortError)).runAudit(minimalModelInput()),
      "timeout",
    );
    expect(timeout.detail).toMatch(/ms$/);
  });

  it("enforces its own deadline via AbortSignal", async () => {
    const fetchFn = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    const auditor = createGeminiAuditor({
      apiKey: "k",
      fetchFn: fetchFn as unknown as typeof fetch,
      timeoutMs: 25,
    });
    await expectAiError(auditor.runAudit(minimalModelInput()), "timeout");
  });

  it("rejects malformed model JSON as invalid-response", async () => {
    const auditor = auditorOver(() =>
      Promise.resolve(jsonResponse(geminiEnvelope("{not json at all"))),
    );
    await expectAiError(auditor.runAudit(minimalModelInput()), "invalid-response");
  });

  it("rejects schema-invalid payloads as invalid-response", async () => {
    const broken = validWireAudit() as unknown as Record<string, unknown>;
    delete broken.categories;
    const auditor = auditorOver(() => Promise.resolve(jsonResponse(geminiEnvelope(broken))));
    await expectAiError(auditor.runAudit(minimalModelInput()), "invalid-response");
  });

  it("treats truncation, blocking, and empty completions as safe failures", async () => {
    const truncated = {
      candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "MAX_TOKENS" }],
    };
    await expectAiError(
      auditorOver(() => Promise.resolve(jsonResponse(truncated)))
        .runAudit(minimalModelInput()),
      "invalid-response",
    );

    const blocked = { promptFeedback: { blockReason: "SAFETY" } };
    await expectAiError(
      auditorOver(() => Promise.resolve(jsonResponse(blocked)))
        .runAudit(minimalModelInput()),
      "unavailable",
    );

    await expectAiError(
      auditorOver(() => Promise.resolve(jsonResponse({ candidates: [] })))
        .runAudit(minimalModelInput()),
      "invalid-response",
    );
  });

  it("reads credentials and model only from server environment", async () => {
    vi.stubEnv("GEMINI_API_KEY", "env-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-env-model");
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geminiEnvelope(validWireAudit())));
    const auditor = createGeminiAuditor({ fetchFn: fetchFn as unknown as typeof fetch });
    await auditor.runAudit(minimalModelInput());

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/models/gemini-env-model:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("env-key");
    expect(DEFAULT_GEMINI_MODEL).toMatch(/^gemini-/);
  });

  it("falls back to the default model when no override exists", async () => {
    vi.stubEnv("GEMINI_API_KEY", "env-key");
    vi.stubEnv("GEMINI_MODEL", "");
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(geminiEnvelope(validWireAudit())));
    const auditor = createGeminiAuditor({ fetchFn: fetchFn as unknown as typeof fetch });
    await auditor.runAudit(minimalModelInput());
    expect(String(fetchFn.mock.calls[0][0])).toContain(`/${DEFAULT_GEMINI_MODEL}:`);
  });
});

