import type {
  ScreenshotCaptureType,
  ScreenshotDeviceType,
  ScreenshotMimeType,
} from "@pagepilot/contracts";
import type { DnsResolver } from "../fetch/resolver.js";

export interface CapturedViewport {
  deviceType: ScreenshotDeviceType;
  captureType: ScreenshotCaptureType;
  mimeType: ScreenshotMimeType;
  width: number;
  height: number;
  buffer: Buffer;
  fileSizeBytes: number;
  capturedAt: string;
  perceptualHash?: string;
  blockHashes?: string[];
}

export interface CaptureScreenshotOptions {
  viewports?: ScreenshotDeviceType[];
  captureType?: ScreenshotCaptureType;
  timeoutMs?: number;
  dnsResolver?: DnsResolver;
  channel?: string;
}

export interface CaptureScreenshotResult {
  url: string;
  captures: CapturedViewport[];
  durationMs: number;
  error?: string;
}

export interface BrowserCaptureProvider {
  capture(
    url: string,
    options?: CaptureScreenshotOptions
  ): Promise<CaptureScreenshotResult>;
}
