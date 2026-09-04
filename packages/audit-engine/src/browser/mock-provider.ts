import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  MAX_CAPTURE_HEIGHT,
} from "@pagepilot/contracts";
import type {
  ScreenshotCaptureType,
  ScreenshotDeviceType,
  ScreenshotMimeType,
} from "@pagepilot/contracts";
import type {
  BrowserCaptureProvider,
  CaptureScreenshotOptions,
  CaptureScreenshotResult,
  CapturedViewport,
} from "./browser-types.js";
import { validateTargetUrl } from "./browser-security.js";
import { generateSyntheticBlockHashes } from "../visual-diff/perceptual-hasher.js";

// Tiny valid 1x1 transparent PNG buffer
const MOCK_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Tiny valid 1x1 VP8 WebP buffer (RIFF....WEBPVP8 ...)
const MOCK_WEBP_BUFFER = Buffer.from(
  "UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAA/v6n/4kAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "base64"
);

export interface MockBrowserCaptureProviderOptions {
  simulateFailure?: boolean;
  failureMessage?: string;
  delayMs?: number;
  mimeType?: ScreenshotMimeType;
}

export class MockBrowserCaptureProvider implements BrowserCaptureProvider {
  private simulateFailure: boolean;
  private failureMessage: string;
  private delayMs: number;
  private mimeType: ScreenshotMimeType;

  constructor(options: MockBrowserCaptureProviderOptions = {}) {
    this.simulateFailure = options.simulateFailure ?? false;
    this.failureMessage =
      options.failureMessage ?? "Simulated browser capture failure";
    this.delayMs = options.delayMs ?? 0;
    this.mimeType = options.mimeType ?? "image/webp";
  }

  setSimulateFailure(fail: boolean, message?: string) {
    this.simulateFailure = fail;
    if (message) this.failureMessage = message;
  }

  async capture(
    url: string,
    options: CaptureScreenshotOptions = {}
  ): Promise<CaptureScreenshotResult> {
    const startTime = Date.now();

    // Enforce URL security before capturing
    const validation = await validateTargetUrl(url, options.dnsResolver);
    if (!validation.valid) {
      throw new Error(`Security policy rejected URL: ${validation.error}`);
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.simulateFailure) {
      throw new Error(this.failureMessage);
    }

    const requestedViewports: ScreenshotDeviceType[] =
      options.viewports && options.viewports.length > 0
        ? options.viewports
        : ["desktop", "mobile"];

    const captureType: ScreenshotCaptureType =
      options.captureType ?? "viewport";

    const buffer =
      this.mimeType === "image/png" ? MOCK_PNG_BUFFER : MOCK_WEBP_BUFFER;

    const captures: CapturedViewport[] = requestedViewports.map((deviceType) => {
      const dimensions =
        deviceType === "desktop" ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT;

      let height: number = dimensions.height;
      if (captureType === "full_page") {
        // Capped at MAX_CAPTURE_HEIGHT (4000px)
        height = Math.min(2400, MAX_CAPTURE_HEIGHT);
      }

      const { perceptualHash, blockHashes } = generateSyntheticBlockHashes({
        seed: `${deviceType}-${captureType}`,
      });

      return {
        deviceType,
        captureType,
        mimeType: this.mimeType,
        width: dimensions.width,
        height,
        buffer,
        fileSizeBytes: buffer.length,
        capturedAt: new Date().toISOString(),
        perceptualHash,
        blockHashes,
      };
    });

    return {
      url: validation.normalizedUrl ?? url,
      captures,
      durationMs: Date.now() - startTime,
    };
  }
}
