import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createLeaderboardService } from "../src/service";
import { RedisLeaderboardStore } from "../src/adapters";
import type { MetadataPort, UsernamePort } from "../src/ports";
import { createRedisInfra, type RedisTestInfra } from "./infra";

const enabled = process.env.RUN_INTEGRATION === "1" || process.env.CI === "true";

describe("rolling leaderboard integration", () => {
  if (!enabled) {
    test("integration disabled", () => {
      expect(true).toBe(true);
    });
    return;
  }

  let infra: RedisTestInfra;

  beforeAll(async () => {
    infra = await createRedisInfra();
  });

  afterAll(async () => {
    await infra.stop();
  });

  beforeEach(async () => {
    await infra.clear();
  });

  test("ranks users, resolves usernames/metadata, and returns current user", async () => {
    type Category = "profit" | "wagered";
    type Timeframe = "24h";
    type Metadata = { profileTier: string };

    const store = new RedisLeaderboardStore<Category, Timeframe>(infra.client, {
      prefix: "test:lb",
      categories: ["profit", "wagered"],
      timeframes: ["24h"],
    });

    const usernames: UsernamePort = {
      async getUsernames(userIds: string[]) {
        const values = await infra.client.hmGet("test:usernames", userIds);
        const out = new Map<string, string>();
        userIds.forEach((id, i) => {
          const name = values[i];
          if (name) out.set(id, name);
        });
        return out;
      },
    };

    const metadata: MetadataPort<Timeframe, Metadata> = {
      async getMetadata(_timeframe: Timeframe, userIds: string[]) {
        const values = await infra.client.hmGet("test:meta", userIds);
        const out = new Map<string, Metadata>();
        userIds.forEach((id, i) => {
          const raw = values[i];
          if (raw) out.set(id, JSON.parse(raw));
        });
        return out;
      },
    };

    await infra.client.hSet("test:usernames", {
      u1: "alice",
      u2: "bob",
      u3: "carol",
    });
    await infra.client.hSet("test:meta", {
      u1: JSON.stringify({ profileTier: "gold" }),
      u2: JSON.stringify({ profileTier: "silver" }),
    });

    const service = createLeaderboardService<Category, Timeframe, Metadata>(
      {
        categories: ["profit", "wagered"],
        defaultCategory: "profit",
        timeframes: ["24h"],
        defaultTimeframe: "24h",
        defaultLimit: 25,
      },
      { store, usernames, metadata },
    );

    await service.ingest([
      ["u1", { profit: 100, wagered: 300 }],
      ["u2", { profit: 120, wagered: 200 }],
      ["u3", { profit: 80, wagered: 500 }],
    ]);
    await service.rebuild(["24h"]);

    const result = await service.getLeaderboard(
      { orderBy: "profit", timeframe: "24h" },
      "u1",
    );

    expect(result.entries.length).toBe(3);
    expect(result.entries[0]?.userId).toBe("u2");
    expect(result.entries[0]?.username).toBe("bob");
    expect(result.entries[0]?.scores.profit).toBe(120);
    expect(result.entries[0]?.metadata).toEqual({ profileTier: "silver" });

    expect(result.user?.userId).toBe("u1");
    expect(result.user?.rank).toBe(2);
  });

  test("applies limit guardrails", async () => {
    type Category = "profit";
    type Timeframe = "24h";

    const store = new RedisLeaderboardStore<Category, Timeframe>(infra.client, {
      prefix: "test:lb:limits",
      categories: ["profit"],
      timeframes: ["24h"],
    });

    const service = createLeaderboardService<Category, Timeframe>(
      {
        categories: ["profit"],
        defaultCategory: "profit",
        timeframes: ["24h"],
        defaultTimeframe: "24h",
        defaultLimit: 5,
        maxLimit: 10,
      },
      { store },
    );

    await service.ingest(
      Array.from({ length: 20 }).map((_, i) => [
        `u${i + 1}`,
        { profit: 100 - i },
      ]),
    );
    await service.rebuild(["24h"]);

    const capped = await service.getLeaderboard({
      timeframe: "24h",
      orderBy: "profit",
      limit: 999,
    });

    expect(capped.entries.length).toBe(10);
  });

  test("supports max aggregation with custom rolling source keys", async () => {
    type Category = "profit" | "max_multiplier";
    type Timeframe = "24h";

    const hour = (n: number) => new Date(Date.UTC(2026, 0, 1, n, 0, 0));
    const resolveBuildSourceKeys = ({
      timeframe,
      category,
    }: {
      timeframe: Timeframe;
      category: Category;
      date: Date;
    }) => {
      if (timeframe !== "24h") return [];
      return [
        `rolling:${category}:h0`,
        `rolling:${category}:h1`,
        `rolling:${category}:h2`,
      ];
    };

    const store = new RedisLeaderboardStore<Category, Timeframe>(infra.client, {
      prefix: "test:lb:rolling",
      categories: ["profit", "max_multiplier"],
      timeframes: ["24h"],
      categoryAggregation: { profit: "sum", max_multiplier: "max" },
      resolveIngestKeys: ({ category, date }) => [
        `rolling:${category}:h${date.getUTCHours()}`,
      ],
      resolveBuildSourceKeys,
      resolveRankKey: ({ timeframe, category }) => `rank:${timeframe}:${category}`,
    });

    const service = createLeaderboardService<Category, Timeframe>(
      {
        categories: ["profit", "max_multiplier"],
        defaultCategory: "profit",
        timeframes: ["24h"],
        defaultTimeframe: "24h",
      },
      { store },
    );

    await service.ingest(
      [
        ["u1", { profit: 10, max_multiplier: 20 }],
        ["u2", { profit: 20, max_multiplier: 5 }],
      ],
      hour(0),
    );
    await service.ingest(
      [
        ["u1", { profit: 7, max_multiplier: 8 }],
        ["u2", { profit: 4, max_multiplier: 50 }],
      ],
      hour(1),
    );
    await service.ingest(
      [
        ["u1", { profit: 3, max_multiplier: 40 }],
        ["u2", { profit: 2, max_multiplier: 7 }],
      ],
      hour(2),
    );

    await service.rebuild(["24h"]);

    const byProfit = await service.getLeaderboard({
      timeframe: "24h",
      orderBy: "profit",
    });
    expect(byProfit.entries[0]?.userId).toBe("u2");
    expect(byProfit.entries[0]?.scores.profit).toBe(26);
    expect(byProfit.entries[1]?.scores.profit).toBe(20);

    const byMax = await service.getLeaderboard({
      timeframe: "24h",
      orderBy: "max_multiplier",
    });
    expect(byMax.entries[0]?.userId).toBe("u2");
    expect(byMax.entries[0]?.scores.max_multiplier).toBe(50);
    expect(byMax.entries[1]?.scores.max_multiplier).toBe(40);
  });
});
