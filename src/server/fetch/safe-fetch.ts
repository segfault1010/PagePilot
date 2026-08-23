import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { enforceUrlPolicy } from "../../shared/url-policy";
import { isPubliclyRoutableAddress } from "./ip-policy";
import type { DnsResolver, ResolvedAddress } from "./resolver";
import { defaultDnsResolver } from "./resolver";

export const MAX_PAGE_BYTES = 1_572_864; // 1.5 MB of decoded HTML
export const FETCH_DEADLINE_MS = 8_000;
export const MAX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_MEDIA_TYPES = ["text/html", "application/xhtml+xml"];

export type SafeFetchErrorKind =
  | "BLOCKED_DESTINATION"
  | "INVALID_URL"
  | "REQUEST_TOO_LARGE"
  | "NON_HTML_RESPONSE"
  | "TIMEOUT"
  | "UPSTREAM_FAILURE";

export class SafeFetchError extends Error {
  readonly kind: SafeFetchErrorKind;

  constructor(kind: SafeFetchErrorKind, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.kind = kind;
  }
}

export interface FetchedPage {
  finalUrl: string;
  contentType: string;
  body: string;
}

/**
 * Opens a connection to one specific, pre-validated IP address while the
 * original hostname stays intact for the Host header and TLS SNI. This is
 * the pinned-resolution defense against DNS rebinding: the socket can only
 * connect to an address that just passed validation.
 */
export type OpenStreamFn = (
  target: URL,
  address: ResolvedAddress,
  signal: AbortSignal,
) => Promise<IncomingMessage>;

export interface SafeFetcherOptions {
  resolveHostname?: DnsResolver;
  openStream?: OpenStreamFn;
  deadlineMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

/**
 * Pins every DNS lookup Node performs for this request to the single
 * validated address. The hostname is untouched, so TLS SNI and the Host
 * header keep their original semantics.
 *
 * Node >= 20 enables autoSelectFamily (happy eyeballs), which calls lookup
 * with all=true and expects an array of records as the second callback
 * argument; both callback shapes are honored, and only the validated
 * address is ever handed to the socket either way.
 */
function pinLookupTo(address: ResolvedAddress): LookupFunction {
  const pinned = ((
    _hostname: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      result?: unknown,
      family?: number,
    ) => void,
  ) => {
    if (options?.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  }) as LookupFunction;
  return pinned;
}

function createDefaultOpenStream(): OpenStreamFn {
  return (target, address, signal) =>
    new Promise<IncomingMessage>((resolve, reject) => {
      const isHttps = target.protocol === "https:";
      const transport = isHttps ? https : http;

      const request = transport.request(
        {
          // Hostname preserved for the Host header and TLS SNI; the pinned
          // lookup restricts the actual socket to the validated address.
          host: target.hostname,
          servername: isHttps ? target.hostname : undefined,
          port: target.port || (isHttps ? "443" : "80"),
          path: `${target.pathname}${target.search}`,
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
            "accept-language": "en",
            "accept-encoding": "gzip, deflate, br, identity",
          },
          lookup: pinLookupTo(address),
          signal,
        },
        (response) => resolve(response),
      );

      request.on("error", (error) => reject(toTransportError(error)));
      request.end();
    });
}

function toTransportError(error: unknown): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || /abort/i.test(error.message)) {
      return new SafeFetchError("TIMEOUT", "The page took too long to respond.");
    }
    const code = String((error as { code?: unknown }).code ?? "");
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) {
      return new SafeFetchError("UPSTREAM_FAILURE", "Could not reach the site.");
    }
  }
  return new SafeFetchError("UPSTREAM_FAILURE", "Could not reach the site.");
}

function mediaBaseType(contentTypeHeader: string | undefined): string {
  return (contentTypeHeader ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readDecodedBody(
  response: IncomingMessage,
  opts: { maxBytes: number; signal: AbortSignal },
): Promise<string> {
  const declaredLength = Number(response.headers["content-length"] ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > opts.maxBytes) {
    response.destroy();
    throw new SafeFetchError("REQUEST_TOO_LARGE", "That page is too large.");
  }

  const encoding = String(response.headers["content-encoding"] ?? "")
    .toLowerCase()
    .trim();
  let decoded: Readable = response;
  if (encoding === "gzip" || encoding === "x-gzip") {
    decoded = response.pipe(zlib.createGunzip());
  } else if (encoding === "deflate") {
    decoded = response.pipe(zlib.createInflate());
  } else if (encoding === "br") {
    decoded = response.pipe(zlib.createBrotliDecompress());
  } else if (encoding.length > 0 && encoding !== "identity") {
    response.destroy();
    throw new SafeFetchError("UPSTREAM_FAILURE", "Unsupported content encoding.");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const onAbort = () => {
    response.destroy();
    decoded.destroy(new Error("Fetch aborted."));
  };
  opts.signal.addEventListener("abort", onAbort, { once: true });

  try {
    for await (const chunk of decoded) {
      const buffer = Buffer.from(chunk as Buffer);
      total += buffer.length;
      if (total > opts.maxBytes) {
        response.destroy();
        decoded.destroy();
        throw new SafeFetchError("REQUEST_TOO_LARGE", "That page is too large.");
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (opts.signal.aborted) {
      throw new SafeFetchError("TIMEOUT", "The page took too long to respond.");
    }
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError("UPSTREAM_FAILURE", "Could not download the page.");
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetches a page with SSRF-safe pinned connections. Every hop (including
 * each redirect destination) goes through URL policy, fresh DNS resolution,
 * and IP-range validation. Responses are streamed against hard byte and
 * time limits; nothing unbounded is buffered.
 */
export function createSafeFetcher(
  options: SafeFetcherOptions = {},
): (input: string) => Promise<FetchedPage> {
  const resolveHostname = options.resolveHostname ?? defaultDnsResolver;
  const openStream = options.openStream ?? createDefaultOpenStream();
  const deadlineMs = options.deadlineMs ?? FETCH_DEADLINE_MS;
  const maxBytes = options.maxBytes ?? MAX_PAGE_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  return async (input: string): Promise<FetchedPage> => {
    const controller = new AbortController();
    const deadlineTimer = setTimeout(() => controller.abort(), deadlineMs);

    try {
      let currentHref = input;

      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        // Full re-validation on every hop, including redirects.
        const policy = enforceUrlPolicy(currentHref);
        if (!policy.ok) {
          throw new SafeFetchError("INVALID_URL", policy.message);
        }
        const url = new URL(policy.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new SafeFetchError(
            "INVALID_URL",
            "Only http:// and https:// URLs are supported.",
          );
        }

        let records: ResolvedAddress[];
        try {
          // DNS APIs are not abortable; race the resolver against the same
          // shared deadline so a stalled resolver cannot extend total wall
          // time beyond the planned fetch budget.
          const dnsDeadline = new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new SafeFetchError("TIMEOUT", "The page took too long to respond.")),
              { once: true },
            );
          });
          // If the body phase aborts later, this promise's rejection is
          // already irrelevant — swallow it to avoid unhandled rejections.
          dnsDeadline.catch(() => undefined);
          records = await Promise.race([resolveHostname(url.hostname), dnsDeadline]);
        } catch (error) {
          if (error instanceof SafeFetchError) throw error;
          throw new SafeFetchError("UPSTREAM_FAILURE", "Could not reach the site.");
        }
        if (records.length === 0) {
          throw new SafeFetchError("UPSTREAM_FAILURE", "Could not reach the site.");
        }
        const safeRecords = records.filter((record) =>
          isPubliclyRoutableAddress(record.address),
        );
        // Mixed safe/unsafe records are treated as hostile (rebinding):
        // reject the whole destination rather than picking a safe one.
        if (safeRecords.length === 0 || safeRecords.length !== records.length) {
          throw new SafeFetchError(
            "BLOCKED_DESTINATION",
            "This destination isn't reachable.",
          );
        }
        const address = safeRecords[0]!;

        let response: IncomingMessage;
        try {
          response = await openStream(url, address, controller.signal);
        } catch (error) {
          throw toTransportError(error);
        }

        const status = response.statusCode ?? 0;

        if (REDIRECT_STATUSES.has(status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location) {
            throw new SafeFetchError("UPSTREAM_FAILURE", "The site responded unexpectedly.");
          }
          if (hop === maxRedirects) {
            throw new SafeFetchError("UPSTREAM_FAILURE", "Too many redirects.");
          }
          currentHref = new URL(location, url).href;
          continue;
        }

        if (status < 200 || status > 299) {
          response.destroy();
          throw new SafeFetchError("UPSTREAM_FAILURE", "The site responded unexpectedly.");
        }

        // Reject non-HTML before downloading anything.
        const baseType = mediaBaseType(response.headers["content-type"]);
        if (!HTML_MEDIA_TYPES.includes(baseType)) {
          response.destroy();
          throw new SafeFetchError("NON_HTML_RESPONSE", "Only HTML pages can be analyzed.");
        }

        const body = await readDecodedBody(response, {
          maxBytes,
          signal: controller.signal,
        });
        return { finalUrl: url.href, contentType: baseType, body };
      }

      throw new SafeFetchError("UPSTREAM_FAILURE", "Too many redirects.");
    } finally {
      clearTimeout(deadlineTimer);
    }
  };
}
