import type {
  LeaderboardDelta,
  LeaderboardMetadata,
  LeaderboardScores,
  RankedUser,
} from "./types";

export type LoggerPort = {
  debug?: (message: string, context?: Record<string, unknown>) => void;
  info?: (message: string, context?: Record<string, unknown>) => void;
  warn?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
};

export interface LeaderboardStorePort<TCategory extends string, TTimeframe extends string> {
  ingestWindows(
    entries: Array<[userId: string, delta: LeaderboardDelta<TCategory>]>,
    date?: Date,
  ): Promise<void>;

  buildRankingFromWindows(
    timeframe: TTimeframe,
    date?: Date,
    ttlSeconds?: number,
  ): Promise<void>;

  getTopRankedUsers(
    timeframe: TTimeframe,
    category: TCategory,
    limit: number,
    descending: boolean,
  ): Promise<RankedUser[] | null>;

  getUserRank(
    userId: string,
    timeframe: TTimeframe,
    category: TCategory,
    descending: boolean,
  ): Promise<RankedUser | null>;

  getScoresBatch(
    timeframe: TTimeframe,
    userIds: string[],
  ): Promise<Map<string, LeaderboardScores<TCategory>>>;
}

export interface UsernamePort {
  getUsernames(userIds: string[]): Promise<Map<string, string>>;
}

export interface MetadataPort<TTimeframe extends string, TMetadata extends LeaderboardMetadata> {
  getMetadata(timeframe: TTimeframe, userIds: string[]): Promise<Map<string, TMetadata>>;
}
