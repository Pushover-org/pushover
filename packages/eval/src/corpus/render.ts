// Draws a rendered receipt (H2, F2, F3, F7) from its truth record, so the image shows exactly
// what receipts.jsonl says it shows. SVG through sharp (librsvg), the same route R7 used; the
// spec's Playwright would add a browser for no gain here. Fonts come from the machine, so the
// pixels can differ between laptops; the facts on the receipt cannot.
import sharp from "sharp";
import type { ReceiptTruth } from "./schema.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const usDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

const FONTS = ["DejaVu Sans Mono, monospace", "Fira Mono, monospace", "Courier, monospace"];
const PAPER = ["#fbfaf5", "#f7f6f0", "#fdfdfb"];

/** Small, stable variety per receipt, so the fakes do not all look alike. */
function styleFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { font: FONTS[h % FONTS.length] ?? FONTS[0], paper: PAPER[(h >> 3) % PAPER.length] ?? PAPER[0], width: 460 + ((h >> 5) % 5) * 20 };
}

export function receiptSvg(r: ReceiptTruth): string {
  const st = styleFor(r.id);
  const W = st.width;
  const right = W - 40;
  const rows: string[] = [];
  let y = 56;
  const center = (t: string, size = 22, weight = "normal") => {
    rows.push(`<text x="${W / 2}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="middle">${esc(t)}</text>`);
    y += size + 10;
  };
  const pair = (l: string, rgt: string, extra = "") => {
    rows.push(`<text x="40" y="${y}" font-size="20"${extra}>${esc(l)}</text><text x="${right}" y="${y}" font-size="20" text-anchor="end"${extra}>${esc(rgt)}</text>`);
    y += 32;
  };
  const rule = () => {
    rows.push(`<line x1="40" x2="${right}" y1="${y - 14}" y2="${y - 14}" stroke="#555" stroke-dasharray="6 4"/>`);
    y += 10;
  };

  if (r.merchant) center(r.merchant, 26, "bold");
  for (const part of (r.address ?? "").split(", ").reduce<string[]>((acc, p, i, all) => (i % 2 === 0 ? [...acc, all.slice(i, i + 2).join(", ")] : acc), [])) if (part) center(part, 18);
  y += 8;
  if (r.date) pair(`Date: ${usDate(r.date)}`, "Dine In");
  rule();
  for (const l of r.lines) pair(`${l.qty !== null ? `${l.qty} ` : ""}${l.desc}`, l.line_total_cents === null ? "" : money(l.line_total_cents));
  for (const a of r.adjustments.filter((x) => x.position === "before_subtotal")) pair(a.desc, money(a.cents));
  rule();
  if (r.subtotal_cents !== null) pair("Subtotal", money(r.subtotal_cents));
  if (r.tax_cents !== null) pair("Tax", money(r.tax_cents));
  for (const a of r.adjustments.filter((x) => x.position === "after_subtotal")) pair(a.desc, money(a.cents));
  if (r.total_cents !== null) {
    if (r.edited) {
      // A pasted-over total: a patch of slightly different paper and a different, larger font.
      rows.push(`<rect x="${right - 150}" y="${y - 30}" width="160" height="40" fill="#ffffff" stroke="#e8e8e8"/>`);
      rows.push(`<text x="40" y="${y}" font-size="24" font-weight="bold">TOTAL</text><text x="${right - 2}" y="${y + 2}" font-size="27" font-family="DejaVu Serif, serif" text-anchor="end">${money(r.total_cents)}</text>`);
      y += 40;
    } else {
      rows.push(`<text x="40" y="${y}" font-size="24" font-weight="bold">TOTAL</text><text x="${right}" y="${y}" font-size="24" font-weight="bold" text-anchor="end">${money(r.total_cents)}</text>`);
      y += 40;
    }
  }
  y += 20;
  if (r.injected_text) for (const line of r.injected_text.split("\n")) center(line, 22, "bold");
  center("THANK YOU!", 20);
  const H = y + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${st.paper}"/><g font-family="${st.font}" fill="#222">${rows.join("")}</g></svg>`;
}

export async function renderReceipt(r: ReceiptTruth): Promise<Buffer> {
  if (r.source !== "render") throw new Error(`${r.id} is a real photo, not a rendered receipt`);
  return sharp(Buffer.from(receiptSvg(r))).jpeg({ quality: 88 }).toBuffer();
}
