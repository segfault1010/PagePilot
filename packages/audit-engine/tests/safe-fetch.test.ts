import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  createSafeFetcher,
  MAX_PAGE_BYTES,
} from "../src/fetch/safe-fetch.js";
import type { OpenStreamFn, FetchedPage } from "../src/fetch/safe-fetch.js";
import type { DnsResolver } from "../src/fetch/resolver.js";

const PUBLIC_IP = { address: "93.184.216.34", family: 4 as const };
const resolvePublic: DnsResolver = async () => [PUBLIC_IP];

function fakeResponse(options: {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  chunks?: Buffer[];
}): IncomingMessage {
  const stream = new PassThrough();
  Object.assign(stream, {
    statusCode: options.status,
    headers: options.headers ?? {},
  });
  if (options.chunks) {
    for (const chunk of options.chunks) stream.write(chunk);
    stream.end();
  } else if (options.body !== undefined) {
    stream.end(options.body);
  }
  return stream as unknown as IncomingMessage;
}

function makeFetcher(overrides: {
  openStream?: OpenStreamFn;
  resolveHostname?: DnsResolver;
  deadlineMs?: number;
  maxBytes?: number;
}) {
  return createSafeFetcher({
    resolveHostname: overrides.resolveHostname ?? resolvePublic,
    openStream: overrides.openStream,
    deadlineMs: overrides.deadlineMs,
    maxBytes: overrides.maxBytes,
  });
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

describe("createSafeFetcher", () => {
  it("fetches and decodes a successful HTML page", async () => {
    const requested: string[] = [];
    const fetch = makeFetcher({
      async openStream(url) {
        requested.push(url.href);
        return fakeResponse({ status: 200, headers: HTML_HEADERS, body: "<h1>ok</h1>" });
      },
    });

    const page: FetchedPage = await fetch("https://example.com/page?x=1");
    expect(requested).toEqual(["https://example.com/page?x=1"]);
    expect(page.finalUrl).toBe("https://example.com/page?x=1");
    expect(page.body).toContain("ok");
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    const fetch = makeFetcher({
      resolveHostname: async () => [{ address: "192.168.1.10", family: 4 }],
      async openStream() {
        throw new Error("must not connect");
      },
    });

    await expect(fetch("https://intranet.example/")).rejects.toMatchObject({
      kind: "BLOCKED_DESTINATION",
    });
  });

  it("rejects destinations where only some DNS records are safe", async () => {
    const fetch = makeFetcher({
      resolveHostname: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      async openStream() {
        throw new Error("must not connect");
      },
    });

    await expect(fetch("https://mixed.example/")).rejects.toMatchObject({
      kind: "BLOCKED_DESTINATION",
    });
  });

  it("rejects metadata-service addresses", async () => {
    const fetch = makeFetcher({
      resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
      async openStream() {
        throw new Error("must not connect");
      },
    });
    await expect(fetch("http://metadata.example/latest/meta-data")).rejects.toMatchObject({
      kind: "BLOCKED_DESTINATION",
    });
  });

  it("follows relative redirects with full revalidation", async () => {
    const calls: string[] = [];
    const fetch = makeFetcher({
      async openStream(url) {
        calls.push(url.href);
        if (calls.length === 1) {
          return fakeResponse({ status: 302, headers: { location: "/landing" } });
        }
        return fakeResponse({ status: 200, headers: HTML_HEADERS, body: "<p>landed</p>" });
      },
    });

    const page = await fetch("https://example.com/start");
    expect(calls).toEqual(["https://example.com/start", "https://example.com/landing"]);
    expect(page.finalUrl).toBe("https://example.com/landing");
  });

  it("blocks redirects that point at private addresses", async () => {
    const resolver: DnsResolver = vi.fn(async (hostname) =>
      hostname === "private.example"
        ? [{ address: "127.0.0.1", family: 4 }]
        : [PUBLIC_IP],
    );
    const fetch = makeFetcher({
      resolveHostname: resolver,
      async openStream() {
        return fakeResponse({
          status: 301,
          headers: { location: "http://private.example/admin" },
        });
      },
    });

    await expect(fetch("https://public.example/redirect")).rejects.toMatchObject({
      kind: "BLOCKED_DESTINATION",
    });
  });

  it("blocks redirects that point at localhost", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({ status: 302, headers: { location: "http://localhost:3000/" } });
      },
    });
    // The non-standard port (:3000) fails URL policy on the redirect hop.
    await expect(fetch("https://evil.example/open")).rejects.toMatchObject({
      kind: "INVALID_URL",
    });
  });

  it("blocks redirects to loopback hosts even on standard ports", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({ status: 302, headers: { location: "http://localhost/admin" } });
      },
      resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    await expect(fetch("https://evil.example/open")).rejects.toMatchObject({
      kind: "BLOCKED_DESTINATION",
    });
  });

  it("blocks redirects to unsupported protocols", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({ status: 302, headers: { location: "ftp://files.example/x" } });
      },
    });

    await expect(fetch("https://evil.example/open")).rejects.toMatchObject({
      kind: "INVALID_URL",
    });
  });

  it("hands the validated address to the transport, never an unresolved hostname", async () => {
    const seen: Array<{ url: string; address: string }> = [];
    const fetch = makeFetcher({
      resolveHostname: async () => [
        { address: "104.20.23.154", family: 4 },
        { address: "172.66.147.243", family: 4 },
      ],
      async openStream(url, address) {
        seen.push({ url: url.href, address: address.address });
        return fakeResponse({ status: 200, headers: HTML_HEADERS, body: "<p>x</p>" });
      },
    });

    await fetch("https://pinned.example/");
    expect(seen).toEqual([
      { url: "https://pinned.example/", address: "104.20.23.154" },
    ]);
  });

  it("applies the deadline to DNS resolution itself", async () => {
    const fetch = makeFetcher({
      deadlineMs: 80,
      // Never-resolving resolver simulates a stalled DNS server.
      resolveHostname: () => new Promise(() => undefined),
      async openStream() {
        throw new Error("must not connect");
      },
    });

    await expect(fetch("https://stalled-dns.example/")).rejects.toMatchObject({
      kind: "TIMEOUT",
    });
  });

  it("allows absolute redirects to a different public host", async () => {
    const fetch = createSafeFetcher({
      resolveHostname: vi.fn(async (hostname: string) =>
        hostname === "target.example"
          ? [{ address: "8.8.8.8", family: 4 }]
          : [PUBLIC_IP],
      ),
      async openStream(url) {
        if (url.hostname === "moved.example") {
          return fakeResponse({ status: 301, headers: { location: "https://target.example/final" } });
        }
        return fakeResponse({ status: 200, headers: HTML_HEADERS, body: "<p>final</p>" });
      },
    });

    await expect(fetch("https://moved.example/")).resolves.toMatchObject({
      finalUrl: "https://target.example/final",
    });
  });

  it("rejects redirects carrying credentials", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({
          status: 302,
          headers: { location: "https://user:secret@target.example/" },
        });
      },
    });

    await expect(fetch("https://evil.example/open")).rejects.toMatchObject({
      kind: "INVALID_URL",
    });
  });

  it("bounds decompression bombs by decoded size (gzip)", async () => {
    const zlib = await import("node:zlib");
    const bomb = zlib.gzipSync(Buffer.alloc(4 * 1024 * 1024, 97)); // 4 MB of 'a'
    const fetch = makeFetcher({
      maxBytes: MAX_PAGE_BYTES,
      async openStream() {
        const stream = new PassThrough();
        Object.assign(stream, {
          statusCode: 200,
          headers: { ...HTML_HEADERS, "content-encoding": "gzip" },
        });
        stream.end(bomb);
        return stream as unknown as IncomingMessage;
      },
    });

    await expect(fetch("https://bomb.example/")).rejects.toMatchObject({
      kind: "REQUEST_TOO_LARGE",
    });
  });

  it("gives up after three redirects", async () => {
    let requests = 0;
    const fetch = makeFetcher({
      async openStream() {
        requests += 1;
        return fakeResponse({ status: 302, headers: { location: `/hop${requests}` } });
      },
    });

    await expect(fetch("https://loop.example/start")).rejects.toMatchObject({
      kind: "UPSTREAM_FAILURE",
      message: /too many redirects/i,
    });
    expect(requests).toBe(4); // initial + 3 redirects
  });

  it("maps non-HTML responses to NON_HTML_RESPONSE without downloading", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({
          status: 200,
          headers: { "content-type": "application/pdf" },
          body: "%PDF-1.7 not html",
        });
      },
    });

    await expect(fetch("https://docs.example/file.pdf")).rejects.toMatchObject({
      kind: "NON_HTML_RESPONSE",
    });
  });

  it("rejects early when Content-Length exceeds the limit", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({
          status: 200,
          headers: { ...HTML_HEADERS, "content-length": String(MAX_PAGE_BYTES + 1) },
          body: "",
        });
      },
    });

    await expect(fetch("https://big.example/page")).rejects.toMatchObject({
      kind: "REQUEST_TOO_LARGE",
    });
  });

  it("enforces the size cap while streaming when Content-Length is absent", async () => {
    const chunk = Buffer.alloc(1024 * 1024, 97); // 1 MB
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({
          status: 200,
          headers: HTML_HEADERS,
          chunks: [chunk, chunk],
        });
      },
    });

    await expect(fetch("https://big.example/stream")).rejects.toMatchObject({
      kind: "REQUEST_TOO_LARGE",
    });
  });

  it("aborts slow responses with a retryable TIMEOUT", async () => {
    const fetch = makeFetcher({
      deadlineMs: 60,
      async openStream(_url, _address, signal) {
        return new Promise<IncomingMessage>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
            { once: true },
          );
        });
      },
    });

    await expect(fetch("https://slow.example/")).rejects.toMatchObject({
      kind: "TIMEOUT",
    });
  });

  it("maps upstream connection failures to UPSTREAM_FAILURE", async () => {
    const fetch = makeFetcher({
      async openStream() {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      },
    });

    await expect(fetch("https://down.example/")).rejects.toMatchObject({
      kind: "UPSTREAM_FAILURE",
    });
  });

  it("treats non-2xx final responses as upstream failure", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({ status: 500, headers: HTML_HEADERS, body: "boom" });
      },
    });

    await expect(fetch("https://broken.example/")).rejects.toMatchObject({
      kind: "UPSTREAM_FAILURE",
    });
  });

  it("accepts XHTML documents", async () => {
    const fetch = makeFetcher({
      async openStream() {
        return fakeResponse({
          status: 200,
          headers: { "content-type": "application/xhtml+xml" },
          body: "<html><body><p>x</p></body></html>",
        });
      },
    });

    await expect(fetch("https://x.example/")).resolves.toMatchObject({ contentType: "application/xhtml+xml" });
  });
});
