import { describe, expect, test } from "bun:test";
import { defineDeclarativeLeaderboard, createRedisLeaderboardEngineFromDeclarative } from "../src/declarative";
import { createMemoryLeaderboardStore } from "../src/adapters";
import { createLeaderboardService } from "../src/service";

describe("declarative leaderboard", () => {
  test("derives keys and service config from declarative definition", async () => {
    const definition = defineDeclarativeLeaderboard({
      prefix: "lb",
      metrics: {
        points: { aggregation: "sum" },
        best_streak: { aggregation: "max" },
      },
      timeframes: {
        day: { type: "rolling", unit: "hour", size: 24 },
        lifetime: { type: "all" },
      },
      defaults: {
        metric: "points",
        timeframe: "lifetime",
        limit: 25,
        maxLimit: 100,
      },
    });

    const fakeClient = {
      multi() {
        return {
          zIncrBy() {},
          zAdd() {},
          zUnionStore() {},
          expire() {},
          del() {},
          zmScore() {},
          async exec() {},
          async execAsPipeline() {
            return [];
          },
        };
      },
      async ttl() {
        return 0;
      },
      async zRangeWithScores() {
        return [];
      },
      async zRevRank() {
        return null;
      },
      async zRank() {
        return null;
      },
      async zScore() {
        return null;
      },
    };

    const built = createRedisLeaderboardEngineFromDeclarative(
      // Keep this test unit-level; we validate shape/typing, not redis behavior.
      fakeClient as any,
      definition,
      {},
    );

    expect(built.service).toBeDefined();
    expect(built.keys.rank("day", "points")).toBe("lb:ranking:day:points");
    expect(built.keys.metadata("lifetime")).toBe("lb:meta:lifetime");
    expect(built.keys.names()).toBe("lb:names");
  });

  test("works with plain createLeaderboardService via derived metric keys", async () => {
    const definition = defineDeclarativeLeaderboard({
      metrics: {
        score: { aggregation: "sum" },
      },
      timeframes: {
        day: { type: "rolling", unit: "day", size: 1 },
      },
      defaults: {
        metric: "score",
        timeframe: "day",
      },
    });

    const store = createMemoryLeaderboardStore({
      categories: ["score"] as const,
      timeframes: ["day"] as const,
    });

    const service = createLeaderboardService(
      {
        categories: ["score"] as const,
        defaultCategory: definition.defaults.metric,
        timeframes: ["day"] as const,
        defaultTimeframe: definition.defaults.timeframe,
      },
      { store },
    );

    await service.ingest([["u1", { score: 10 }]]);
    await service.rebuild(["day"]);
    const res = await service.getLeaderboard({ timeframe: "day", orderBy: "score" });
    expect(res.entries[0]?.userId).toBe("u1");
  });
});
