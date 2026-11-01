// pnpm receipts:download. Fetches the ExpressExpense zip, checks its md5, and unzips the images
// into a git-ignored folder. Safe to re-run: it stops early if the images are already there.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMd5, assertSafeEntries, DATASET } from "./dataset.ts";

mkdirSync(DATASET.outDir, { recursive: true });
const present = readdirSync(DATASET.outDir).filter((f) => f.endsWith(".jpg")).length;
if (present === DATASET.files) {
  console.log(`${DATASET.outDir}: ${present} images already present, nothing to do`);
} else {
  const res = await fetch(DATASET.zipUrl);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} from ${DATASET.zipUrl}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assertMd5(bytes, DATASET.md5);
  console.log(`downloaded ${bytes.length} bytes, md5 ${DATASET.md5} OK`);

  const tmp = mkdtempSync(join(tmpdir(), "receipts-"));
  try {
    const zip = join(tmp, "receipts.zip");
    writeFileSync(zip, bytes);
    const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);
    assertSafeEntries(names);
    execFileSync("unzip", ["-q", "-o", zip, "-d", DATASET.outDir]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const count = readdirSync(DATASET.outDir).filter((f) => f.endsWith(".jpg")).length;
  if (count !== DATASET.files) throw new Error(`expected ${DATASET.files} images, found ${count}`);
  console.log(`${DATASET.outDir}: ${count} images`);
}
