// Railway runs this as the web service's preDeploy command; a non-zero exit stops the deploy.
import { migrate } from "../migrate.ts";
import { createPool } from "../pool.ts";

const pool = createPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "schema up to date");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
