import { describe, expect, test } from "bun:test";
import { lbBoard, lbQuerySchema, lbSchema, lbTimeframe } from "../src";

describe("zod query schema", () => {
  const definition = lbSchema({
    prefix: "lb:zod",
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
      sort: "desc",
      limit: 20,
      maxLimit: 100,
    });

  test("applies defaults for user query", () => {
    const schema = lbQuerySchema(definition);
    const parsed = schema.user.parse({ userId: "u1" });

    expect(parsed.leaderboard).toBe("profit");
    expect(parsed.timeframe).toBe("lifetime");
    expect(parsed.direction).toBe("desc");
  });

  test("rejects unsupported board/timeframe pairs", () => {
    const schema = lbQuerySchema(definition);

    const result = schema.list.safeParse({
      leaderboard: "best_streak",
      timeframe: "day",
      limit: 10,
    });

    expect(result.success).toBeFalse();
  });

  test("enforces max limit", () => {
    const schema = lbQuerySchema(definition);

    const result = schema.list.safeParse({
      leaderboard: "profit",
      timeframe: "day",
      limit: 101,
    });

    expect(result.success).toBeFalse();
  });
});
