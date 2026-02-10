import { describe, expect, test } from "bun:test";
import { createWindowedLeaderboardRedisConfig } from "../src/windowed";

describe("windowed redis config", () => {
  test("builds redis config and key helpers from a window strategy", () => {
    const built = createWindowedLeaderboardRedisConfig({
      prefix: "lb",
      categories: ["points", "best_streak"] as const,
      timeframes: ["day", "week"] as const,
      windows: ["h", "d", "all"] as const,
      isComparisonCategory: (category) => category === "best_streak",
      shouldIngestForTimeframe: (timeframe) => timeframe === "day",
      getBuildWindowSources: (timeframe) =>
        timeframe === "day"
          ? [{ window: "h", date: new Date("2026-01-01T00:00:00.000Z") }]
          : [{ window: "d", date: new Date("2026-01-01T00:00:00.000Z") }],
      formatWindowKey: (prefix, window, _date, category) =>
        `${prefix}:window:${window}:${category}`,
    });

    expect(built.redis.categoryAggregation).toEqual({
      points: "sum",
      best_streak: "max",
    });
    expect(built.keys.rank("day", "points")).toBe("lb:ranking:day:points");
    expect(
      built.redis.resolveIngestKeys?.({
        timeframe: "day",
        category: "points",
        date: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toEqual([
      "lb:window:h:points",
      "lb:window:d:points",
      "lb:window:all:points",
    ]);
    expect(
      built.redis.resolveBuildSourceKeys?.({
        timeframe: "week",
        category: "points",
        date: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toEqual(["lb:window:d:points"]);
  });
});
