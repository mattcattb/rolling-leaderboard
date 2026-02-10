import { describe, expect, test } from "bun:test";
import { createLeaderboardService, LeaderboardConfigError, LeaderboardQueryError } from "../src/service";
import { createMemoryLeaderboardStore } from "../src/adapters";

describe("rolling leaderboard service (unit)", () => {
  test("throws on invalid config defaults", () => {
    const store = createMemoryLeaderboardStore({
      categories: ["profit"] as const,
      timeframes: ["24h"] as const,
    });

    expect(() =>
      createLeaderboardService(
        {
          categories: ["profit"] as const,
          defaultCategory: "profit",
          timeframes: ["24h"] as const,
          defaultTimeframe: "7d" as "24h",
        },
        { store },
      ),
    ).toThrow(LeaderboardConfigError);
  });

  test("throws on unknown query category/timeframe", async () => {
    const store = createMemoryLeaderboardStore({
      categories: ["profit"] as const,
      timeframes: ["24h"] as const,
    });

    const service = createLeaderboardService(
      {
        categories: ["profit"] as const,
        defaultCategory: "profit",
        timeframes: ["24h"] as const,
        defaultTimeframe: "24h",
      },
      { store },
    );

    await expect(
      service.getLeaderboard({
        orderBy: "wagered" as "profit",
        timeframe: "24h",
      }),
    ).rejects.toThrow(LeaderboardQueryError);

    await expect(
      service.getLeaderboard({
        orderBy: "profit",
        timeframe: "7d" as "24h",
      }),
    ).rejects.toThrow(LeaderboardQueryError);
  });

  test("supports in-memory adapter for local/demo usage", async () => {
    const store = createMemoryLeaderboardStore({
      categories: ["profit", "wagered"] as const,
      timeframes: ["24h"] as const,
    });

    const service = createLeaderboardService(
      {
        categories: ["profit", "wagered"] as const,
        defaultCategory: "profit",
        timeframes: ["24h"] as const,
        defaultTimeframe: "24h",
      },
      { store },
    );

    await service.ingest([
      ["u1", { profit: 10, wagered: 50 }],
      ["u2", { profit: 20, wagered: 30 }],
    ]);
    await service.rebuild(["24h"]);

    const result = await service.getLeaderboard({
      timeframe: "24h",
      orderBy: "profit",
    });

    expect(result.entries.map((entry) => entry.userId)).toEqual(["u2", "u1"]);
    expect(result.entries[0]?.scores.wagered).toBe(30);
  });
});
