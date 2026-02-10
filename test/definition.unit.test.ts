import { describe, expect, test } from "bun:test";
import {
  createRedisConfigFromDefinition,
  createServiceConfigFromDefinition,
  defineLeaderboard,
} from "../src/definition";

describe("definition helpers", () => {
  test("derives service and redis config from one definition", () => {
    const definition = defineLeaderboard({
      categories: [
        { key: "points", aggregation: "sum" },
        { key: "best_streak", aggregation: "max" },
      ] as const,
      timeframes: ["day", "week"] as const,
      defaultCategory: "points",
      defaultTimeframe: "day",
      defaultLimit: 20,
      maxLimit: 100,
    });

    const serviceConfig = createServiceConfigFromDefinition(definition);
    expect(serviceConfig.categories).toEqual(["points", "best_streak"]);
    expect(serviceConfig.timeframes).toEqual(["day", "week"]);
    expect(serviceConfig.defaultCategory).toBe("points");
    expect(serviceConfig.defaultTimeframe).toBe("day");

    const redisConfig = createRedisConfigFromDefinition(definition, {
      prefix: "leaderboard:engagement",
    });
    expect(redisConfig.categories).toEqual(["points", "best_streak"]);
    expect(redisConfig.timeframes).toEqual(["day", "week"]);
    expect(redisConfig.categoryAggregation).toEqual({
      points: "sum",
      best_streak: "max",
    });
  });
});
