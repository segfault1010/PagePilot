// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { MIN_ANALYSIS_MS } from "../../src/client/App";
import { analyzeUrl } from "../../src/client/features/analysis/api";
import type { AnalyzeResult } from "../../src/client/features/analysis/api";
import { sampleReport as report } from "../../src/shared/sample-report";

vi.mock("../../src/client/features/analysis/api", () => ({
  analyzeUrl: vi.fn(),
  NETWORK_ERROR_CODE: "NETWORK_ERROR",
}));

const mockedAnalyzeUrl = vi.mocked(analyzeUrl);

beforeEach(() => {
  vi.useFakeTimers();
  window.scrollTo = () => {};
  mockedAnalyzeUrl.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function submitUrl(value: string) {
  fireEvent.change(screen.getByLabelText(/website url/i), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: /analyze website/i }));
}

/**
 * Drives the request lifecycle past its minimum loading hold so the
 * mocked response is allowed to transition the view.
 */
async function flushApi() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MIN_ANALYSIS_MS);
  });
}

function successResult(): AnalyzeResult {
  return { ok: true, report };
}

function failureResult(): AnalyzeResult {
  return {
    ok: false,
    error: {
      code: "UPSTREAM_FAILURE",
      message: "The audit engine could not be reached.",
      retryable: true,
    },
  };
}

describe("App landing states", () => {
  it("renders the landing hero and URL form without the demo failure hook", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /find what's hurting your landing page/i,
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/website url/i)).toBeTruthy();
    expect(screen.getByText(/example report/i)).toBeTruthy();
    expect(screen.getByText(/sample data/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /preview the error state/i }),
    ).toBeNull();
  });

  it("shows inline validation for malformed URLs without calling the API", () => {
    render(<App />);
    submitUrl("not a url");

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/valid url/i);
    expect(
      screen.getByLabelText(/website url/i).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(mockedAnalyzeUrl).not.toHaveBeenCalled();
  });

  it("goes loading → API → report on success", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce(successResult());
    render(<App />);
    submitUrl("https://example.com");

    expect(screen.getByText(/checking url/i)).toBeTruthy();

    await flushApi();

    expect(mockedAnalyzeUrl).toHaveBeenCalledTimes(1);
    expect(mockedAnalyzeUrl).toHaveBeenCalledWith("https://example.com/");
    expect(screen.getByText(/quick wins/i)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /overall score 70 out of 100/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/preview build/i)).toBeNull();
    expect(screen.getByText(report.summary)).toBeTruthy();
  });

  it("keeps the loading view stable through the minimum hold (no flash)", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce(successResult());
    render(<App />);
    submitUrl("https://example.com");

    // Response resolves instantly, but the loading state must still hold
    // briefly instead of flashing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/checking url/i)).toBeTruthy();
    expect(screen.queryByText(/quick wins/i)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIN_ANALYSIS_MS - 1);
    });
    expect(screen.getByText(/checking url/i)).toBeTruthy();

    await flushApi();
    expect(screen.getByText(/quick wins/i)).toBeTruthy();
  });

  it("announces completion politely when the report is ready", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce(successResult());
    render(<App />);
    submitUrl("https://example.com");
    await flushApi();

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/report is ready/i);
  });

  it("goes loading → API → failure with the URL preserved", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce(failureResult());
    render(<App />);
    submitUrl("https://example.com");

    await flushApi();

    expect(screen.getByText(/analysis engine unavailable/i)).toBeTruthy();
    expect(screen.getByText(/https:\/\/example\.com/)).toBeTruthy();
    expect(screen.getByText(/audit engine could not be reached/i)).toBeTruthy();
    // No stale loading artifacts remain.
    expect(screen.queryByText(/checking url/i)).toBeNull();
    expect(screen.queryByLabelText(/analyzing website/i)).toBeNull();
  });

  it("moves focus to the primary recovery action after a failure", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce(failureResult());
    render(<App />);
    submitUrl("https://example.com");
    await flushApi();

    const active = document.activeElement;
    expect(active?.textContent).toMatch(/try again/i);
  });

  it("maps network failures to connection copy", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: "Couldn't reach the analysis service.",
        retryable: true,
      },
    });
    render(<App />);
    submitUrl("https://example.com");

    await flushApi();

    expect(screen.getByText(/connection problem/i)).toBeTruthy();
  });

  it("retries after a failure with exactly one new request", async () => {
    mockedAnalyzeUrl
      .mockResolvedValueOnce(failureResult())
      .mockResolvedValueOnce(successResult());
    render(<App />);
    submitUrl("https://example.com");
    await flushApi();
    expect(mockedAnalyzeUrl).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText(/checking url/i)).toBeTruthy();
    expect(mockedAnalyzeUrl).toHaveBeenCalledTimes(2);

    await flushApi();
    expect(mockedAnalyzeUrl).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/quick wins/i)).toBeTruthy();
  });

  it("returns to the landing page via Edit URL, preserving the URL and focusing it", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce(failureResult());
    render(<App />);
    submitUrl("https://example.com");
    await flushApi();

    fireEvent.click(screen.getByRole("button", { name: /edit url/i }));
    const input = screen.getByLabelText(/website url/i) as HTMLInputElement;
    expect(input.value).toBe("https://example.com/");
    expect(document.activeElement).toBe(input);
  });

  it("returns to the landing page from the report", async () => {
    mockedAnalyzeUrl.mockResolvedValueOnce(successResult());
    render(<App />);
    submitUrl("https://example.com");
    await flushApi();

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
});
