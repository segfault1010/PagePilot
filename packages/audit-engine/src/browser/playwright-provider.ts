import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  MAX_CAPTURE_HEIGHT,
  MAX_SCREENSHOT_BYTES,
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
import {
  createBrowserSsrfGuard,
  validateTargetUrl,
} from "./browser-security.js";
import { computeHashesFromLuminanceGrid } from "../visual-diff/perceptual-hasher.js";

const DEFAULT_TIMEOUT_MS = 15_000;

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

export class PlaywrightBrowserCaptureProvider implements BrowserCaptureProvider {
  async capture(
    url: string,
    options: CaptureScreenshotOptions = {}
  ): Promise<CaptureScreenshotResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // 1. Validate target URL and resolve DNS before launching browser
    const validation = await validateTargetUrl(url, options.dnsResolver);
    if (!validation.valid) {
      throw new Error(`Security policy rejected URL: ${validation.error}`);
    }

    const targetUrl = validation.normalizedUrl ?? url;
    const requestedViewports: ScreenshotDeviceType[] =
      options.viewports && options.viewports.length > 0
        ? options.viewports
        : ["desktop", "mobile"];

    const captureType: ScreenshotCaptureType =
      options.captureType ?? "viewport";

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      // 2. Launch hardened headless Chromium (with graceful installed Chrome/Edge fallback)
      const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-gpu",
        "--disable-features=IsolateOrigins,site-per-process",
      ];

      const requestedChannel =
        options.channel ?? process.env.PLAYWRIGHT_CHROMIUM_CHANNEL;

      if (requestedChannel) {
        browser = await chromium.launch({
          headless: true,
          channel: requestedChannel,
          args: launchArgs,
        });
      } else {
        try {
          browser = await chromium.launch({
            headless: true,
            args: launchArgs,
          });
        } catch (launchErr: any) {
          const errMsg = launchErr?.message || "";
          if (
            errMsg.includes("Executable doesn't exist") ||
            errMsg.includes("playwright install")
          ) {
            try {
              browser = await chromium.launch({
                headless: true,
                channel: "chrome",
                args: launchArgs,
              });
            } catch {
              browser = await chromium.launch({
                headless: true,
                channel: "msedge",
                args: launchArgs,
              });
            }
          } else {
            throw launchErr;
          }
        }
      }

      // 3. Create disposable browser context
      context = await browser.newContext({
        viewport: DESKTOP_VIEWPORT,
        ignoreHTTPSErrors: false,
        bypassCSP: false,
      });

      const captures: CapturedViewport[] = [];

      // 4. Capture each requested viewport in isolation
      for (const deviceType of requestedViewports) {
        const page = await context.newPage();

        try {
          // Auto-dismiss unexpected popups and dialogs
          page.on("popup", (popup: Page) => {
            popup.close().catch(() => {});
          });
          page.on("dialog", (dialog) => {
            dialog.dismiss().catch(() => {});
          });

          // Attach strict SSRF request interceptor
          const ssrfGuard = createBrowserSsrfGuard({
            dnsResolver: options.dnsResolver,
          });
          await page.route("**/*", ssrfGuard);

          const viewport =
            deviceType === "desktop" ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT;

          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });

          if (deviceType === "mobile") {
            await page.setExtraHTTPHeaders({
              "User-Agent": MOBILE_USER_AGENT,
            });
          }

          // Navigate safely
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: timeoutMs,
          });

          // Wait a short moment for fonts & styles to settle
          await page.waitForTimeout(500);

          let width: number = viewport.width;
          let height: number = viewport.height;
          let clipOption:
            | { x: number; y: number; width: number; height: number }
            | undefined;

          if (captureType === "full_page") {
            const scrollHeight = await page
              .evaluate(() => {
                const doc = (globalThis as unknown as { document?: { documentElement?: { scrollHeight?: number }; body?: { scrollHeight?: number } } }).document;
                return (
                  doc?.documentElement?.scrollHeight ||
                  doc?.body?.scrollHeight ||
                  800
                );
              })
              .catch(() => viewport.height);

            // Bounded by MAX_CAPTURE_HEIGHT (4000px)
            height = Math.min(Math.max(scrollHeight, viewport.height), MAX_CAPTURE_HEIGHT);
            clipOption = {
              x: 0,
              y: 0,
              width: viewport.width,
              height,
            };
          }

          // 5. Capture image using native WebP via CDP if possible, falling back to JPEG/PNG
          let buffer: Buffer;
          let mimeType: ScreenshotMimeType = "image/webp";
          let base64Payload: string;

          try {
            const cdp = await context.newCDPSession(page);
            const cdpResult = await cdp.send("Page.captureScreenshot", {
              format: "webp",
              quality: 80,
              clip: clipOption ? { ...clipOption, scale: 1 } : undefined,
            });
            base64Payload = cdpResult.data;
            buffer = Buffer.from(cdpResult.data, "base64");
          } catch {
            // Fallback to standard page.screenshot JPEG
            buffer = await page.screenshot({
              type: "jpeg",
              quality: 80,
              clip: clipOption,
            });
            base64Payload = buffer.toString("base64");
            mimeType = "image/jpeg";
          }

          if (buffer.length > MAX_SCREENSHOT_BYTES) {
            throw new Error(
              `Screenshot payload ${buffer.length} bytes exceeded max allowed ${MAX_SCREENSHOT_BYTES} bytes.`
            );
          }

          // 5b. Compute 256-bit perceptual hash and 32 block hashes via in-page downsampling
          let perceptualHash: string | undefined;
          let blockHashes: string[] | undefined;

          try {
            const grid = await page
              .evaluate(
                async ({ b64, mime }: { b64: string; mime: string }) => {
                  return new Promise<number[][] | null>((resolve) => {
                    try {
                      const win = globalThis as any;
                      const img = new win.Image();
                      img.onload = () => {
                        try {
                          const canvas = win.document.createElement("canvas");
                          canvas.width = 36;
                          canvas.height = 64;
                          const ctx = canvas.getContext("2d", {
                            willReadFrequently: true,
                          });
                          if (!ctx) return resolve(null);
                          ctx.drawImage(img, 0, 0, 36, 64);
                          const imgData = ctx.getImageData(0, 0, 36, 64);
                          const result: number[][] = [];
                          for (let y = 0; y < 64; y++) {
                            const row: number[] = [];
                            for (let x = 0; x < 36; x++) {
                              const idx = (y * 36 + x) * 4;
                              const r = imgData.data[idx] ?? 0;
                              const g = imgData.data[idx + 1] ?? 0;
                              const b = imgData.data[idx + 2] ?? 0;
                              row.push(0.299 * r + 0.587 * g + 0.114 * b);
                            }
                            result.push(row);
                          }
                          resolve(result);
                        } catch {
                          resolve(null);
                        }
                      };
                      img.onerror = () => resolve(null);
                      img.src = `data:${mime};base64,${b64}`;
                    } catch {
                      resolve(null);
                    }
                  });
                },
                { b64: base64Payload, mime: mimeType }
              )
              .catch(() => null);

            if (grid && grid.length === 64) {
              const computed = computeHashesFromLuminanceGrid(grid, 36, 64);
              perceptualHash = computed.perceptualHash;
              blockHashes = computed.blockHashes;
            }
          } catch {
            // Graceful non-blocking fallback
          }

          captures.push({
            deviceType,
            captureType,
            mimeType,
            width,
            height,
            buffer,
            fileSizeBytes: buffer.length,
            capturedAt: new Date().toISOString(),
            perceptualHash,
            blockHashes,
          });
        } finally {
          await page.close().catch(() => {});
        }
      }

      return {
        url: targetUrl,
        captures,
        durationMs: Date.now() - startTime,
      };
    } finally {
      // 6. Guarantee strict cleanup of browser and context
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}
