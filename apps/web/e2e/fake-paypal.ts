// A stand-in for PayPal's sandbox during e2e: OAuth, create a payout batch, read it back. Shapes
// follow the batch we recorded from the real sandbox (packages/paypal/test/fixtures/
// payout-batch-7ZRZDZZLRGEAY.json). Every item reads back SUCCESS with a $0.25 fee.
import { createServer, type Server } from "node:http";

interface Item {
  recipient_type: string;
  receiver: string;
  sender_item_id: string;
  amount: { currency: string; value: string };
  note?: string;
}

export async function startFakePayPal(port: number): Promise<{ close: () => Promise<void>; batches: Map<string, { header: unknown; items: Item[] }> }> {
  const batches = new Map<string, { header: { sender_batch_id: string }; items: Item[] }>();
  let n = 0;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json", "paypal-debug-id": "e2e" });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/v1/oauth2/token") return send(200, { access_token: "e2e-token", token_type: "Bearer", expires_in: 32400 });
      // Shaped like the sandbox's answer: a balance as of a couple of hours ago.
      if (req.method === "GET" && url.pathname === "/v1/reporting/balances") {
        const value = { currency_code: "USD", value: "6387.15" };
        return send(200, { balances: [{ currency: "USD", total_balance: value, available_balance: value, withheld_balance: { currency_code: "USD", value: "0.00" } }], as_of_time: new Date(Date.now() - 2 * 3_600_000).toISOString() });
      }
      if (req.method === "POST" && url.pathname === "/v1/payments/payouts") {
        const body = JSON.parse(raw) as { sender_batch_header: { sender_batch_id: string }; items: Item[] };
        const id = `E2EBATCH${++n}`;
        batches.set(id, { header: body.sender_batch_header, items: body.items });
        return send(201, { batch_header: { payout_batch_id: id, batch_status: "PENDING", sender_batch_header: body.sender_batch_header } });
      }
      const get = /^\/v1\/payments\/payouts\/([A-Z0-9]+)$/.exec(url.pathname);
      if (req.method === "GET" && get) {
        const id = get[1] ?? "";
        const b = batches.get(id);
        if (!b) return send(404, { name: "RESOURCE_NOT_FOUND" });
        const fee = (0.25 * b.items.length).toFixed(2);
        return send(200, {
          total_items: b.items.length, total_pages: 1,
          batch_header: { payout_batch_id: id, batch_status: "SUCCESS", sender_batch_header: b.header, fees: { currency: "USD", value: fee } },
          items: b.items.map((it, i) => ({
            payout_item_id: `${id}I${i}`, payout_batch_id: id, transaction_status: "SUCCESS", payout_item_fee: { currency: "USD", value: "0.25" },
            // The sandbox returns each item's note as sent (docs/sandbox-findings.md, batch JX2JYNCASDVQG).
            payout_item: { recipient_type: it.recipient_type, receiver: it.receiver, sender_item_id: it.sender_item_id, amount: it.amount, ...(it.note ? { note: it.note } : {}) },
          })),
        });
      }
      send(404, { name: "NOT_FAKED", message: `${req.method} ${url.pathname}` });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { close: () => new Promise((resolve) => server.close(() => resolve())), batches };
}
