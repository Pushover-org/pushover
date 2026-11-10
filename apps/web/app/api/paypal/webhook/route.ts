// PayPal's webhook deliveries (plan item P38). An event is stored only after PayPal itself confirms
// the signature (POST /v1/notifications/verify-webhook-signature), and only once per event ID. A
// stored event only ever makes the worker read our batch back from PayPal: its contents never
// move a claim. Refused deliveries are written to the audit log, not stored.
import { appendAudit, recordWebhookEvent } from "@proofofclaim/db";
import { limiterFromEnv, paypalClientFromEnv, verifyWebhookSignature } from "@proofofclaim/paypal";
import type { NextRequest } from "next/server";
import { pool } from "@/lib/server/data.ts";

const MAX_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const webhookId = process.env["PAYPAL_GUARDED_WEBHOOK_ID"];
  if (!webhookId) return new Response("webhooks are not configured", { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return new Response("too large", { status: 413 });
  let event: { id?: unknown; event_type?: unknown };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return new Response("not JSON", { status: 400 });
  }
  const id = typeof event.id === "string" && event.id.length <= 64 ? event.id : null;
  const type = typeof event.event_type === "string" ? event.event_type : null;
  const h = (name: string) => req.headers.get(name);
  const ok =
    id !== null && type !== null &&
    (await verifyWebhookSignature(paypalClientFromEnv("guarded", limiterFromEnv()), {
      webhookId, event,
      headers: {
        "paypal-auth-algo": h("paypal-auth-algo"), "paypal-cert-url": h("paypal-cert-url"), "paypal-transmission-id": h("paypal-transmission-id"),
        "paypal-transmission-sig": h("paypal-transmission-sig"), "paypal-transmission-time": h("paypal-transmission-time"),
      },
    }).catch(() => false));
  if (!ok || !id || !type) {
    await appendAudit(pool(), { actor: "anonymous", action: "webhook_refused", subject: id ?? "(no id)", detail: { type } });
    return new Response("signature not verified", { status: 400 });
  }
  const fresh = await recordWebhookEvent(pool(), { id, type, payload: event });
  return Response.json({ stored: fresh, replay: !fresh });
}
