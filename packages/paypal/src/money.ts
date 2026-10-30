/** Integer cents → PayPal amount string ("86.40"). Refunds are never zero or negative. */
export function centsToValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error(`invalid cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const VALUE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** PayPal amount string → integer cents. Throws on anything that is not a plain USD amount. */
export function valueToCents(value: string): number {
  const m = VALUE.exec(value);
  if (!m) throw new Error(`invalid PayPal amount: ${JSON.stringify(value)}`);
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`amount out of range: ${value}`);
  return cents;
}
