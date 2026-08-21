// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/client/App";

beforeEach(() => {
  vi.useFakeTimers();
  window.scrollTo = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// React flushes passive effects at act() end, so each loading-phase timer
// must be reached in a separate stepped advance.
function finishAnalysis() {
  for (const ms of [950, 950, 1300]) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }
}

function submitUrl(value: string) {
  fireEvent.change(screen.getByLabelText(/website url/i), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: /analyze website/i }));
}

describe("App landing states", () => {
  it("renders the landing hero and URL form", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /find what's hurting your landing page/i,
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/website url/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /analyze website/i }),
    ).toBeTruthy();
    expect(screen.getByText(/example report/i)).toBeTruthy();
    expect(screen.getByText(/sample data/i)).toBeTruthy();
  });

  it("shows inline validation for malformed URLs", () => {
    render(<App />);
    submitUrl("not a url");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/valid url/i);
    expect(
      screen.getByLabelText(/website url/i).getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("walks the loading phases into the sample report", () => {
    render(<App />);
    submitUrl("https://example.com");

    expect(screen.getByText(/checking url/i)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(950);
    });
    expect(screen.getByText(/reading page structure/i)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(950);
    });
    expect(screen.getByText(/preparing ux audit/i)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(screen.getByText(/quick wins/i)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /overall score 70 out of 100/i }),
    ).toBeTruthy();
    expect(screen.getByText(/preview report with sample data/i)).toBeTruthy();
  });

  it("returns to the landing page from the report", () => {
    render(<App />);
    submitUrl("https://example.com");
    finishAnalysis();

    fireEvent.click(
      screen.getByRole("button", { name: /analyze another website/i }),
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /find what's hurting your landing page/i,
      }),
    ).toBeTruthy();
  });

  it("shows the failure state with the URL preserved and recovers via retry", () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: /preview the error state/i }),
    );

    expect(screen.getByRole("alert").textContent).toMatch(
      /analysis engine unavailable/i,
    );
    expect(screen.getByText(/https:\/\/example\.com/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText(/checking url/i)).toBeTruthy();

    finishAnalysis();
    expect(screen.getByText(/quick wins/i)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /analyze another website/i }),
    );
    const input = screen.getByLabelText(/website url/i) as HTMLInputElement;
    expect(input.value).toBe("https://example.com");
  });
});
