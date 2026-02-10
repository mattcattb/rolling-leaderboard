import type {
  LeaderboardEntry,
  LeaderboardMetadata,
  LeaderboardQuery,
  LeaderboardResponse,
} from "./types";
import type {
  LeaderboardStorePort,
  LoggerPort,
  MetadataPort,
  UsernamePort,
} from "./ports";

export type CreateLeaderboardServiceConfig<
  TCategory extends string,
  TTimeframe extends string,
> = {
  categories: readonly TCategory[];
  defaultCategory: TCategory;
  timeframes: readonly TTimeframe[];
  defaultTimeframe: TTimeframe;
  defaultSort?: "asc" | "desc";
  defaultLimit?: number;
  maxLimit?: number;
  fallbackUsername?: (userId: string) => string;
};

export class LeaderboardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaderboardConfigError";
  }
}

export class LeaderboardQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaderboardQueryError";
  }
}

export type CreateLeaderboardServiceDeps<
  TCategory extends string,
  TTimeframe extends string,
  TMetadata extends LeaderboardMetadata,
> = {
  store: LeaderboardStorePort<TCategory, TTimeframe>;
  usernames?: UsernamePort;
  metadata?: MetadataPort<TTimeframe, TMetadata>;
  logger?: LoggerPort;
};

export function createLeaderboardService<
  TCategory extends string,
  TTimeframe extends string,
  TMetadata extends LeaderboardMetadata = LeaderboardMetadata,
>(
  config: CreateLeaderboardServiceConfig<TCategory, TTimeframe>,
  deps: CreateLeaderboardServiceDeps<TCategory, TTimeframe, TMetadata>,
) {
  if (config.categories.length === 0) {
    throw new LeaderboardConfigError("categories must not be empty");
  }
  if (!config.categories.includes(config.defaultCategory)) {
    throw new LeaderboardConfigError("defaultCategory must be in categories");
  }
  if (!config.timeframes.includes(config.defaultTimeframe)) {
    throw new LeaderboardConfigError("defaultTimeframe must be in timeframes");
  }

  const defaultSort = config.defaultSort ?? "desc";
  const defaultLimit = config.defaultLimit ?? 25;
  const maxLimit = config.maxLimit ?? 100;
  if (defaultLimit < 1) {
    throw new LeaderboardConfigError("defaultLimit must be >= 1");
  }
  if (maxLimit < 1) {
    throw new LeaderboardConfigError("maxLimit must be >= 1");
  }
  const fallbackUsername =
    config.fallbackUsername ?? ((userId: string) => `User ${userId.slice(0, 8)}`);
  const categories = new Set<TCategory>(config.categories);
  const timeframes = new Set<TTimeframe>(config.timeframes);
  const emptyScores = () =>
    Object.fromEntries(config.categories.map((category) => [category, 0])) as Record<
      TCategory,
      number
    >;

  const normalizeQuery = (
    query?: Partial<LeaderboardQuery<TCategory, TTimeframe>>,
  ): Required<LeaderboardQuery<TCategory, TTimeframe>> => {
    const orderBy = query?.orderBy ?? config.defaultCategory;
    const timeframe = query?.timeframe ?? config.defaultTimeframe;
    const sort = query?.sort ?? defaultSort;
    const rawLimit = query?.limit ?? defaultLimit;
    const limit = Math.max(1, Math.min(maxLimit, rawLimit));

    if (!categories.has(orderBy)) {
      throw new LeaderboardQueryError(`Unknown category: ${String(orderBy)}`);
    }
    if (!timeframes.has(timeframe)) {
      throw new LeaderboardQueryError(`Unknown timeframe: ${String(timeframe)}`);
    }

    return { orderBy, timeframe, sort, limit };
  };

  const getUserEntry = async (
    userId: string,
    query: Required<LeaderboardQuery<TCategory, TTimeframe>>,
  ): Promise<LeaderboardEntry<TCategory, TMetadata | null> | null> => {
    const descending = query.sort === "desc";
    const ranked = await deps.store.getUserRank(
      userId,
      query.timeframe,
      query.orderBy,
      descending,
    );
    if (!ranked) return null;

    const [scores, usernames, metadata] = await Promise.all([
      deps.store.getScoresBatch(query.timeframe, [userId]),
      deps.usernames?.getUsernames([userId]) ?? Promise.resolve(new Map<string, string>()),
      deps.metadata?.getMetadata(query.timeframe, [userId]) ??
        Promise.resolve(new Map<string, TMetadata>()),
    ]);

    const userScores = scores.get(userId);
    if (!userScores) return null;

    return {
      userId,
      username: usernames.get(userId) ?? fallbackUsername(userId),
      rank: ranked.rank,
      scores: userScores,
      metadata: metadata.get(userId) ?? null,
    };
  };

  return {
    normalizeQuery,

    async getLeaderboard(
      query?: Partial<LeaderboardQuery<TCategory, TTimeframe>>,
      currentUserId?: string | null,
    ): Promise<LeaderboardResponse<TCategory, TMetadata | null>> {
      const q = normalizeQuery(query);
      const descending = q.sort === "desc";
      const rankedUsers = await deps.store.getTopRankedUsers(
        q.timeframe,
        q.orderBy,
        q.limit,
        descending,
      );

      if (!rankedUsers || rankedUsers.length === 0) {
        return { entries: [], user: null };
      }

      const userIds = rankedUsers.map((ranked) => ranked.userId);
      const [scores, usernames, metadata] = await Promise.all([
        deps.store.getScoresBatch(q.timeframe, userIds),
        deps.usernames?.getUsernames(userIds) ?? Promise.resolve(new Map<string, string>()),
        deps.metadata?.getMetadata(q.timeframe, userIds) ??
          Promise.resolve(new Map<string, TMetadata>()),
      ]);

      const entries: LeaderboardEntry<TCategory, TMetadata | null>[] = rankedUsers.map(
        (ranked) => ({
          userId: ranked.userId,
          username: usernames.get(ranked.userId) ?? fallbackUsername(ranked.userId),
          rank: ranked.rank,
          scores: scores.get(ranked.userId) ?? emptyScores(),
          metadata: metadata.get(ranked.userId) ?? null,
        }),
      );

      let user: LeaderboardEntry<TCategory, TMetadata | null> | null = null;
      if (currentUserId) {
        user =
          entries.find((entry) => entry.userId === currentUserId) ??
          (await getUserEntry(currentUserId, q));
      }

      return { entries, user };
    },

    async ingest(
      entries: Array<[userId: string, delta: Record<TCategory, number>]>,
      date: Date = new Date(),
    ): Promise<void> {
      await deps.store.ingestWindows(entries, date);
    },

    async rebuild(
      timeframes: TTimeframe[],
      date: Date = new Date(),
      ttlSeconds = 300,
    ): Promise<void> {
      await Promise.all(
        timeframes.map((timeframe) =>
          deps.store.buildRankingFromWindows(timeframe, date, ttlSeconds),
        ),
      ).catch((error) => {
        deps.logger?.error?.("Failed rebuilding leaderboard", { error });
        throw error;
      });
    },
  };
}
