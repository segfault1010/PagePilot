import { describe, expect, it } from "vitest";
import {
  checkSignalReferences,
  geminiResponseJsonSchema,
  parseGeminiAuditOutput,
} from "../src/schemas/audit.js";
import { validWireAudit } from "./fixtures/gemini-audit.js";

type Wire = Record<string, unknown>;

function wireWith(...mutations: ((audit: Wire) => void)[]): Wire {
  const audit = structuredClone(validWireAudit());
  for (const mutate of mutations) mutate(audit);
  return audit;
}

function setCategories(audit: Wire, categories: unknown[]): void {
  audit.categories = categories;
}

describe("parseGeminiAuditOutput — accepted output", () => {
  it("accepts a fully valid wire audit and groups findings under categories", () => {
    const result = parseGeminiAuditOutput(validWireAudit());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.audit.categories).toHaveLength(7);
    const clarity = result.audit.categories.find((c) => c.key === "clarity")!;
    expect(clarity.findings).toHaveLength(1);
    expect(clarity.findings[0]!.title).toBe("clarity finding title");
    // The grouped form carries no wire-only keys.
    expect(clarity.findings[0]).not.toHaveProperty("categoryKey");
  });

  it("accepts zero findings overall", () => {
    const result = parseGeminiAuditOutput(wireWith((a) => void (a.findings = [])));
    expect(result.ok).toBe(true);
  });

  it("rejects unknown top-level properties", () => {
    expect(parseGeminiAuditOutput({ ...validWireAudit(), extra: 1 }).ok).toBe(false);
  });
});

describe("parseGeminiAuditOutput — structural rejections", () => {
  it("rejects malformed JSON shapes (arrays, primitives)", () => {
    expect(parseGeminiAuditOutput([validWireAudit()]).ok).toBe(false);
    expect(parseGeminiAuditOutput("json").ok).toBe(false);
    expect(parseGeminiAuditOutput(null).ok).toBe(false);
  });

  it("rejects a missing category", () => {
    const result = parseGeminiAuditOutput(
      wireWith((a) => setCategories(a, (a.categories as unknown[]).slice(1))),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate categories", () => {
    const result = parseGeminiAuditOutput(
      wireWith((a) => {
        const categories = [...(a.categories as Record<string, unknown>[])];
        categories[1] = { ...categories[0]! };
        setCategories(a, categories);
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects unknown category keys in categories and findings", () => {
    expect(
      parseGeminiAuditOutput(
        wireWith((a) => {
          // @ts-expect-error deliberately invalid model output
          a.categories[0].key = "performance";
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseGeminiAuditOutput(
        wireWith((a) => {
          // @ts-expect-error deliberately invalid model output
          a.findings[0].categoryKey = "speed";
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects out-of-range and non-integer scores", () => {
    for (const score of [-1, 101, 70.5]) {
      expect(
        parseGeminiAuditOutput(
          wireWith((a) => {
            // @ts-expect-error deliberately invalid model output
            a.categories[0].score = score;
          }),
        ).ok,
      ).toBe(false);
    }
  });

  it("rejects unsupported severity values", () => {
    expect(
      parseGeminiAuditOutput(
        wireWith((a) => {
          // @ts-expect-error deliberately invalid model output
          a.categories[0].severity = "critical";
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects unsupported basis values", () => {
    expect(
      parseGeminiAuditOutput(
        wireWith((a) => {
          // @ts-expect-error deliberately invalid model output
          a.findings[0].basis = "measured";
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects more than three findings grouped into one category", () => {
    const result = parseGeminiAuditOutput(
      wireWith((a) => {
        const base = (a.findings as Record<string, unknown>[])[0]!;
        a.findings = [
          base,
          { ...base, title: "Second clarity finding title" },
          { ...base, title: "Third clarity finding title" },
          { ...base, title: "Fourth clarity finding title" },
        ];
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects more than twenty-one total findings", () => {
    const result = parseGeminiAuditOutput(
      wireWith((a) => {
        const base = (a.findings as Record<string, unknown>[])[0]!;
        const flood = Array.from({ length: 22 }, (_, i) => ({
          ...base,
          title: `Finding number ${i} with a distinct title`,
        }));
        a.findings = flood;
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects wrong quickWins counts", () => {
    expect(parseGeminiAuditOutput(wireWith((a) => void (a.quickWins as unknown[]).pop())).ok).toBe(
      false,
    );
    expect(
      parseGeminiAuditOutput(
        wireWith((a) => {
          const wins = a.quickWins as Record<string, unknown>[];
          wins.push({ ...wins[0]!, title: "One more quick win" });
          wins.push({ ...wins[1]!, title: "Yet another quick win" });
          wins.push({ ...wins[2]!, title: "And a final quick win" });
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects wrong topProblems counts", () => {
    expect(
      parseGeminiAuditOutput(wireWith((a) => void (a.topProblems as unknown[]).pop())).ok,
    ).toBe(false);
    expect(
      parseGeminiAuditOutput(
        wireWith((a) =>
          (a.topProblems as Record<string, unknown>[]).push({
            ...(a.topProblems as Record<string, unknown>[])[0]!,
            title: "Another distinct problem title",
          }),
        ),
      ).ok,
    ).toBe(false);
  });
});

describe("parseGeminiAuditOutput — string bounds", () => {
  it("rejects excessive strings", () => {
    expect(
      parseGeminiAuditOutput(wireWith((a) => void (a.summary = "x".repeat(1300)))).ok,
    ).toBe(false);
    expect(
      parseGeminiAuditOutput(
        wireWith((a) =>
          void ((a.topProblems as Record<string, unknown>[])[0]!.evidence = "y".repeat(700)),
        ),
      ).ok,
    ).toBe(false);
  });

  it("rejects empty or too-short required strings", () => {
    expect(parseGeminiAuditOutput(wireWith((a) => void (a.summary = "short"))).ok).toBe(false);
  });
});

describe("checkSignalReferences", () => {
  const allowed = new Set(["cta.candidates", "meta.description.present"]);

  it("accepts valid signal IDs", () => {
    const result = parseGeminiAuditOutput(validWireAudit());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkSignalReferences(result.audit, allowed)).toEqual({
      ok: true,
      invalidIds: [],
    });
  });

  it("flags an unknown signal ID", () => {
    const parsed = parseGeminiAuditOutput(validWireAudit());
    if (!parsed.ok) throw new Error("fixture must parse");
    const audit = parsed.audit;
    audit.topProblems[0]!.signalIds = ["made.up.signal"];
    const result = checkSignalReferences(audit, allowed);
    expect(result.ok).toBe(false);
    expect(result.invalidIds).toEqual(["made.up.signal"]);
  });

  it("flags a signal ID from the wrong analysis", () => {
    const parsed = parseGeminiAuditOutput(validWireAudit());
    if (!parsed.ok) throw new Error("fixture must parse");
    const audit = parsed.audit;
    audit.categories.find((c) => c.key === "copy")!.findings[0]!.signalIds = [
      "headings.duplicates",
    ];
    const result = checkSignalReferences(audit, allowed);
    expect(result.ok).toBe(false);
    expect(result.invalidIds).toEqual(["headings.duplicates"]);
  });
});

describe("geminiResponseJsonSchema", () => {
  it("uses the flat wire layout Gemini can generate", () => {
    const serialized = JSON.stringify(geminiResponseJsonSchema());
    // Flat findings list present…
    expect(serialized).toContain('"categoryKey"');
    // …and no object-in-array nesting inside category entries.
    const json = geminiResponseJsonSchema() as {
      properties?: Record<string, { items?: { properties?: Record<string, unknown> } }>;
    };
    const categoryItems = json.properties?.categories?.items?.properties ?? {};
    expect(categoryItems).not.toHaveProperty("findings");
    expect(Object.keys(categoryItems).sort()).toEqual([
      "explanation",
      "key",
      "score",
      "severity",
    ]);
  });

  it("keeps enums and strips unsupported generation-time constraints", () => {
    const serialized = JSON.stringify(geminiResponseJsonSchema());
    // Gemini rejects string-length keywords AND larger maxItems values on
    // object arrays; cardinality is enforced by Zod after parsing instead.
    expect(serialized).not.toContain('"minLength"');
    expect(serialized).not.toContain('"maxLength"');
    expect(serialized).not.toContain('"minItems"');
    expect(serialized).not.toContain('"maxItems"');
    expect(serialized).toContain('"clarity"');
    expect(serialized).toContain('"trustCredibility"');
    expect(serialized).toContain('"observed"');
    expect(serialized).toContain('"inferred"');
  });
});
