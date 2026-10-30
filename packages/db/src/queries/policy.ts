import type { Queryable } from "../pool.ts";
import type { Policy } from "../types.ts";

export async function getActivePolicy(db: Queryable): Promise<Policy> {
  const { rows } = await db.query<{
    version: number; window_days: number; human_threshold_cents: number;
    daily_cap_cents: number; velocity_max: number; velocity_window_days: number;
  }>("SELECT version, window_days, human_threshold_cents, daily_cap_cents, velocity_max, velocity_window_days FROM policy WHERE active");
  const r = rows[0];
  if (!r) throw new Error("no active policy row");
  return {
    version: r.version,
    windowDays: r.window_days,
    humanThresholdCents: r.human_threshold_cents,
    dailyCapCents: r.daily_cap_cents,
    velocityMax: r.velocity_max,
    velocityWindowDays: r.velocity_window_days,
  };
}
