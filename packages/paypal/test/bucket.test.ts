import { describe, expect, it } from "vitest";
import { SlidingWindowLimiter } from "../src/bucket.ts";

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("SlidingWindowLimiter", () => {
  it("never grants more than perMinute in any rolling 60 s window", async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowLimiter({ perMinute: 40, ...clock });
    const grants: number[] = [];
    for (let i = 0; i < 130; i++) {
      await limiter.take();
      grants.push(clock.now());
    }
    for (let i = 0; i < grants.length; i++) {
      const inWindow = grants.filter((t) => t >= grants[i]! && t < grants[i]! + 60_000).length;
      expect(inWindow).toBeLessThanOrEqual(40);
    }
    // 130 requests at 40 per minute need just over three minutes.
    expect(grants.at(-1)).toBe(180_000);
  });

  it("serves concurrent callers in order", async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowLimiter({ perMinute: 2, ...clock });
    const order: number[] = [];
    await Promise.all([0, 1, 2, 3].map((i) => limiter.take().then(() => order.push(i))));
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("rejects a nonsense rate", () => {
    expect(() => new SlidingWindowLimiter({ perMinute: 0 })).toThrow();
  });
});
