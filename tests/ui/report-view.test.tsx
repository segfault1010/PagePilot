// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportView } from "../../src/client/features/analysis/components/report-view";
import { richReport, sparseReport } from "../fixtures/reports";

afterEach(() => {
  cleanup();
});

function renderRich() {
  return render(<ReportView report={richReport} />);
}

function region(name: string): HTMLElement {
  const region = screen.getByRole("region", { name });
  if (!(region instanceof HTMLElement)) throw new Error(`missing ${name}`);
  return region;
}

describe("ReportView — rich real report", () => {
  it("renders the overall score and analyzed page identity", () => {
    renderRich();

    expect(
      screen.getByRole("img", { name: /overall score 66 out of 100/i }),
    ).toBeTruthy();
    expect(screen.getByText("Example Landing Page")).toBeTruthy();
    expect(screen.getByText("https://www.example.com/")).toBeTruthy();
    expect(screen.getByText(/redirected from/i)).toBeTruthy();
    expect(screen.getAllByText(/mixed/i).length).toBeGreaterThan(0);
    expect(screen.getByText(richReport.summary)).toBeTruthy();
  });

  it("explains blended confidence in plain language", () => {
    renderRich();

    expect(
      screen.getByText(
        /combines AI assessment with deterministic page signals/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/blended scoring/i)).toBeTruthy();
  });

  it("shows exactly three ranked top problems with category, severity, evidence, basis, and fix", () => {
    renderRich();
    const problems = region("Top problems");

    const cards = within(problems).getAllByRole("article");
    expect(cards.length).toBe(3);

    expect(
      within(problems).getByText("Primary CTA is buried below the fold"),
    ).toBeTruthy();
    expect(within(problems).getAllByText(/severity$/i).length).toBe(3);
    // Category is surfaced per problem.
    expect(within(problems).getByText("CTA effectiveness")).toBeTruthy();
    // Observed vs inferred basis is disclosed.
    expect(within(problems).getAllByText(/observed on the page/i)).toBeTruthy();
    expect(
      within(problems).getByText(/AI-inferred from evidence/i),
    ).toBeTruthy();
    // Each problem carries a separated recommendation.
    expect(within(problems).getByText(/move the primary call to action/i))
      .toBeTruthy();
  });

  it("renders exactly seven category scores in a responsive grid", () => {
    const { container } = renderRich();
    const categories = region("Category scores");

    const cards = within(categories).getAllByRole("article");
    expect(cards.length).toBe(7);
    expect(
      within(categories).getByLabelText("Clarity score 78 out of 100"),
    ).toBeTruthy();
    expect(
      within(categories).getByLabelText("Accessibility score 49 out of 100"),
    ).toBeTruthy();

    // Mobile-first single column, widening at larger breakpoints.
    const grid = container.querySelector('[aria-labelledby="categories-heading"] div.grid');
    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(grid?.className).toContain("xl:grid-cols-3");
  });

  it("flags ai-led categories as limited-signal rather than hiding confidence", () => {
    renderRich();
    const categories = region("Category scores");

    expect(
      within(categories).getAllByText(/limited page signals/i).length,
    ).toBeGreaterThan(0);
  });

  it("lists quick wins as a compact numbered set distinct from detailed recommendations", () => {
    renderRich();
    const quickWins = region("Quick wins");
    const detailed = region("Detailed recommendations");

    expect(within(quickWins).getAllByRole("listitem").length).toBe(4);
    expect(within(quickWins).getByText("Add alt text to key images"))
      .toBeTruthy();

    expect(within(detailed).getAllByRole("listitem").length).toBe(2);
    expect(
      within(detailed).getByText(/rebuild the hero around a single action/i),
    ).toBeTruthy();
  });

  it("discloses observed signals plus methodology limitations", () => {
    renderRich();
    const methodology = region("Methodology & observed signals");

    expect(
      within(methodology).getByText(
        /directly detected from the page's html structure/i,
      ),
    ).toBeTruthy();
    expect(within(methodology).getByText(/ai interpretation based on/i))
      .toBeTruthy();
    expect(within(methodology).getByText(/core web vitals/i)).toBeTruthy();
    expect(within(methodology).getByText(/conversion rate/i)).toBeTruthy();
    expect(
      within(methodology).getByText(/view all 6 observed signals/i),
    ).toBeTruthy();
    expect(
      within(methodology).getByText(/no forms found; conversion paths other/i),
    ).toBeTruthy();
  });

  it("keeps an accessible heading hierarchy (h2 sections, h3 cards, h4 findings)", () => {
    renderRich();

    for (const name of [
      "Top problems",
      "Category scores",
      "Quick wins",
      "Detailed recommendations",
      "Methodology & observed signals",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeTruthy();
    }
    expect(
      screen.queryByRole("heading", { level: 1 }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { level: 3, name: "Primary CTA is buried below the fold" }),
    ).toBeTruthy();
    const categories = region("Category scores");
    const findingHeading = within(categories).queryAllByRole("heading", { level: 4 });
    expect(findingHeading.length).toBeGreaterThan(0);
  });
});

describe("ReportView — sparse report with unknown/empty states", () => {
  function renderSparse() {
    return render(<ReportView report={sparseReport} />);
  }

  it("labels ai-led confidence and explains the reliance on AI", () => {
    renderSparse();

    expect(screen.getByText(/AI-led/i)).toBeTruthy();
    expect(
      screen.getByText(
        /limited measurable page signals were available.*relies more heavily on AI assessment/i,
      ),
    ).toBeTruthy();
  });

  it("renders an intentional verdict and handles a missing page title", () => {
    renderSparse();

    expect(screen.getAllByText(/at risk/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/untitled page/i)).toBeTruthy();
  });

  it("marks unknown signals as not measured instead of implying failure", () => {
    renderSparse();
    const methodology = region("Methodology & observed signals");

    expect(
      within(methodology).getAllByText(/not measured/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      within(methodology).getByText(/never reduce a score/i),
    ).toBeTruthy();
    expect(
      within(methodology).getByText(/view all 1 observed signal$/i),
    ).toBeTruthy();
  });

  it("shows the intentional empty state for categories without findings", () => {
    renderSparse();
    const categories = region("Category scores");

    expect(
      within(categories).getAllByText(
        /no significant issues detected from the available evidence/i,
      ).length,
    ).toBe(7);
    expect(within(categories).getAllByText(/no findings/i).length).toBe(7);
  });
});
