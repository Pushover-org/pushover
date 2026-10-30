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
