"use server";
// A supervisor opens a new (fictional, sandbox) settlement (plan item P18). The configuration is
// validated by the same schema the desk uses; nothing is stored unless it passes.
import { parseSettlement, SettlementSchema } from "@proofofclaim/claims";
import { appendAudit, insertSettlement } from "@proofofclaim/db";
import { redirect } from "next/navigation";
import { requireAnalyst } from "@/lib/server/auth.ts";
import { pool } from "@/lib/server/data.ts";

const cents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/[$,\s]/g, "")) * 100);
const text = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function createSettlement(_prev: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  const analyst = await requireAnalyst("/admin/new");
  if (analyst.role !== "supervisor") return { error: "Only a supervisor can open a settlement." };
  const closes = text(form.get("closesOn"));
  const name = text(form.get("name"));
  const cyName = text(form.get("cyPresName"));
  const candidate = {
    id: text(form.get("id")).toLowerCase(),
    // Every settlement on this sandbox desk is fictional (spec rule 8), and says so.
    name: /\(fictional demo\)/i.test(name) ? name : `${name} (fictional demo)`,
    demo: true,
    currency: "USD",
    fundCents: cents(form.get("fund")),
    adminReserveCents: cents(form.get("reserve")),
    classPeriod: { start: text(form.get("periodStart")), end: text(form.get("periodEnd")) },
    products: [{ id: text(form.get("productId")).toLowerCase(), name: text(form.get("productName")), description: text(form.get("productDescription")) }],
    geography: { states: form.getAll("states").map(String) },
    tiers: { proof: { unitCents: cents(form.get("unit")), maxUnits: Number(form.get("maxUnits")) }, noProof: { flatCents: cents(form.get("flat")) } },
    cyPres: { name: /\((fictional )?demo\)/i.test(cyName) ? cyName : `${cyName} (demo)`, payoutEmail: text(form.get("cyPresEmail")) },
    ...(closes ? { filing: { closesAt: new Date(`${closes}T23:59:59.000Z`).toISOString(), decideAfterClose: form.get("decideAfterClose") === "on" } } : {}),
  };
  const parsed = SettlementSchema.safeParse(candidate);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: `Check ${i?.path.join(".") || "the form"}: ${i?.message ?? "invalid"}.` };
  }
  const s = parseSettlement(parsed.data);
  const exists = await pool().query("SELECT 1 FROM settlements WHERE id = $1", [s.id]);
  if (exists.rowCount) return { error: `A settlement with the ID "${s.id}" already exists.` };
  await insertSettlement(pool(), s);
  await appendAudit(pool(), { actor: `analyst:${analyst.email}`, action: "settlement_created", subject: s.id, detail: { fund_cents: s.fundCents, states: s.geography.states.length } });
  redirect(`/admin/${s.id}`);
}
