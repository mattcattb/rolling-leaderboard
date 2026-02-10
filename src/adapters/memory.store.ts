import type { LeaderboardStorePort } from "../ports";
import type {
  LeaderboardDelta,
  LeaderboardScores,
  RankedUser,
} from "../types";

type ScoreMap = Map<string, number>;

type MemoryStoreConfig<TCategory extends string, TTimeframe extends string> = {
  categories: readonly TCategory[];
  timeframes: readonly TTimeframe[];
};

export class MemoryLeaderboardStore<
  TCategory extends string,
  TTimeframe extends string,
> implements LeaderboardStorePort<TCategory, TTimeframe>
{
  private windows = new Map<string, ScoreMap>();
  private ranks = new Map<string, ScoreMap>();

  constructor(private config: MemoryStoreConfig<TCategory, TTimeframe>) {}

  private windowKey(timeframe: TTimeframe, category: TCategory): string {
    return `window:${timeframe}:${category}`;
  }

  private rankKey(timeframe: TTimeframe, category: TCategory): string {
    return `rank:${timeframe}:${category}`;
  }

  private getOrCreate(map: Map<string, ScoreMap>, key: string): ScoreMap {
    const existing = map.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    map.set(key, created);
    return created;
  }

  async ingestWindows(
    entries: Array<[string, LeaderboardDelta<TCategory>]>,
  ): Promise<void> {
    for (const timeframe of this.config.timeframes) {
      for (const category of this.config.categories) {
        const bucket = this.getOrCreate(
          this.windows,
          this.windowKey(timeframe, category),
        );
        for (const [userId, delta] of entries) {
          const value = delta[category] ?? 0;
          if (value === 0) continue;
          bucket.set(userId, (bucket.get(userId) ?? 0) + value);
        }
      }
    }
  }

  async buildRankingFromWindows(timeframe: TTimeframe): Promise<void> {
    for (const category of this.config.categories) {
      const source = this.windows.get(this.windowKey(timeframe, category));
      const target = new Map<string, number>();
      if (source) {
        for (const [userId, score] of source) {
          target.set(userId, score);
        }
      }
      this.ranks.set(this.rankKey(timeframe, category), target);
    }
  }

  async getTopRankedUsers(
    timeframe: TTimeframe,
    category: TCategory,
    limit: number,
    descending: boolean,
  ): Promise<RankedUser[] | null> {
    const rank = this.ranks.get(this.rankKey(timeframe, category));
    if (!rank) return null;

    const rows = [...rank.entries()]
      .map(([userId, score]) => ({ userId, score }))
      .sort((a, b) => (descending ? b.score - a.score : a.score - b.score))
      .slice(0, limit);

    return rows.map((row, idx) => ({
      userId: row.userId,
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
    const rank = await this.getTopRankedUsers(
      timeframe,
      category,
      Number.MAX_SAFE_INTEGER,
      descending,
    );
    if (!rank) return null;

    const row = rank.find((item) => item.userId === userId);
    return row ?? null;
  }

  async getScoresBatch(
    timeframe: TTimeframe,
    userIds: string[],
  ): Promise<Map<string, LeaderboardScores<TCategory>>> {
    if (userIds.length === 0) return new Map();

    const output = new Map<string, LeaderboardScores<TCategory>>();
    for (const userId of userIds) {
      const scores = {} as Record<TCategory, number>;
      for (const category of this.config.categories) {
        const rank = this.ranks.get(this.rankKey(timeframe, category));
        scores[category] = rank?.get(userId) ?? 0;
      }
      output.set(userId, scores);
    }

    return output;
  }
}

export function createMemoryLeaderboardStore<
  TCategory extends string,
  TTimeframe extends string,
>(config: MemoryStoreConfig<TCategory, TTimeframe>) {
  return new MemoryLeaderboardStore(config);
}
