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
