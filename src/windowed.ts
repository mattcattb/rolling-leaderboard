import type {
  LeaderboardAggregation,
  RedisStoreConfig,
} from "./adapters/redis.store";

export type BuildWindowSource<TWindow extends string> = {
  window: TWindow;
  date: Date;
};

export type WindowedLeaderboardConfig<
  TCategory extends string,
  TTimeframe extends string,
  TWindow extends string,
> = {
  prefix: string;
  categories: readonly TCategory[];
  timeframes: readonly TTimeframe[];
  windows: readonly TWindow[];
  isComparisonCategory?: (category: TCategory) => boolean;
  shouldIngestForTimeframe?: (timeframe: TTimeframe) => boolean;
  getBuildWindowSources: (
    timeframe: TTimeframe,
    date: Date,
    category: TCategory,
  ) => BuildWindowSource<TWindow>[];
  formatWindowKey: (
    prefix: string,
    window: TWindow,
    date: Date,
    category: TCategory,
  ) => string;
  formatRankKey?: (prefix: string, timeframe: TTimeframe, category: TCategory) => string;
  formatMetadataKey?: (prefix: string, timeframe: TTimeframe) => string;
  formatNamesKey?: (prefix: string) => string;
};

export function createWindowedLeaderboardRedisConfig<
  TCategory extends string,
  TTimeframe extends string,
  TWindow extends string,
>(
  config: WindowedLeaderboardConfig<TCategory, TTimeframe, TWindow>,
): {
  redis: RedisStoreConfig<TCategory, TTimeframe>;
  keys: {
    rank: (timeframe: TTimeframe, category: TCategory) => string;
    window: (window: TWindow, date: Date, category: TCategory) => string;
    metadata: (timeframe: TTimeframe) => string;
    names: () => string;
  };
} {
  const categoryAggregation = Object.fromEntries(
    config.categories.map((category) => [
      category,
      config.isComparisonCategory?.(category) ? "max" : "sum",
    ]),
  ) as Partial<Record<TCategory, LeaderboardAggregation>>;

  const rankKey =
    config.formatRankKey ??
    ((prefix: string, timeframe: TTimeframe, category: TCategory) =>
      `${prefix}:ranking:${timeframe}:${category}`);
  const metadataKey =
    config.formatMetadataKey ??
    ((prefix: string, timeframe: TTimeframe) => `${prefix}:meta:${timeframe}`);
  const namesKey =
    config.formatNamesKey ?? ((prefix: string) => `${prefix}:names`);
  const shouldIngestForTimeframe =
    config.shouldIngestForTimeframe ??
    ((timeframe: TTimeframe) => timeframe === config.timeframes[0]);

  const keys = {
    rank: (timeframe: TTimeframe, category: TCategory) =>
      rankKey(config.prefix, timeframe, category),
    window: (window: TWindow, date: Date, category: TCategory) =>
      config.formatWindowKey(config.prefix, window, date, category),
    metadata: (timeframe: TTimeframe) => metadataKey(config.prefix, timeframe),
    names: () => namesKey(config.prefix),
  };

  return {
    redis: {
      prefix: config.prefix,
      categories: config.categories,
      timeframes: config.timeframes,
      categoryAggregation,
      resolveRankKey: ({ timeframe, category }) => keys.rank(timeframe, category),
      resolveIngestKeys: ({ timeframe, category, date }) => {
        if (!shouldIngestForTimeframe(timeframe)) return [];
        return config.windows.map((window) => keys.window(window, date, category));
      },
      resolveBuildSourceKeys: ({ timeframe, category, date }) =>
        config
          .getBuildWindowSources(timeframe, date, category)
          .map((source) => keys.window(source.window, source.date, category)),
    },
    keys,
  };
}
