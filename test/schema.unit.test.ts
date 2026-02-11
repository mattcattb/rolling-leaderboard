import { describe, expect, test } from "bun:test";
import {
  LeaderboardQueryError,
  boardKeys,
  createMemoryLb,
  lbSchema,
  defineLbSchema,
  lbBoard,
  lbTimeframe,
} from "../src";

describe("schema + query api", () => {
  test("supports per-leaderboard timeframe definitions and top/bottom queries", async () => {
    const schema = defineLbSchema({
      prefix: "lb:test",
      timeframes: {
        day: { type: "rolling", unit: "day", size: 1 },
        lifetime: { type: "all" },
      },
      leaderboards: {
        profit: { aggregation: "sum", timeframes: ["day", "lifetime"] },
        best_streak: { aggregation: "max", timeframes: ["lifetime"] },
      },
      defaults: {
        leaderboard: "profit",
        timeframe: "lifetime",
        sort: "desc",
        limit: 25,
        maxLimit: 100,
      },
    });

    const runtime = createMemoryLb(schema);

    await runtime.write.ingest([
      ["u1", { profit: 15, best_streak: 5 }],
      ["u2", { profit: 30, best_streak: 2 }],
    ]);
    await runtime.write.rebuild(["day", "lifetime"]);

    const top = await runtime.query.list({
      leaderboard: "profit",
      timeframe: "day",
      direction: "desc",
      limit: 2,
    });

    expect(top.map((row) => row.userId)).toEqual(["u2", "u1"]);
    expect(top[0]?.score).toBe(30);
    // best_streak does not support "day", so hydration should be null for that board.
    expect(top[0]?.scores.best_streak).toBeNull();
  });

  test("gets a specific user rank + score + other leaderboard scores", async () => {
    const schema = defineLbSchema({
      timeframes: {
        day: { type: "rolling", unit: "day", size: 1 },
        lifetime: { type: "all" },
      },
      leaderboards: {
        profit: { aggregation: "sum", timeframes: ["day", "lifetime"] },
        best_streak: { aggregation: "max", timeframes: ["lifetime"] },
      },
      defaults: {
        leaderboard: "profit",
        timeframe: "lifetime",
      },
    });

    const runtime = createMemoryLb(schema);

    await runtime.write.ingest([
      ["u1", { profit: 15, best_streak: 5 }],
      ["u2", { profit: 30, best_streak: 2 }],
    ]);
    await runtime.write.rebuild(["day", "lifetime"]);

    const user = await runtime.query.user({
      leaderboard: "profit",
      timeframe: "day",
      userId: "u1",
    });

    expect(user).not.toBeNull();
    expect(user?.rank).toBe(2);
    expect(user?.score).toBe(15);
    expect(user?.scores.profit).toBe(15);
    expect(user?.scores.best_streak).toBeNull();
  });

  test("throws if querying a board/timeframe combination that is not defined", async () => {
    const schema = defineLbSchema({
      timeframes: {
        day: { type: "rolling", unit: "day", size: 1 },
        lifetime: { type: "all" },
      },
      leaderboards: {
        profit: { aggregation: "sum", timeframes: ["day", "lifetime"] },
        best_streak: { aggregation: "max", timeframes: ["lifetime"] },
      },
      defaults: {
        leaderboard: "profit",
        timeframe: "lifetime",
      },
    });

    const runtime = createMemoryLb(schema);

    await expect(
      runtime.query.list({
        leaderboard: "best_streak",
        timeframe: "day",
      }),
    ).rejects.toThrow(LeaderboardQueryError);
  });

  test("supports drizzle-like schema builder and derived board keys", () => {
    const schema = lbSchema({
      prefix: "lb:builder",
      timeframes: {
        day: lbTimeframe.rolling("day", 1),
        lifetime: lbTimeframe.all(),
      },
    })
      .leaderboards({
        profit: lbBoard.sum("day", "lifetime"),
        best_streak: lbBoard.max("lifetime"),
      })
      .defaults({
        leaderboard: "profit",
        timeframe: "lifetime",
      });

    const keys = boardKeys(schema);
    expect(keys).toEqual(["profit", "best_streak"]);
  });
});
