import type { LeaderboardStorePort } from "../ports";
import type {
  LeaderboardDelta,
  LeaderboardScores,
  RankedUser,
} from "../types";

export type LeaderboardAggregation = "sum" | "max" | "min";

export type RedisLeaderboardClient = {
  multi: () => {
    zIncrBy: (key: string, increment: number, member: string) => unknown;
    zAdd: (
      key: string,
      members: Array<{ value: string; score: number }>,
      options?: { GT?: boolean; LT?: boolean },
    ) => unknown;
    zUnionStore: (
      destination: string,
      keys: [string, ...string[]] | string[],
      options: { AGGREGATE: "SUM" | "MIN" | "MAX" },
    ) => unknown;
    expire: (key: string, ttlSeconds: number) => unknown;
    del: (key: string) => unknown;
    zmScore: (key: string, members: string[]) => unknown;
    exec: () => Promise<unknown>;
    execAsPipeline: () => Promise<unknown>;
  };
  ttl: (key: string) => Promise<number>;
  zRangeWithScores: (
    key: string,
    start: number,
    stop: number,
    options?: { REV?: boolean },
  ) => Promise<Array<{ value: string; score: number }>>;
  zRevRank: (key: string, member: string) => Promise<number | null>;
  zRank: (key: string, member: string) => Promise<number | null>;
  zScore: (key: string, member: string) => Promise<number | null>;
};

export type RedisStoreConfig<TCategory extends string, TTimeframe extends string> = {
  prefix: string;
  categories: readonly TCategory[];
  timeframes: readonly TTimeframe[];
  categoryAggregation?: Partial<Record<TCategory, LeaderboardAggregation>>;
  resolveIngestKeys?: (ctx: {
    timeframe: TTimeframe;
    category: TCategory;
    date: Date;
  }) => string[];
  resolveBuildSourceKeys?: (ctx: {
    timeframe: TTimeframe;
    category: TCategory;
    date: Date;
  }) => string[];
  resolveRankKey?: (ctx: { timeframe: TTimeframe; category: TCategory }) => string;
  resolveWindowTtlSeconds?: (ctx: {
    timeframe: TTimeframe;
    category: TCategory;
    date: Date;
  }) => number | null | undefined;
};

export class RedisLeaderboardStore<
  TCategory extends string,
  TTimeframe extends string,
> implements LeaderboardStorePort<TCategory, TTimeframe>
{
  constructor(
    private client: RedisLeaderboardClient,
    private config: RedisStoreConfig<TCategory, TTimeframe>,
  ) {}

  private windowKey(timeframe: TTimeframe, category: TCategory): string {
    return `${this.config.prefix}:window:${timeframe}:${category}`;
  }

  private rankKey(timeframe: TTimeframe, category: TCategory): string {
    return `${this.config.prefix}:rank:${timeframe}:${category}`;
  }

  private resolveRankKey(timeframe: TTimeframe, category: TCategory): string {
    return (
      this.config.resolveRankKey?.({ timeframe, category }) ??
      this.rankKey(timeframe, category)
    );
  }

  private resolveIngestKeys(
    timeframe: TTimeframe,
    category: TCategory,
    date: Date,
  ): string[] {
    return (
      this.config.resolveIngestKeys?.({ timeframe, category, date }) ?? [
        this.windowKey(timeframe, category),
      ]
    );
  }

  private resolveBuildSourceKeys(
    timeframe: TTimeframe,
    category: TCategory,
    date: Date,
  ): string[] {
    return (
      this.config.resolveBuildSourceKeys?.({ timeframe, category, date }) ?? [
        this.windowKey(timeframe, category),
      ]
    );
  }

  private aggregationForCategory(category: TCategory): LeaderboardAggregation {
    return this.config.categoryAggregation?.[category] ?? "sum";
  }

  private aggregateOption(category: TCategory): "SUM" | "MIN" | "MAX" {
    const strategy = this.aggregationForCategory(category);
    if (strategy === "max") return "MAX";
    if (strategy === "min") return "MIN";
    return "SUM";
  }

  async ingestWindows(
    entries: Array<[string, LeaderboardDelta<TCategory>]>,
    date: Date = new Date(),
  ): Promise<void> {
    const multi = this.client.multi();

    for (const timeframe of this.config.timeframes) {
      for (const category of this.config.categories) {
        const keys = this.resolveIngestKeys(timeframe, category, date);
        if (keys.length === 0) continue;
        const strategy = this.aggregationForCategory(category);

        for (const key of keys) {
          for (const [userId, delta] of entries) {
            const value = delta[category] ?? 0;
            if (value === 0) continue;

            if (strategy === "sum") {
              multi.zIncrBy(key, value, userId);
            } else if (strategy === "max") {
              multi.zAdd(key, [{ value: userId, score: value }], { GT: true });
            } else {
              multi.zAdd(key, [{ value: userId, score: value }], { LT: true });
            }
          }

          const ttl = this.config.resolveWindowTtlSeconds?.({
            timeframe,
            category,
            date,
          });
          if (typeof ttl === "number" && ttl > 0) {
            multi.expire(key, ttl);
          }
        }
      }
    }

    await multi.exec();
  }

  async buildRankingFromWindows(
    timeframe: TTimeframe,
    date: Date = new Date(),
    ttlSeconds = 300,
  ): Promise<void> {
    const multi = this.client.multi();

    for (const category of this.config.categories) {
      const sources = this.resolveBuildSourceKeys(timeframe, category, date);
      const dest = this.resolveRankKey(timeframe, category);
      if (sources.length === 0) {
        multi.del(dest);
        continue;
      }

      multi.zUnionStore(dest, sources as [string, ...string[]], {
        AGGREGATE: this.aggregateOption(category),
      });
      if (ttlSeconds > 0) {
        multi.expire(dest, ttlSeconds);
      }
    }

    await multi.exec();
  }

  async getTopRankedUsers(
    timeframe: TTimeframe,
    category: TCategory,
    limit: number,
    descending: boolean,
  ): Promise<RankedUser[] | null> {
    const key = this.resolveRankKey(timeframe, category);
    const ttl = await this.client.ttl(key);
    if (ttl === -2) return null;

    const rows = await this.client.zRangeWithScores(key, 0, limit - 1, {
      REV: descending,
    });

    return rows.map((row, idx) => ({
      userId: row.value,
      score: row.score,
      rank: idx + 1,
    }));
  }

  async getUserRank(
    userId: string,
    timeframe: TTimeframe,
    category: TCategory,
    descending: boolean,
  ): Promise<RankedUser | null> {
    const key = this.resolveRankKey(timeframe, category);

    const [rank, score] = await Promise.all([
      descending ? this.client.zRevRank(key, userId) : this.client.zRank(key, userId),
      this.client.zScore(key, userId),
    ]);

    if (rank === null) return null;

    return {
      userId,
      score: score ?? 0,
      rank: rank + 1,
    };
  }

  async getScoresBatch(
    timeframe: TTimeframe,
    userIds: string[],
  ): Promise<Map<string, LeaderboardScores<TCategory>>> {
    if (userIds.length === 0) return new Map();

    const multi = this.client.multi();
    for (const category of this.config.categories) {
      multi.zmScore(this.resolveRankKey(timeframe, category), userIds);
    }

    const raw = (await multi.execAsPipeline()) as Array<Array<number | null>>;
    const out = new Map<string, LeaderboardScores<TCategory>>();

    userIds.forEach((userId, userIdx) => {
      const scores = {} as Record<TCategory, number>;
      this.config.categories.forEach((category, catIdx) => {
        scores[category] = raw[catIdx]?.[userIdx] ?? 0;
      });
      out.set(userId, scores);
    });

    return out;
  }
}

export function createRedisLeaderboardStore<
  TCategory extends string,
  TTimeframe extends string,
>(
  client: RedisLeaderboardClient,
  config: RedisStoreConfig<TCategory, TTimeframe>,
) {
  return new RedisLeaderboardStore(client, config);
}
