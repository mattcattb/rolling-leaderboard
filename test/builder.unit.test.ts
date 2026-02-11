import { describe, expect, test } from "bun:test";
import { LeaderboardConfigError } from "../src/service";
import { leaderboard } from "../src/builder";

describe("leaderboard builder", () => {
  test("builds a typed blueprint and provides ergonomic runtime methods", async () => {
    const schema = leaderboard("engagement")
      .sum("points")
      .max("best_streak")
      .rolling("day", { unit: "hour", size: 24 })
      .allTime("lifetime")
      .defaults({
        metric: "points",
        timeframe: "day",
        limit: 25,
      })
      .build();

    const engine = schema.createMemoryEngine();

    await engine.insert("u1", { points: 10, best_streak: 4 });
    await engine.update("u1", { points: 5, best_streak: 6 });
    await engine.insertMany([["u2", { points: 20, best_streak: 3 }]]);
    await engine.refresh(["day", "lifetime"]);

    const byPoints = await engine.select({
      timeframe: "day",
      orderBy: "points",
    });
    expect(byPoints.entries[0]?.userId).toBe("u2");

    const byBestStreak = await engine.select({
      timeframe: "lifetime",
      orderBy: "best_streak",
    });
    expect(byBestStreak.entries[0]?.userId).toBe("u1");
  });

  test("supports build(defaults) when defaults are not set in chain", () => {
    const schema = leaderboard("activity")
      .metric("score", { aggregation: "sum" })
      .rolling("day", { unit: "day", size: 1 })
      .build({
        metric: "score",
        timeframe: "day",
      });

    expect(schema.metricKeys()).toEqual(["score"]);
    expect(schema.timeframeKeys()).toEqual(["day"]);
    expect(schema.bundle().service.defaultCategory).toBe("score");
  });

  test("throws on duplicate metric and timeframe definitions", () => {
    expect(() =>
      leaderboard("dupe")
        .sum("points")
        .metric("points", { aggregation: "sum" }),
    ).toThrow(LeaderboardConfigError);

    expect(() =>
      leaderboard("dupe")
        .rolling("day", { unit: "hour", size: 24 })
        .allTime("day"),
    ).toThrow(LeaderboardConfigError);
  });
});
