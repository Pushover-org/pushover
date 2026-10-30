# Sandbox findings (Day-1 proof tests, spec §3.9)

Each test is a script in `scripts/day1/`. Outputs below are verbatim from the
run, minus pino's JSON log lines (same data). No tokens or secrets are printed.

## D1-1: India login, US sandbox accounts, both apps — PASS (2026-10-30)

See spec §3.0.

## D1-2: OAuth, token cache, 404 parse — PASS (2026-10-30)

`pnpm day1:d1-2`

```
D1-2 run at 2026-10-30T17:22:28.995Z against https://api-m.sandbox.paypal.com
guarded GET /v2/checkout/orders/PUSHOVERD12BOGUS1 {"type":"PayPalApiError","status":404,"name":"RESOURCE_NOT_FOUND","issue":"INVALID_RESOURCE_ID","message":"The specified resource does not exist.","debug_id":"ca52c1a3789e1"} OK
guarded GET /v2/checkout/orders/PUSHOVERD12BOGUS2 {"type":"PayPalApiError","status":404,"name":"RESOURCE_NOT_FOUND","issue":"INVALID_RESOURCE_ID","message":"The specified resource does not exist.","debug_id":"ca52c1a3a98ed"} OK
guarded token requests for 2 API calls: 1 OK (cached)
baseline GET /v2/checkout/orders/PUSHOVERD12BOGUS1 {"type":"PayPalApiError","status":404,"name":"RESOURCE_NOT_FOUND","issue":"INVALID_RESOURCE_ID","message":"The specified resource does not exist.","debug_id":"ca52c1a4258f4"} OK
baseline GET /v2/checkout/orders/PUSHOVERD12BOGUS2 {"type":"PayPalApiError","status":404,"name":"RESOURCE_NOT_FOUND","issue":"INVALID_RESOURCE_ID","message":"The specified resource does not exist.","debug_id":"ca52c1a4648ea"} OK
baseline token requests for 2 API calls: 1 OK (cached)
D1-2 PASS
```

Findings:
- An unknown order ID is `404 RESOURCE_NOT_FOUND` with `details[0].issue = INVALID_RESOURCE_ID`.
  `issueOf()` returns the detail issue, so the ledger can tell "no such order" apart from other 404s.
- Every error carries a `debug_id` (also sent as the `paypal-debug-id` header).

## D1-3: card-source seeding (spec §3.6 Path A) — PASS (2026-10-30)

`pnpm day1:d1-3` (sandbox Visa from the Credit Card Generator, held in `.env.local`; never printed)

```
D1-3 run at 2026-10-30T17:32:58.643Z against https://api-m.sandbox.paypal.com
guarded create: {"order_id":"2B890787PA867392S","order_status":"COMPLETED","capture_id":"1M808024Y1685833E","capture_status":"COMPLETED","amount":"1.00"}
guarded OK
baseline create: {"order_id":"5HU66850SL5563215","order_status":"COMPLETED","capture_id":"6RK46028JS970274W","capture_status":"COMPLETED","amount":"1.00"}
baseline OK
D1-3 PASS
```

Findings:
- With `payment_source.card` and `intent: CAPTURE`, **create order returns `COMPLETED` with
  the capture in the same response**. No separate capture call, no buyer approval.
  **Seeding uses Path A.** Path B (Playwright approval) is not needed.
- Advanced Credit and Debit Card Payments was enabled on both apps shortly before;
  no permission error and no stale-token problem appeared.
- Orders v2 spec: `PayPal-Request-Id` "is mandatory for all single-step create order calls"
  with a payment source, and "The server stores keys for 6 hours".

## D1-4: refund retried with the same PayPal-Request-Id — PASS (2026-10-30)

`pnpm day1:d1-4` (guarded store)

```
D1-4 run at 2026-10-30T17:34:03.915Z against https://api-m.sandbox.paypal.com
fresh capture: {"orderId":"00352696EL7778153","captureId":"7E005400870140700"}
1st  POST key=K amount=0.10: {"refund_id":"18D08163JF056162E","status":"COMPLETED","amount":"0.10"}
2nd  POST key=K amount=0.10: {"refund_id":"18D08163JF056162E","status":"COMPLETED","amount":"0.10"}
3rd  POST key=K amount=0.20 (same key, different body): {"refund_id":"18D08163JF056162E","status":"COMPLETED","amount":"0.10"}
GET order refunds: [{"id":"18D08163JF056162E","status":"COMPLETED","amount":{"currency_code":"USD","value":"0.10"}}]
same key same body returned the same refund: true
same key different body: returned the ORIGINAL refund (body ignored)
refunds on order: 1
D1-4 PASS
```

Findings:
- A repeated request with the same key returns the original refund; PayPal shows exactly one.
- **Same key with a different amount is not an error.** PayPal silently returns the original
  refund and ignores the new body. Consequences, now enforced or planned:
  - `refundCapture` throws `PayPalRefundMismatchError` when the returned amount differs
    from the requested one (packages/paypal, unit-tested).
  - The ledger derives the key from one refund intent with one fixed amount (spec §2.7 #5)
    and never reuses it for another amount.
- PayPal keeps keys for 6 hours (Orders v2 spec text above; assumed the same for refunds,
  not tested). A retry of an UNVERIFIED refund after that may execute again, so the
  reconciler must read the order's refunds (match `custom_id`) **before** any retry.

## D1-5: the same refund twice WITHOUT a PayPal-Request-Id — risk confirmed (2026-10-30)

`pnpm day1:d1-5` (baseline store; raw fetch, as `@paypal/agent-toolkit` sends no per-call key, issue #98)

```
D1-5 run at 2026-10-30T17:34:25.369Z against https://api-m.sandbox.paypal.com
fresh capture: {"orderId":"0HE21453LW451341E","captureId":"6NE88119FB309905P"}
1st POST no key amount=0.10: HTTP 201 {"refund_id":"71M80585J4364383X","status":"COMPLETED"}
2nd POST no key amount=0.10: HTTP 201 {"refund_id":"70M13790D85840830","status":"COMPLETED"}
GET order refunds: [{"id":"71M80585J4364383X","status":"COMPLETED","amount":{"currency_code":"USD","value":"0.10"}},{"id":"70M13790D85840830","status":"COMPLETED","amount":{"currency_code":"USD","value":"0.10"}}]
Two distinct refunds: a retried request without a key refunds twice.
D1-5 PASS (risk confirmed)
```

Finding: PayPal does **not** dedupe identical refund requests that carry no key. A retry
(after a timeout, or an agent asking twice) refunds twice. This is the evidence for the
comment on paypal/agent-toolkit PR #108 (spec §10.1).

## D1-9: PayPal-Mock-Response on a refund POST — PASS (2026-10-30)

`pnpm day1:d1-9` (guarded app, bogus capture ID, so no money can move)

```
D1-9 run at 2026-10-30T17:22:39.902Z against https://api-m.sandbox.paypal.com
mock=none (control) {"type":"PayPalApiError","status":404,"name":"RESOURCE_NOT_FOUND","issue":"INVALID_RESOURCE_ID","message":"The specified resource does not exist.","debug_id":"ca52c1a7b4953"} (control)
mock=REFUND_AMOUNT_EXCEEDED {"type":"PayPalApiError","status":422,"name":"UNPROCESSABLE_ENTITY","issue":"REFUND_AMOUNT_EXCEEDED","message":"The requested action could not be completed, was semantically incorrect, or failed business validation.","debug_id":"ca52c1a7e3f47"} OK
mock=TRANSACTION_DISPUTED {"type":"PayPalApiError","status":422,"name":"UNPROCESSABLE_ENTITY","issue":"TRANSACTION_DISPUTED","message":"The requested action could not be performed, semantically incorrect, or failed business validation.","debug_id":"ca52c1a817ff4"} OK
D1-9 PASS
```

Findings:
- The mocked error is returned **even for a capture that does not exist**: the mock
  takes precedence over the 404. Error-path tests (REFUND_AMOUNT_EXCEEDED,
  TRANSACTION_DISPUTED) therefore do not consume a real capture.
- Mocked refund errors are `422 UNPROCESSABLE_ENTITY` with the code in `details[0].issue`.

## Spec corrections found while building

- `refund_request.custom_id` is `maxLength 127`, pattern `^.*$`
  (`docs/paypal-specs/payments_payment_v2.json`). The build spec said 255. The client enforces 127.
