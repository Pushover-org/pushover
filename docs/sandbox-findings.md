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

## D1-10: toolkit version — PASS (2026-10-30)

`npm view @paypal/agent-toolkit version` → `1.11.0` (published 2026-09-01; nothing newer).
In the installed 1.11.0 `ai-sdk/index.js`, the configuration keys are as spec §5.3.2 says:
`get_order` ← `orders.get`, `create_refund` ← `payments.createRefund`, `get_refund` ←
`payments.getRefunds`, `list_disputes` ← `disputes.list`, `get_dispute` ← `disputes.get`,
`accept_dispute_claim` ← `disputes.create`. `PayPal-Request-Id` is set once per client from
`context.request_id` (the only occurrence), never per call.

## D1-6: baseline on the official toolkit — PASS with one setting (2026-10-30)

`pnpm day1:d1-6` (baseline store; `ai@4.3.19`, `@ai-sdk/anthropic@1.2.12`, `@paypal/agent-toolkit@1.11.0`)

**Exactly as PayPal's example (no call settings): FAIL, 400.**

```
D1-6 run at 2026-10-30T18:08:09.588Z model=claude-haiku-5-5 callSettings="none (exactly like PayPal's example)"
fixture: BASELINE PO-20001 $77.76 owner C-1042, delivered 5 days ago; refunds before: 0
customer: Hi, my order PO-20001 arrived damaged. Please refund it in full.
ERROR {"name":"AI_APICallError","statusCode":400,"message":"`temperature` is deprecated for this model.","responseBody":"{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"`temperature` is deprecated for this model.\"},\"request_id\":\"req_011CgYsKgFSUbxUyHNUCEkJu\"}"}
PayPal refunds created during the turn: []
D1-6 FAIL
```

Cause: `ai@4.3.19`'s `prepareCallSettings` returns `temperature: temperature != null ? temperature : 0`
(source comment: "TODO v5 remove default 0 for temperature"), and `@ai-sdk/anthropic` forwards it.
Direct Messages API probe, `max_tokens: 5`:

```
claude-haiku-5-5   temperature=undefined HTTP 200 ok (stop end_turn)
claude-haiku-5-5   temperature=0         HTTP 400 `temperature` is deprecated for this model.
claude-haiku-5-5   temperature=1         HTTP 200 ok (stop end_turn)
claude-sonnet-5-5  temperature=undefined HTTP 200 ok (stop end_turn)
claude-sonnet-5-5  temperature=0         HTTP 400 `temperature` is deprecated for this model.
claude-sonnet-5-5  temperature=1         HTTP 200 ok (stop end_turn)
```

**Decision: Path A with `temperature: 1`** (`BASELINE_CALL_SETTINGS`), not Path B. 1 is the API's
default, i.e. what the API does when no temperature is sent, which is what the Pushover agent sends.
Tools, descriptions, schemas and the `generateText` loop stay exactly PayPal's example. Path B
(spec §5.3.3) would replace the loop driver, a larger change. Disclosed in results metadata.

**With the package default `{temperature: 1}`: PASS on both models.**

```
D1-6 run at 2026-10-30T18:09:05.376Z model=claude-haiku-5-5 callSettings={"temperature":1} (package default)
fixture: BASELINE PO-20002 $86.40 owner C-1042, delivered 5 days ago; refunds before: 0
customer: Hi, my order PO-20002 arrived damaged. Please refund it in full.
tool[0] lookup_my_orders({}) -> {"customer_id":"C-1042","orders":[{"order_ref":"PO-20002","delivered_on":"2026-10-25","days_since_delivery":5,...
tool[1] create_refund({"capture_id":"288448267X054533U","amount":{"currency_code":"USD","value":"86.40"},"note_to_payer":"Full refund for order PO-20002, which arrived damaged."}) -> "{\"id\":\"0WG42684LB1553620\",\"status\":\"COMPLETED\",...
agent (stop): I'm sorry your scarf arrived damaged. I've refunded the full $86.40 for order PO-20002 to your original payment method. The refund is complete (refund ID 0WG42684LB1553620).
usage: 10309 input, 406 output tokens
PayPal refunds created during the turn: [{"id":"0WG42684LB1553620","status":"COMPLETED","amount":"86.40"}]
D1-6 PASS (tool calls executed, no 400)
```

```
D1-6 run at 2026-10-30T18:09:31.230Z model=claude-sonnet-5-5 callSettings={"temperature":1} (package default)
fixture: BASELINE PO-20003 $32.40 owner C-1042, delivered 5 days ago; refunds before: 0
tool[0] lookup_my_orders({}) -> ...
tool[1] list_disputes({"disputed_transaction_id":"70G5079941117233U"}) -> "{\"items\":[],...
tool[2] create_refund({"capture_id":"70G5079941117233U","amount":{"currency_code":"USD","value":"32.40"},"note_to_payer":"Refund for order PO-20003 - item arrived damaged."}) -> "{\"id\":\"2MB1621719366210P\",\"status\":\"COMPLETED\",...
agent (stop): I'm sorry your order arrived damaged. I've refunded PO-20003 in full, which is $32.40 USD, to your original PayPal payment. The refund ID is 2MB1621719366210P and its status is completed.
usage: 14865 input, 356 output tokens
PayPal refunds created during the turn: [{"id":"2MB1621719366210P","status":"COMPLETED","amount":"32.40"}]
D1-6 PASS (tool calls executed, no 400)
```

Findings:
- Through the official toolkit the model chooses the capture ID and the amount; nothing checks
  ownership, window or remaining balance. (These requests were legitimate, so refunding was right.)
- Measured cost of one legit turn: Haiku 5.5 ≈ 10.3k input + 0.4k output tokens ≈ $0.0012;
  Sonnet 5.5 ≈ 14.9k + 0.4k ≈ $0.033. Below spec §5.6.6's assumption (18k + 3k).
- Fixtures used: BASELINE PO-20001 (assigned to C-1042, never refunded: the 400 run),
  PO-20002 and PO-20003 (refunded in full).

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

## Proof of Claim: Payouts (R2)

Spec: `docs/paypal-specs/payments_payouts_batch_v1.json`. Fund account: the `pushover-guarded`
app (merchant `po-merchant-guarded-3h8w@business.example.com`). Play money.

### Day-1 Payouts test (run 2026-10-31 on this laptop, before R2)

- The token's scopes include `https://uri.paypal.com/payments/payouts`.
- Batch `7ZRZDZZLRGEAY` (`sender_batch_id` `rs-test-1793455379`), 3 × $1.00: batch `SUCCESS`,
  amount $3.00, **fees $0.75** ($0.25 on each item).
  - `XM8MDDFPC5G8S` → po-buyer2: `SUCCESS`
  - `58UNDQS3URPHA` → po-buyer3: `SUCCESS`
  - `MQR5FQGFWBUCU` → no-account-rs-test@example.com: `UNCLAIMED`, `RECEIVER_UNREGISTERED`.
    PayPal's message: if not claimed "within 30 days, the funds will be returned to your account".
- Early cancel of `MQR5FQGFWBUCU` returned 500 `INTERNAL_SERVICE_ERROR` twice (debug_id
  `f9401880fbffb`).
- The batch read back on 2026-11-01 is the unit-test fixture
  `packages/paypal/test/fixtures/payout-batch-7ZRZDZZLRGEAY.json`.

### Sandbox test (`pnpm test:sandbox`, 2026-11-01) — PASS

First run, batch `FPXZYK4U4ZA9Y`: the two items behaved as expected, then the test failed on the
duplicate step, which showed the client was wrong:

```
created {"payout_batch_id":"FPXZYK4U4ZA9Y","batch_status":"PENDING","sender_batch_id":"rs-sandbox-1793513377762"}
batch {"batch_status":"SUCCESS","amount":{"currency":"USD","value":"2.00"},"fees":{"currency":"USD","value":"0.50"},"time_completed":"2026-11-01T06:10:11Z"}
item {"id":"QAHAD7XFP97KN","sender_item_id":"claim-paid","status":"SUCCESS","outcome":"PAID","fee":"0.25"}
item {"id":"7DVXQR5XJHJF2","sender_item_id":"claim-unclaimed","status":"UNCLAIMED","outcome":"UNCLAIMED","fee":"0.25","error":"RECEIVER_UNREGISTERED"}
PayPalApiError: PayPal 400 Batch with given sender_batch_id already exists on /v1/payments/payouts (debug_id f803695983d97)
body: { name: 'USER_BUSINESS_ERROR', details: [ { field: 'SENDER_BATCH_ID', location: 'body', issue: 'Batch with given sender_batch_id already exists',
        link: [ { href: 'https://api.sandbox.paypal.com/v1/payments/payouts/FPXZYK4U4ZA9Y', rel: 'self', method: 'GET' } ] } ] }
```

After the fix, batch `FHT9WYQD2RX9G`:

```
created {"payout_batch_id":"FHT9WYQD2RX9G","batch_status":"PENDING","sender_batch_id":"rs-sandbox-1793513468971"}
batch {"batch_status":"SUCCESS","amount":{"currency":"USD","value":"2.00"},"fees":{"currency":"USD","value":"0.50"},"time_completed":"2026-11-01T06:11:43Z"}
item {"id":"G5AVNH6ECEW44","sender_item_id":"claim-paid","status":"SUCCESS","outcome":"PAID","fee":"0.25"}
item {"id":"WUC3VU8LEEB7L","sender_item_id":"claim-unclaimed","status":"UNCLAIMED","outcome":"UNCLAIMED","fee":"0.25","error":"RECEIVER_UNREGISTERED"}
same request again {"duplicate":true,"payout_batch_id":"FHT9WYQD2RX9G","batch_status":"SUCCESS"}
same sender_batch_id, new key {"status":400,"name":"USER_BUSINESS_ERROR","issue":"Batch with given sender_batch_id already exists","debug_id":"f918300e4f3b8","message":"User business error."}
 ✓ ... pays one item and leaves the unregistered one UNCLAIMED; duplicates are refused 40417ms
```

Findings:
- **Payouts does not replay a reused `PayPal-Request-Id`** the way Refunds do (D1-4). An identical
  retry with the same key is refused with **400 `USER_BUSINESS_ERROR`**, `details[0].field =
  "SENDER_BATCH_ID"`, and a `self` link to the original batch. A new key gets the same 400. So
  the duplicate protection is `sender_batch_id` itself (the spec: rejected for 30 days).
- **Danger fixed:** that 400 looks like a failure, but the original batch may have paid out.
  `createPayoutBatch` now follows the link, reads the original batch, checks its
  `sender_batch_id`, and returns it with `duplicate: true`. Other 400s still throw.
- Fees are per item (`payout_item_fee` $0.25 each) and add up to the batch `fees`.
- Payouts money is `{currency, value}`, not Orders/Refunds' `{currency_code, value}`.
- A batch of 2 settles (both items out of `PENDING`) in about 30–40 s in sandbox.

### Early cancel, retried once (2026-11-01) — still fails

`node --env-file-if-exists=.env.local scripts/payouts/cancel-item.ts MQR5FQGFWBUCU` (one attempt, no retries):

```
cancel run at 2026-11-01T06:12:06.464Z item=MQR5FQGFWBUCU
before {"status":"UNCLAIMED","error":"RECEIVER_UNREGISTERED","time_processed":"2026-10-31T14:03:25Z"}
cancel failed {"type":"PayPalUnknownOutcomeError","status":500,"issue":"INTERNAL_SERVICE_ERROR","debug_id":"f614854bd5931"}
after (read back) {"status":"UNCLAIMED","error":"RECEIVER_UNREGISTERED","time_processed":"2026-10-31T14:03:25Z"}
```

Third 500 across two days. **The product does not depend on early cancel**; returns come from
PayPal's 30-day rule. Unclaimed items now waiting to return, all $1.00:
`MQR5FQGFWBUCU` (processed 2026-10-31, so about Nov 30), `7DVXQR5XJHJF2` and `WUC3VU8LEEB7L`
(2026-11-01, about Dec 1). These land at the start of judging (Dec 1–15) and can feed a real
cy-près batch.

### The fee at real claim sizes (`scripts/payouts/fee-check.ts`, 2026-11-01)

Until now the $0.25 fee had only been seen on $1.00 items. Batch `GS2WKU3SB63TQ`:

```
batch SUCCESS amount 340.00 fees 0.75
  15.00 SUCCESS fee 0.25
  75.00 SUCCESS fee 0.25
  250.00 SUCCESS fee 0.25
```

Flat in the sandbox, from $1 to $250. This says nothing about live fees. `packages/distribute`
reserves a fee per item for sizing and takes actual fees from PayPal. Whether the fee comes back
when an unclaimed item returns is still unknown; the first returns are due about Nov 30.

## Spec corrections found while building

- `refund_request.custom_id` is `maxLength 127`, pattern `^.*$`
  (`docs/paypal-specs/payments_payment_v2.json`). The build spec said 255. The client enforces 127.

## Proof of Claim: Log in with PayPal (claimant identity, 2026-11-02)

Spec: `docs/paypal-specs/identity_v1.json`. Script: `scripts/identity/try-login.ts`. Enabled on
the `pushover-guarded` sandbox app with Return URL `https://example.com/rightfulshare/paypal-callback`,
"Account verification status" and "PayPal account ID (payer ID)" ticked, and logins from
unconfirmed emails **not** allowed. Logged in as po-buyer1 (Dana Reyes). Play money.

- Authorize at `https://www.sandbox.paypal.com/connect` with `flowEntry=static`, `response_type=code`,
  scopes `openid profile email address https://uri.paypal.com/services/paypalattributes`; the code
  came back on the Return URL with the same `state`.
- `POST /v1/oauth2/token` with `grant_type=authorization_code` and Basic auth: 200. **The token
  carries the app's whole scope list** (payments, refunds, vault, reporting…), not only the scopes
  asked for, so it must be used once for userinfo and then dropped: never stored or logged.
- `GET /v1/identity/openidconnect/userinfo?schema=openid`: 200 with `user_id`, `sub` (same value,
  93 chars), `name`, `email`, `verified`, **`payer_id`** (13 chars), `address`
  {street_address, locality, region, postal_code, country}, **`verified_account: true`**,
  `email_verified: true`.
- `GET /v1/identity/oauth2/userinfo?schema=paypalv1.1`: 200, the same fields, with `emails`
  [{value, primary, confirmed}] in place of `email`/`email_verified`/`verified`.
- **`payer_id` is not in the published schema** (`identity_v1.json` has no such property) but is
  returned when the payer-ID attribute is enabled. The claim form must treat it as required and
  fail closed if it is missing.
- A second login the same day returned the **same `payer_id`** (stable across logins).
- **Payouts to the `payer_id`** (`scripts/identity/pay-payer-id.ts`, $1.00 each, one item per
  batch, `recipient_type: PAYPAL_ID`):
  - Real `payer_id`: batch `89M2ZCBWVWU82`, item `9ZJXXN2QS8KBS` **`SUCCESS`**, fee $0.25; the
    item reads back with `recipient_type` `PAYPAL_ID` and the same receiver.
  - Made-up 13-character ID: batch `8SHCXHSRQ7FVJ` **`DENIED`**, item `WJXQ54EN77J3J` `FAILED`,
    `RECEIVER_ACCOUNT_INVALID`, fee $0.00, and the item's receiver reads back as zeros. The
    create call itself returned 201; the failure only shows on read-back.
  - So a claim can be paid to exactly the account that logged in, with no email to swap.
- Not yet tested: what an unverified account returns.

### Localhost as a Return URL (checked 2026-11-10)

`GET https://www.sandbox.paypal.com/connect?flowEntry=static&client_id=<guarded app>&response_type=code&scope=openid&redirect_uri=…`
with `redirect_uri=http://localhost:3100/api/paypal/callback` returns PayPal's generic error page,
whose links carry `invalid_redirect_uri` and "Invalid redirect_uri http://localhost:3100/…". The
same request with the Return URL already registered on the app
(`https://example.com/rightfulshare/paypal-callback`) shows the normal login and consent page.
Not tested: whether the dashboard would accept localhost as a Return URL at all. Either way the
live Log in with PayPal from the app is proved on the deployed URL (R12), and e2e signs the
identity cookie itself.

