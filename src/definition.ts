import type { RedisStoreConfig } from "./adapters/redis.store";
import type { LeaderboardAggregation } from "./adapters/redis.store";
import type { CreateLeaderboardServiceConfig } from "./service";

export type LeaderboardCategoryDefinition<TCategory extends string> = {
  key: TCategory;
  aggregation?: LeaderboardAggregation;
};

export type LeaderboardDefinition<
  TCategory extends string,
  TTimeframe extends string,
> = {
  categories: readonly LeaderboardCategoryDefinition<TCategory>[];
  timeframes: readonly TTimeframe[];
  defaultCategory: TCategory;
  defaultTimeframe: TTimeframe;
  defaultSort?: "asc" | "desc";
  defaultLimit?: number;
  maxLimit?: number;
};

export type LeaderboardMetricDefinition = {
  aggregation: LeaderboardAggregation;
};

export const metric = {
  sum: (): LeaderboardMetricDefinition => ({ aggregation: "sum" }),
  max: (): LeaderboardMetricDefinition => ({ aggregation: "max" }),
  min: (): LeaderboardMetricDefinition => ({ aggregation: "min" }),
} as const;

export type LeaderboardModelDefinition<
  TMetrics extends Record<string, LeaderboardMetricDefinition>,
  TTimeframes extends readonly string[],
> = {
  metrics: TMetrics;
  timeframes: TTimeframes;
  defaults: {
    metric: keyof TMetrics & string;
    timeframe: TTimeframes[number];
    sort?: "asc" | "desc";
    limit?: number;
    maxLimit?: number;
  };
};

export type MetricKey<TDef extends LeaderboardModelDefinition<any, any>> =
  keyof TDef["metrics"] & string;

export type TimeframeKey<TDef extends LeaderboardModelDefinition<any, any>> =
  TDef["timeframes"][number];

export type ScoreDeltaFromDefinition<TDef extends LeaderboardModelDefinition<any, any>> =
  Record<MetricKey<TDef>, number>;

export function defineLeaderboard<
  const TCategories extends readonly LeaderboardCategoryDefinition<string>[],
  const TTimeframes extends readonly string[],
>(definition: {
  categories: TCategories;
  timeframes: TTimeframes;
  defaultCategory: TCategories[number]["key"];
  defaultTimeframe: TTimeframes[number];
  defaultSort?: "asc" | "desc";
  defaultLimit?: number;
  maxLimit?: number;
}) {
  return definition;
}

export function defineLeaderboardModel<
  const TMetrics extends Record<string, LeaderboardMetricDefinition>,
  const TTimeframes extends readonly string[],
>(definition: {
  metrics: TMetrics;
  timeframes: TTimeframes;
  defaults: {
    metric: keyof TMetrics & string;
    timeframe: TTimeframes[number];
    sort?: "asc" | "desc";
    limit?: number;
    maxLimit?: number;
  };
}) {
  return definition;
}

export function createServiceConfigFromDefinition<
  const TCategories extends readonly LeaderboardCategoryDefinition<string>[],
  const TTimeframes extends readonly string[],
>(
  definition: {
    categories: TCategories;
    timeframes: TTimeframes;
    defaultCategory: TCategories[number]["key"];
    defaultTimeframe: TTimeframes[number];
    defaultSort?: "asc" | "desc";
    defaultLimit?: number;
    maxLimit?: number;
  },
): CreateLeaderboardServiceConfig<TCategories[number]["key"], TTimeframes[number]> {
  return {
    categories: definition.categories.map((category) => category.key),
    defaultCategory: definition.defaultCategory,
    timeframes: definition.timeframes,
    defaultTimeframe: definition.defaultTimeframe,
    defaultSort: definition.defaultSort,
    defaultLimit: definition.defaultLimit,
    maxLimit: definition.maxLimit,
  };
}

export function createServiceConfigFromModelDefinition<
  const TMetrics extends Record<string, LeaderboardMetricDefinition>,
  const TTimeframes extends readonly string[],
>(
  definition: LeaderboardModelDefinition<TMetrics, TTimeframes>,
): CreateLeaderboardServiceConfig<keyof TMetrics & string, TTimeframes[number]> {
  const categories = Object.keys(definition.metrics) as Array<keyof TMetrics & string>;

  return {
    categories,
    defaultCategory: definition.defaults.metric,
    timeframes: definition.timeframes,
    defaultTimeframe: definition.defaults.timeframe,
    defaultSort: definition.defaults.sort,
    defaultLimit: definition.defaults.limit,
    maxLimit: definition.defaults.maxLimit,
  };
}

export function createRedisConfigFromDefinition<
  const TCategories extends readonly LeaderboardCategoryDefinition<string>[],
  const TTimeframes extends readonly string[],
>(
  definition: {
    categories: TCategories;
    timeframes: TTimeframes;
    defaultCategory: TCategories[number]["key"];
    defaultTimeframe: TTimeframes[number];
    defaultSort?: "asc" | "desc";
    defaultLimit?: number;
    maxLimit?: number;
  },
  options: Omit<
    RedisStoreConfig<TCategories[number]["key"], TTimeframes[number]>,
    "categories" | "timeframes" | "categoryAggregation"
  >,
): RedisStoreConfig<TCategories[number]["key"], TTimeframes[number]> {
  const categoryAggregation = Object.fromEntries(
    definition.categories
      .filter((category) => category.aggregation)
      .map((category) => [category.key, category.aggregation]),
  ) as Partial<Record<TCategories[number]["key"], LeaderboardAggregation>>;

  return {
    ...options,
    categories: definition.categories.map((category) => category.key),
    timeframes: definition.timeframes,
    categoryAggregation,
  };
}

export function createRedisConfigFromModelDefinition<
  const TMetrics extends Record<string, LeaderboardMetricDefinition>,
  const TTimeframes extends readonly string[],
>(
  definition: LeaderboardModelDefinition<TMetrics, TTimeframes>,
  options: Omit<
    RedisStoreConfig<keyof TMetrics & string, TTimeframes[number]>,
    "categories" | "timeframes" | "categoryAggregation"
  >,
): RedisStoreConfig<keyof TMetrics & string, TTimeframes[number]> {
  const categories = Object.keys(definition.metrics) as Array<keyof TMetrics & string>;

  const categoryAggregation = Object.fromEntries(
    categories.map((category) => [
      category,
      definition.metrics[category].aggregation,
    ]),
  ) as Partial<Record<keyof TMetrics & string, LeaderboardAggregation>>;

  return {
    ...options,
    categories,
    timeframes: definition.timeframes,
    categoryAggregation,
  };
}
