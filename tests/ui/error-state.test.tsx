// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "@pagepilot/contracts";
import { ErrorState } from "../../src/client/features/analysis/components/error-state";

const noop = () => {};

function renderError(code: string, message = "Sanitized server message.") {
  return render(
    <ErrorState
      error={{ code, message, retryable: true }}
      url="https://example.com/"
      onRetry={noop}
      onEditUrl={noop}
    />,
  );
}

afterEach(() => {
  cleanup();
});

/**
 * Every defined API error category maps to product copy that explains what
 * happened and suggests a next step — never internal details.
 */
const COPY_CASES: Array<[string, RegExp, RegExp]> = [
  ["NETWORK_ERROR", /connection problem/i, /check your connection/i],
  [API_ERROR_CODES.invalidUrl, /that url can't be analyzed/i, /check the address/i],
  [
    API_ERROR_CODES.blockedDestination,
    /destination isn't publicly accessible|isn't reachable/i,
    /publicly accessible url/i,
  ],
  [API_ERROR_CODES.pageTooLarge, /too large/i, /lighter landing page/i],
  [API_ERROR_CODES.requestTooLarge, /request too large/i, /try again/i],
  [API_ERROR_CODES.nonHtmlResponse, /isn't an html page/i, /html page instead/i],
  [API_ERROR_CODES.rateLimited, /too many requests/i, /wait a few minutes/i],
  [API_ERROR_CODES.upstreamFailure, /analysis engine unavailable/i, /try again in a moment/i],
  [API_ERROR_CODES.timeout, /timed out/i, /another try/i],
  [
    API_ERROR_CODES.missingConfiguration,
    /temporarily unavailable/i,
    /try again later/i,
  ],
];

describe("ErrorState copy mapping", () => {
  it.each(COPY_CASES)("maps %s to user-facing title and next-step copy", (code, title, hint) => {
    renderError(code);

    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    // Hint copy lives inside the alert region, distinct from the buttons.
    expect(
      within(screen.getByRole("alert")).getByText(hint),
    ).toBeTruthy();
  });

  it("falls back to safe generic copy for unknown codes", () => {
    renderError("SOMETHING_UNEXPECTED");

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeTruthy();
    expect(screen.getAllByText(/try again/i).length).toBeGreaterThan(0);
  });
});

describe("ErrorState structure", () => {
  it("announces the failure via an alert region containing the heading", () => {
    renderError(API_ERROR_CODES.blockedDestination);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/destination isn't reachable/i);
    const failureHeading = screen.getByRole("heading", {
      level: 2,
      name: /this destination isn't reachable/i,
    });
    expect(alert.contains(failureHeading)).toBe(true);
  });

  it("moves focus to Try again on mount for immediate recovery", () => {
    renderError(API_ERROR_CODES.upstreamFailure);
    expect(document.activeElement?.textContent).toMatch(/try again/i);
  });

  it("offers exactly two recovery actions with Try again as primary", () => {
    renderError(API_ERROR_CODES.timeout);

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.textContent).toMatch(/try again/i);
    expect(buttons[1]!.textContent).toMatch(/edit url/i);
  });

  it("preserves the analyzed URL for retry context", () => {
    renderError(API_ERROR_CODES.nonHtmlResponse);
    expect(screen.getByText(/https:\/\/example\.com\//)).toBeTruthy();
  });

  it("shows the sanitized server message as a footnote without exposing internals", () => {
    renderError(API_ERROR_CODES.invalidUrl);
    expect(screen.getByText(/sanitized server message/i)).toBeTruthy();
    // No stack-trace-like or provider detail in the rendered output.
    expect(document.body.textContent).not.toMatch(/stack|gemini|dns|rfc1918/i);
  });
});
