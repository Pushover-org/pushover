import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { RateLimiter } from "./bucket.ts";
import { issueOf, PayPalApiError, PayPalNetworkError, PayPalUnknownOutcomeError } from "./errors.ts";
import { PayPalSdk, standInFor } from "./sdk.ts";

export interface Logger {
  warn(obj: object, msg: string): void;
}

export interface PayPalClientOptions {
  /** https://api-m.sandbox.paypal.com */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Shared per process (or per database); keeps us under the 50 req/min sandbox limit. */
  limiter: RateLimiter;
  /** Per HTTP attempt. Default 15 000. */
  timeoutMs?: number;
  /** Default 4. */
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  logger?: Logger;
}

export interface RequestOptions {
  body?: unknown;
  /** Required for every POST. Must stay the same across retries of the same intent. */
  requestId?: string;
  /** Sandbox negative testing: sent as PayPal-Mock-Response. */
  mockCode?: string;
  prefer?: "return=minimal" | "return=representation";
}

type Method = "GET" | "POST" | "PATCH";

/** Refresh the OAuth token this long before PayPal says it expires. */
const TOKEN_MARGIN_MS = 300_000;

const defaultLogger: Logger = pino({ name: "paypal" });

export class PayPalClient {
  private token: { value: string; expiresAt: number } | undefined;
  private tokenInflight: Promise<string> | undefined;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly o: PayPalClientOptions;
  private sdkInstance: PayPalSdk | undefined;

  constructor(o: PayPalClientOptions) {
    // Sandbox only (plan item P53): any other base URL is refused before a request can be built.
    standInFor(o.baseUrl);
    this.o = o;
    this.fetch = o.fetch ?? globalThis.fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    this.log = o.logger ?? defaultLogger;
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.maxAttempts = o.maxAttempts ?? 4;
  }

  /**
   * PayPal's own Server SDK over the same credentials, limiter and timeouts, for the reporting calls
   * (sdk.ts). Built on first use and kept, so its OAuth token is reused.
   */
  get sdk(): PayPalSdk {
    return (this.sdkInstance ??= new PayPalSdk(this.o));
  }

  /** A fresh idempotency key for a NEW intent. Never call this to retry an existing one. */
  static newRequestId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  async request<T>(method: Method, path: string, opt: RequestOptions = {}): Promise<T> {
    // Invariant: no money-moving or resource-creating POST without an idempotency key.
    const postKey = method === "POST" ? requireKey(opt.requestId, path) : undefined;
    // Once any attempt of a POST might have reached PayPal without a clear answer,
    // a later failure can no longer prove that nothing happened.
    let ambiguous = false;
    let refreshedToken = false;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const token = await this.getToken();
      await this.o.limiter.take();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (opt.requestId) headers["PayPal-Request-Id"] = opt.requestId;
      if (opt.mockCode) headers["PayPal-Mock-Response"] = JSON.stringify({ mock_application_codes: opt.mockCode });
      if (opt.prefer) headers["Prefer"] = opt.prefer;

      let res: Response;
      try {
        res = await this.fetch(this.o.baseUrl + path, {
          method,
          headers,
          ...(opt.body === undefined ? {} : { body: JSON.stringify(opt.body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        // Timeout or network failure: for a POST we do not know whether PayPal executed it.
        ambiguous = true;
        lastError = err;
        if (attempt < this.maxAttempts) {
          await this.sleep(backoffMs(attempt));
          continue; // safe: same PayPal-Request-Id
        }
        break;
      }

      const debugId = res.headers.get("paypal-debug-id") ?? undefined;
      const body = await readBody(res);

      if (res.ok) {
        if (body.ok) return body.value as T;
        if (postKey !== undefined) throw new PayPalUnknownOutcomeError(path, postKey, new Error("unreadable success body"));
        throw new PayPalApiError(res.status, { raw: body.raw }, path, debugId);
      }

      const errorBody = body.ok ? body.value : { raw: body.raw };
      const issue = issueOf(errorBody);
      const authProblem = res.status === 401 || (res.status === 403 && issue === "NOT_AUTHORIZED");
      if (authProblem && !refreshedToken) {
        // Token expired early, or was minted before a scope was added (spec §3.0 lesson).
        refreshedToken = true;
        this.token = undefined;
        attempt--; // a token refresh is not a retry of the request
        continue;
      }

      const inProgress = res.status === 409 && issue === "PREVIOUS_REQUEST_IN_PROGRESS";
      const retryable = res.status === 429 || res.status >= 500 || inProgress;
      if (res.status >= 500 || inProgress) ambiguous = true;
      lastError = new PayPalApiError(res.status, errorBody, path, debugId);

      if (retryable && attempt < this.maxAttempts) {
        await this.sleep(retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt));
        continue;
      }
      this.log.warn({ method, path, status: res.status, debugId, issue }, "paypal error");
      break;
    }

    if (postKey !== undefined && ambiguous) throw new PayPalUnknownOutcomeError(path, postKey, lastError);
    if (lastError instanceof PayPalApiError) throw lastError;
    throw new PayPalNetworkError(path, lastError);
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > this.now()) return this.token.value;
    // Single flight: concurrent callers share one token request.
    this.tokenInflight ??= this.fetchToken().finally(() => {
      this.tokenInflight = undefined;
    });
    return this.tokenInflight;
  }

  private async fetchToken(): Promise<string> {
    await this.o.limiter.take();
    const path = "/v1/oauth2/token";
    let res: Response;
    try {
      res = await this.fetch(this.o.baseUrl + path, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${this.o.clientId}:${this.o.clientSecret}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new PayPalNetworkError(path, err);
    }
    const body = await readBody(res);
    if (!res.ok || !body.ok) {
      throw new PayPalApiError(res.status, body.ok ? body.value : { raw: body.raw }, path, res.headers.get("paypal-debug-id") ?? undefined);
    }
    const j = body.value as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== "string" || typeof j.expires_in !== "number") {
      throw new PayPalApiError(res.status, { name: "MALFORMED_TOKEN_RESPONSE" }, path);
    }
    this.token = { value: j.access_token, expiresAt: this.now() + j.expires_in * 1000 };
    return j.access_token;
  }
}

function requireKey(requestId: string | undefined, path: string): string {
  if (!requestId) throw new Error(`POST ${path} requires requestId`);
  return requestId;
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}

/** Retry-After in seconds (PayPal's form). HTTP-date values fall back to backoff. */
function retryAfterMs(header: string | null): number | undefined {
  const s = Number(header);
  return header !== null && Number.isFinite(s) && s > 0 ? s * 1000 : undefined;
}

type Body = { ok: true; value: unknown } | { ok: false; raw: string };

async function readBody(res: Response): Promise<Body> {
  const raw = await res.text().catch(() => "");
  if (raw === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, raw: raw.slice(0, 2000) };
  }
}
