export type LeaderboardScores<TCategory extends string> = Record<TCategory, number>;

export type LeaderboardMetadata = {
  [key: string]: unknown;
};

export type LeaderboardEntry<
  TCategory extends string,
  TMetadata extends LeaderboardMetadata | null = LeaderboardMetadata | null,
> = {
  userId: string;
  username: string;
  rank: number;
  scores: LeaderboardScores<TCategory>;
  metadata: TMetadata;
};

export type LeaderboardResponse<
  TCategory extends string,
  TMetadata extends LeaderboardMetadata | null = LeaderboardMetadata | null,
> = {
  entries: LeaderboardEntry<TCategory, TMetadata>[];
  user: LeaderboardEntry<TCategory, TMetadata> | null;
};

export type LeaderboardDelta<TCategory extends string> = LeaderboardScores<TCategory>;

export type RankedUser = {
  userId: string;
  score: number;
  rank: number;
};

export type LeaderboardQuery<TCategory extends string, TTimeframe extends string> = {
  orderBy: TCategory;
  sort?: "asc" | "desc";
  timeframe: TTimeframe;
  limit?: number;
};
