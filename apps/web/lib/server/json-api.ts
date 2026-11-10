// The JSON API's plumbing (plan item P15): parse a body with the shared zod schema, turn a failure
// into the ApiError shape the OpenAPI document publishes.
import type { z } from "zod";
import type { ApiFailure } from "./assistant-api.ts";

export function apiError(status: number, code: string, error: string, retryAfterSeconds?: number): Response {
  return Response.json({ error, code }, { status, headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {} });
}

export const fromFailure = (f: ApiFailure) => apiError(f.status, f.code, f.error, f.retryAfterSeconds);

/** Reads a JSON body against a schema; a refusal names the first field that is wrong. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<{ ok: true; value: z.infer<S> } | { ok: false; response: Response }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, response: apiError(415, "json_only", "Send the body as application/json.") };
  }
  const body: unknown = await req.json().catch(() => undefined);
  if (body === undefined) return { ok: false, response: apiError(400, "bad_json", "The body is not valid JSON.") };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, response: apiError(400, "invalid", `Please check ${issue?.path.join(".") || "the body"}: ${issue?.message ?? "invalid"}.`) };
  }
  return { ok: true, value: parsed.data };
}
