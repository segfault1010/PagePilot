// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisLoading } from "../src/features/analysis/components/analysis-loading";

const PHASE_MS = 900;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderLoading() {
  return render(<AnalysisLoading url="https://example.com/page" />);
}

describe("AnalysisLoading", () => {
  it("renders an honest, labelled loading region with the analyzed URL", () => {
    const { container } = renderLoading();
    const section = container.querySelector("section")!;

    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByRole("heading", { level: 1, name: /analyzing website/i }),
    ).toBeTruthy();
    expect(screen.getByText(/https:\/\/example\.com\/page/)).toBeTruthy();
    // No fake percentage or streaming claims anywhere.
    expect(section.textContent).not.toMatch(/%|streaming|generating tokens/i);
  });

  it("starts at phase 1 of 3 and announces it via a polite live region", () => {
    renderLoading();

    expect(screen.getByText(/step 1 of 3/i)).toBeTruthy();
    const live = screen.getByText(/checking url/i);
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("advances through the three phases over time and holds on the last", async () => {
    renderLoading();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHASE_MS);
    });
    expect(screen.getByText(/reading page structure/i)).toBeTruthy();
    expect(screen.getByText(/step 2 of 3/i)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHASE_MS);
    });
    expect(screen.getByText(/preparing ux audit/i)).toBeTruthy();
    expect(screen.getByText(/step 3 of 3/i)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHASE_MS * 10);
    });
    // Holds honestly on the final phase — never implies extra progress.
    expect(screen.getByText(/step 3 of 3/i)).toBeTruthy();
  });

  it("shows three phase dots as visual progress", () => {
    renderLoading();
    expect(
      screen.getByTestId("phase-dots").querySelectorAll("span").length,
    ).toBe(3);
  });

  it("includes the calm supporting line about timing", () => {
    renderLoading();
    expect(
      screen.getByText(/usually takes a few seconds/i),
    ).toBeTruthy();
  });

  it("uses a reduced-motion-safe spinner", () => {
    const { container } = renderLoading();
    // Tailwind variants compile to one token ("motion-safe:animate-spin"),
    // so match by substring rather than a bare .animate-spin selector.
    const spinner = container.querySelector('[class*="animate-spin"]');
    expect(spinner).toBeTruthy();
    expect(spinner?.className).toContain("motion-safe:animate-spin");
  });

  it("receives focus on mount so entry is predictable", () => {
    const { container } = renderLoading();
    const section = container.querySelector("section")!;
    expect(document.activeElement).toBe(section);
  });
});
