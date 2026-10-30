import type { Queryable } from "../pool.ts";
import type { Customer, Merchant } from "../types.ts";

export async function upsertCustomer(db: Queryable, c: Customer): Promise<void> {
  await db.query(
    `INSERT INTO customers (merchant, id, display_name, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (merchant, id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email`,
    [c.merchant, c.id, c.displayName, c.email],
  );
}

export async function getCustomer(db: Queryable, merchant: Merchant, id: string): Promise<Customer | null> {
  const { rows } = await db.query<{ merchant: Merchant; id: string; display_name: string; email: string }>(
    "SELECT merchant, id, display_name, email FROM customers WHERE merchant = $1 AND id = $2",
    [merchant, id],
  );
  const r = rows[0];
  return r ? { merchant: r.merchant, id: r.id, displayName: r.display_name, email: r.email } : null;
}
