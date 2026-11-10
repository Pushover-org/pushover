// Writes docs/openapi.json from the API's zod schemas (plan item P15). Run after changing
// apps/web/lib/api/schemas.ts:   pnpm openapi
// The drift test (apps/web/lib/api/openapi.test.ts) fails until the file matches.
import { writeFileSync } from "node:fs";
import { openApiText } from "../lib/api/openapi.ts";

const out = new URL("../../../docs/openapi.json", import.meta.url);
writeFileSync(out, openApiText());
console.log(`wrote ${out.pathname}`);
