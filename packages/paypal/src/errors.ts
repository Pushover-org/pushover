/** Error body shape from PayPal's OpenAPI `error` schema (name, message, debug_id, details[]). */
export interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { field?: string; value?: string; location?: string; issue?: string; description?: string }[];
  /** OAuth errors use this shape instead. */
  error?: string;
  error_description?: string;
}

/** First `details[].issue`, else the error `name`, else the OAuth `error`. */
export function issueOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as PayPalErrorBody;
  return b.details?.[0]?.issue ?? b.name ?? b.error;
}

/** PayPal answered with a definite error. Nothing was executed. */
export class PayPalApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly path: string;
  readonly debugId: string | undefined;
  readonly issue: string | undefined;
  constructor(status: number, body: unknown, path: string, debugId?: string) {
    const issue = issueOf(body);
    super(`PayPal ${status} ${issue ?? "error"} on ${path}${debugId ? ` (debug_id ${debugId})` : ""}`);
    this.name = "PayPalApiError";
    this.status = status;
    this.body = body;
    this.path = path;
    this.debugId = debugId;
    this.issue = issue;
  }
}

/**
 * A POST may or may not have executed at PayPal (timeout, network error, 5xx,
 * or a retry that never got a definite answer). Callers must treat the outcome
 * as UNKNOWN and reconcile by reading PayPal. Never as "nothing happened".
 */
export class PayPalUnknownOutcomeError extends Error {
  readonly path: string;
  readonly requestId: string;
  readonly lastError: unknown;
  constructor(path: string, requestId: string, lastError: unknown) {
    super(`Outcome unknown for POST ${path} (PayPal-Request-Id ${requestId})`);
    this.name = "PayPalUnknownOutcomeError";
    this.path = path;
    this.requestId = requestId;
    this.lastError = lastError;
  }
}

/** A GET (or the token call) could not reach PayPal. */
export class PayPalNetworkError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(`Could not reach PayPal for ${path}`, { cause });
    this.name = "PayPalNetworkError";
    this.path = path;
  }
}
